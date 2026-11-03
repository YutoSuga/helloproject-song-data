import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeCanonicalTarget, serializeCanonicalTable } from '../src/fn004-target-materialization.js';
import { constructHistoryRecord } from '../src/fn004-history-construction.js';
import { parseCsv } from '../src/csv.js';
import { CANONICAL_TABLES } from '../src/canonical-schema.js';
import { transactionFixture, commitFixture, rehash } from './fixtures/transaction-evidence.js';
import { seal, next } from './fixtures/decision-lifecycle.js';
import { buildDecisionRegistry } from '../src/fn004-decision-lifecycle.js';

for (const options of [{}, { noop: true }, { newEntities: true }]) {
  test(`materialization preserves exact originals and typed append order: ${JSON.stringify(options)}`, async () => {
    const f = transactionFixture(options);
    const args = { owner: f.owner, inputs: f.inputs, original: f.snapshot, apply_time: f.genesis.payload.apply_time };
    const result = await materializeCanonicalTarget(args);
    assert.equal(result.target.validation.ok, true); assert.equal(result.target.manifest.files.length, 14);
    assert.deepEqual(result.changed_paths, f.intent.payload.changed_paths);
    assert.deepEqual(result.target.manifest, f.intent.payload.target_manifest);
    for (const table of CANONICAL_TABLES) {
      assert.deepEqual(result.target.rawBytes[table.path], f.targetRawBytes[table.path]);
      assert.deepEqual(result.target.tables[table.name].slice(0, f.snapshot.tables[table.name].length), f.snapshot.tables[table.name]);
      if (!result.changed_paths.includes(table.path)) assert.deepEqual(result.target.rawBytes[table.path], f.snapshot.rawBytes[table.path]);
    }
    const reordered = { ...f.snapshot, rawBytes: Object.fromEntries(Object.entries(f.snapshot.rawBytes).reverse()) };
    assert.deepEqual((await materializeCanonicalTarget({ ...args, original: reordered })).target.manifest, result.target.manifest);
    assert.equal(f.state.pending_transaction, null);
  });
}

test('serializer v1 handles UTF-8, comma, quote, embedded CR/LF, empty fields and exact schema order', () => {
  const f = transactionFixture(), row = { ...f.snapshot.tables.works[0], title: '日本語, "quote"\r\nnext', notes: '' };
  const raw = serializeCanonicalTable('works', [row]);
  assert.equal(raw.includes(Buffer.from([0xef, 0xbb, 0xbf])), false);
  assert.equal(raw.at(-1), 10); assert.ok(raw.toString().includes('"日本語, ""quote""\r\nnext"'));
  const table = CANONICAL_TABLES.find(table => table.name === 'works');
  assert.deepEqual(parseCsv(raw.toString(), { strict: true }), [table.columns.map(column => column.name), table.columns.map(column => row[column.name])]);
  assert.deepEqual(serializeCanonicalTable('works', [Object.fromEntries(Object.entries(row).reverse())]), raw);
  assert.throws(() => serializeCanonicalTable('works', [{ ...row, extra: '' }]), { code: 'INTEGRITY_CONFLICT' });
  assert.throws(() => serializeCanonicalTable('works', [{ ...row, title: 1 }]), { code: 'INTEGRITY_CONFLICT' });
  for (const title of ['bad\u0000text', '\ud800']) assert.throws(() => serializeCanonicalTable('works', [{ ...row, title }]), { code: 'INTEGRITY_CONFLICT' });
});

test('relation no_op preserves numeric spelling and relation inserts use numeric typed-PK ordering', async () => {
  const base = transactionFixture({ noop: true });
  base.snapshot.tables.release_tracks[0].disc_number = '01'; base.snapshot.tables.release_tracks[0].track_number = '0001';
  const noop = transactionFixture({ checkpoint: base });
  const a = await materializeCanonicalTarget({ owner: noop.owner, inputs: noop.inputs, original: noop.snapshot, apply_time: noop.genesis.payload.apply_time });
  assert.deepEqual(a.changed_paths, []); assert.equal(a.target.tables.release_tracks[0].track_number, '0001');
  const b = transactionFixture(), draft = structuredClone(b.store.revisions[0]);
  draft.relations.release_tracks.push(...[10, 2].map((track_number, i) => ({ ...structuredClone(draft.relations.release_tracks[0]),
    local_ref: `track:t${i + 2}`, track_number })));
  draft.candidate_bindings[0].release_track_refs = ['track:t1', 'track:t2', 'track:t3']; seal(draft);
  const decision = next(draft, 'confirmed'), store = { schema_version: 1, revisions: [draft, decision] };
  const f = transactionFixture({ checkpoint: { ...b, decision, store, registry: buildDecisionRegistry(store) } });
  const target = await materializeCanonicalTarget({ owner: f.owner, inputs: f.inputs, original: f.snapshot, apply_time: f.genesis.payload.apply_time });
  assert.deepEqual(target.target.tables.release_tracks.map(row => row.track_number), ['1', '2', '10']);
});

test('bad original/Plan/identity/unknown operation cannot be materialized', async () => {
  const f = transactionFixture(), args = { owner: f.owner, inputs: f.inputs, original: f.snapshot, apply_time: f.genesis.payload.apply_time };
  const bad = { ...f.snapshot, rawBytes: { ...f.snapshot.rawBytes, 'data/works.csv': Buffer.from('invalid') } };
  await assert.rejects(materializeCanonicalTarget({ ...args, original: bad }));
  const missingForeignKey = { ...f.snapshot, rawBytes: { ...f.snapshot.rawBytes,
    'data/works.csv': serializeCanonicalTable('works', []) } };
  await assert.rejects(materializeCanonicalTarget({ ...args, original: missingForeignKey }));
  const inputs = structuredClone(f.inputs); inputs.plan.payload.operations[0].classification = 'delete';
  await assert.rejects(materializeCanonicalTarget({ ...args, inputs }));
  const owner = structuredClone(f.owner); owner.payload.binding.repository_instance_id = 'repo_00000000-0000-4000-8000-000000000099'; rehash(owner);
  await assert.rejects(materializeCanonicalTarget({ ...args, owner }));
});

for (const options of [{}, { noop: true }, { newEntities: true }]) {
  test(`History builder matches independently validated full record: ${JSON.stringify(options)}`, async () => {
    const f = commitFixture(options), args = { owner: f.owner, intent: f.intent, inputs: f.inputs, original: f.snapshot,
      bootstrap: f.bootstrap, records: [], proofs: [], applied_at: f.genesis.payload.apply_time };
    const record = await constructHistoryRecord(args);
    assert.deepEqual(record, f.record);
    assert.deepEqual(await constructHistoryRecord(args), record);
    assert.deepEqual(f.state, f.owner.payload.before_state);
    await assert.rejects(constructHistoryRecord({ ...args, applied_at: '2020-01-01T00:00:00Z' }), { code: 'INTEGRITY_CONFLICT' });
    const intent = structuredClone(f.intent); intent.payload.owner_hash = 'f'.repeat(64); rehash(intent);
    await assert.rejects(constructHistoryRecord({ ...args, intent }));
  });
}

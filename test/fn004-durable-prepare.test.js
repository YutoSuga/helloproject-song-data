import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTransactionPreparer } from '../src/fn004-durable-prepare.js';
import { discoverEvidence } from '../src/fn004-evidence-discovery.js';
import { prepareRecoverySnapshot } from '../src/fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
import { auditGitIds } from '../src/fn004-git-audit.js';
import { validateJournalChain } from '../src/fn004-journal-chain.js';
import { validateHistoryRecord } from '../src/fn004-history-record.js';
import { createPrepareArtifactPublisher } from '../src/fn004-prepare-artifacts.js';
import { prepareFixture } from './fixtures/durable-prepare.js';
import { exitedProbe } from './fixtures/transaction-evidence.js';

const command = f => ({ gate: f.gate, binding: f.binding, apply_time: f.apply_time });
async function inspect(f) {
  const process = Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
    'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, f.owner.payload.gate.metadata[key]]));
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding,
    discovery: await discoverEvidence(f.root), git_audit: await auditGitIds(f.root), probe: exitedProbe(process) }));
}

for (const phase of ['original_verified', 'preparing:before', 'preparing:after', 'target_bound:after', 'backup:after',
  'backup_complete:after', 'temp:before', 'temp:after', 'temp_checkpoint:after', 'intent:before', 'intent:after',
  'intent_bound:after', 'prepared:before', 'prepared:after']) {
  test(`failure boundary ${phase} retains classifiable evidence and original state`, async t => {
    const f = await prepareFixture(t), failure = new Error(`injected ${phase}`);
    const service = await createTransactionPreparer(f.root, { onBoundary: event => { if (event.phase === phase) throw failure; } });
    await assert.rejects(service.prepare(command(f)), error => error === failure);
    assert.deepEqual(await f.protectedHashes(), f.before);
    await fs.stat(join(f.root, 'staging/.fn004.lock'));
    const result = await inspect(f);
    assert.deepEqual(result.allowed_actions, ['abort']);
    if (['intent:after', 'intent_bound:after', 'prepared:before', 'prepared:after'].includes(phase)) {
      assert.ok((await discoverEvidence(f.root)).documents[`staging/transactions/${f.binding.transaction_id}/intent.json`]);
    }
  });
}

test('immutable backup/temp publisher retries same bytes, refuses overwrite and foreign identity/path', async t => {
  const f = await prepareFixture(t);
  const service = await createTransactionPreparer(f.root, { onBoundary: event => { if (event.phase === 'target_bound:after') throw new Error('pause'); } });
  await assert.rejects(service.prepare(command(f)), /pause/);
  const source = { gate: f.gate, owner: f.owner, inputs: f.inputs, original: f.snapshot, apply_time: f.apply_time,
    state_bytes: await fs.readFile(join(f.root, 'staging/fn004-state.json')) };
  const publisher = await createPrepareArtifactPublisher(f.root, source);
  const backup = publisher.paths.find(path => path.endsWith('/backup/data/works.csv'));
  const first = await publisher.publish(backup), inode = (await fs.stat(join(f.root, backup))).ino;
  assert.deepEqual(await publisher.publish(backup), first); assert.equal((await fs.stat(join(f.root, backup))).ino, inode);
  const temp = publisher.paths.find(path => path.includes('/temp/data/'));
  const ref = await publisher.publish(temp); assert.deepEqual(await publisher.publish(temp), ref);
  await assert.rejects(publisher.publish(backup.replace(f.binding.transaction_id, 'tx_00000000-0000-4000-8000-000000000099')),
    { code: 'INTEGRITY_CONFLICT' });
  await fs.writeFile(join(f.root, backup), 'corrupt backup');
  await assert.rejects(publisher.publish(backup), { code: 'INTEGRITY_CONFLICT' });
  assert.equal(await fs.readFile(join(f.root, backup), 'utf8'), 'corrupt backup');
  const foreign = structuredClone(f.owner); foreign.payload.binding.repository_instance_id = 'repo_00000000-0000-4000-8000-000000000099';
  await assert.rejects(createPrepareArtifactPublisher(f.root, { ...source, owner: foreign }));
  assert.deepEqual(await f.protectedHashes(), f.before);
});

for (const mode of ['partial_write', 'file_sync', 'publish', 'directory_sync']) {
  test(`raw publication ${mode} failure never becomes PREPARED or mutates canonical`, async t => {
    const f = await prepareFixture(t); let injected = false;
    const io = { ...fs, open: async (path, ...args) => {
      const handle = await fs.open(path, ...args);
      const selected = !injected && (mode === 'directory_sync' ? path.endsWith('/backup/data') && args[0] === 'r' :
        path.includes('/backup/data/.fn004-') && args[0] === 'wx');
      if (!selected || mode === 'publish') return handle;
      injected = true;
      return { writeFile: async raw => {
        if (mode === 'partial_write') { await handle.writeFile(raw.subarray(0, 9)); throw Object.assign(new Error('partial write'), { code: 'EIO' }); }
        return handle.writeFile(raw);
      }, sync: async () => { if (mode === 'file_sync' || mode === 'directory_sync') throw Object.assign(new Error('sync'), { code: 'EIO' });
        return handle.sync(); }, close: () => handle.close() };
    }, link: async (from, to) => {
      if (mode === 'publish' && !injected && to.includes('/backup/data/')) { injected = true; throw Object.assign(new Error('publish'), { code: 'EIO' }); }
      return fs.link(from, to);
    } };
    const service = await createTransactionPreparer(f.root, { io });
    await assert.rejects(service.prepare(command(f)), error => error.code === 'PERSISTENCE_WRITE_FAILED' &&
      error.phase === ({ partial_write: 'temp_write', file_sync: 'file_sync', publish: 'publish', directory_sync: 'directory_sync' })[mode]);
    assert.equal(injected, true); assert.deepEqual(await f.protectedHashes(), f.before);
    const result = await inspect(f);
    assert.deepEqual(result.allowed_actions, mode === 'directory_sync' ? ['abort'] : []);
    const d = await discoverEvidence(f.root);
    assert.equal(Object.values(d.documents).some(value => value.kind === 'fn004-journal' && value.payload.phase === 'PREPARED'), false);
    assert.ok(d.files.some(file => file.path.includes('/backup/data/.fn004-')));
  });
}

for (const mutation of ['retirement', 'foreign-transaction', 'state', 'canonical', 'git-ref', 'backup-missing', 'temp-corrupt', 'intent-missing', 'intent-corrupt']) {
  test(`publication guard rejects ${mutation} before the next semantic write`, async t => {
    const f = await prepareFixture(t); let injected = false;
    const service = await createTransactionPreparer(f.root, { onBoundary: async event => {
      const selected = mutation.startsWith('intent-') ? 'intent:after' : mutation === 'backup-missing' ? 'backup_complete:after' : mutation === 'temp-corrupt' ? 'temp:after' : 'preparing:after';
      if (injected || event.phase !== selected) return;
      injected = true;
      if (mutation === 'git-ref') {
        await promisify(execFile)('git', ['-C', f.root, 'update-ref', '-d', 'refs/remotes/origin/main']); return;
      }
      let path, bytes = '{}';
      if (mutation === 'retirement') path = `staging/recovery-ownership/${f.binding.transaction_id}/anchor.json`;
      if (mutation === 'foreign-transaction') path = 'staging/transactions/tx_00000000-0000-4000-8000-000000000099/owner.json';
      if (mutation === 'state') path = 'staging/fn004-state.json';
      if (mutation === 'canonical') { path = 'data/works.csv'; bytes = 'invalid'; }
      if (mutation === 'backup-missing') path = `staging/transactions/${f.binding.transaction_id}/backup/data/works.csv`;
      if (mutation === 'temp-corrupt' || mutation.startsWith('intent-')) path = event.path;
      const absolute = join(f.root, path);
      if (mutation === 'backup-missing' || mutation === 'intent-missing') { await fs.unlink(absolute); return; }
      await fs.mkdir(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true }); await fs.writeFile(absolute, bytes);
    } });
    await assert.rejects(service.prepare(command(f)), error => ['RECOVERY_REQUIRED', 'BOOTSTRAP_AUDIT_INCOMPLETE'].includes(error.code));
    assert.equal(injected, true);
    const d = await discoverEvidence(f.root);
    assert.equal(Object.values(d.documents).some(value => value.kind === 'fn004-journal' && value.payload.phase === 'PREPARED'), false);
    if (!['state', 'canonical'].includes(mutation)) assert.deepEqual(await f.protectedHashes(), f.before);
  });
}

test('raw publisher cannot ignore unsupported journal or partial publisher evidence', async t => {
  const f = await prepareFixture(t);
  const service = await createTransactionPreparer(f.root, { onBoundary: event => { if (event.phase === 'target_bound:after') throw new Error('pause'); } });
  await assert.rejects(service.prepare(command(f)), /pause/);
  const source = { gate: f.gate, owner: f.owner, inputs: f.inputs, original: f.snapshot, apply_time: f.apply_time,
    state_bytes: await fs.readFile(join(f.root, 'staging/fn004-state.json')) };
  const publisher = await createPrepareArtifactPublisher(f.root, source);
  const unknown = join(f.root, `staging/transactions/${f.binding.transaction_id}/journal/unknown.json`);
  await fs.writeFile(unknown, '{}');
  await assert.rejects(publisher.publish(publisher.paths[0]), { code: 'INTEGRITY_CONFLICT' });
  await fs.unlink(unknown);
  const partial = join(f.root, `staging/transactions/${f.binding.transaction_id}/.fn004-intent.json.tmp-00000000-0000-4000-8000-000000000099`);
  await fs.writeFile(partial, '{');
  await assert.rejects(publisher.publish(publisher.paths[0]), { code: 'PERSISTENCE_PARSE_FAILED' });
  assert.deepEqual(await f.protectedHashes(), f.before);
});

for (const options of [{}, { noop: true }, { newEntities: true }]) {
  test(`durable prepare stops at PREPARED without canonical/state/History mutation: ${JSON.stringify(options)}`, async t => {
    const f = await prepareFixture(t, options), service = await createTransactionPreparer(f.root);
    const result = await service.prepare(command(f));
    assert.equal(result.phase, 'PREPARED'); assert.equal(result.apply_time, f.apply_time);
    const chain = validateJournalChain({ owner: f.owner, inputs: f.inputs, intent: result.intent, entries: result.journal });
    assert.equal(chain.head.payload.phase, 'PREPARED'); assert.equal(chain.head.payload.id_consumed, false);
    assert.equal(result.journal[0].payload.intent_hash, null); assert.equal(chain.head.payload.intent_hash, result.intent.hash);
    const p = result.intent.payload;
    assert.equal(p.backup_refs.length, 15); assert.equal(p.temp_refs.length, f.intent.payload.changed_paths.length);
    for (const ref of [...p.backup_refs, ...p.temp_refs, ...Object.values(p.inputs)]) {
      assert.equal((await fs.readFile(join(f.root, ref.path))).length, ref.byte_length);
    }
    assert.notEqual((await fs.stat(join(f.root, 'data/works.csv'))).ino,
      (await fs.stat(join(f.root, `staging/transactions/${f.binding.transaction_id}/backup/data/works.csv`))).ino);
    assert.deepEqual(await f.protectedHashes(), f.before);
    const record = await result.constructHistory({ applied_at: f.apply_time }); validateHistoryRecord(record);
    await assert.rejects(fs.stat(join(f.root, 'staging/apply-history')), { code: 'ENOENT' });
    assert.deepEqual((await inspect(f)).allowed_actions, ['abort']);
    await assert.rejects(service.prepare(command(f)));
    assert.deepEqual(await f.protectedHashes(), f.before);
  });
}

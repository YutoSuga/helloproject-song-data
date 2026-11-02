import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRecoverySnapshot } from '../src/fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
import { matchesRecoveryObservation } from '../src/fn004-recovery-observation.js';
import { sha256 } from '../src/canonical-hash.js';
import { validateJournalChain } from '../src/fn004-journal-chain.js';
import { validateTerminalProof } from '../src/fn004-terminal-evidence.js';
import { proveTerminalHistory } from '../src/fn004-terminal-history.js';
import { transactionFixture, abortedFixture, commitFixture, rollbackFixture, recoveryDiscovery,
  ownershipFixture, exitedProbe, bytes, rehash, uuid } from './fixtures/transaction-evidence.js';

async function observe(f, options = {}, overrides = {}) {
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding,
    discovery: recoveryDiscovery(f, options), git_audit: f.git_audit, probe: exitedProbe(f.process), ...overrides }));
}
const root = f => `staging/transactions/${f.binding.transaction_id}`;
const proofPath = f => `staging/transaction-proofs/${f.binding.transaction_id}.json`;
const completionPath = f => `staging/apply-requests/completions/${f.binding.request_id}.json`;
function action(result, expected) {
  assert.deepEqual(result.allowed_actions, expected === null ? [] : [expected]);
  assert.ok(result.allowed_actions.length <= 1);
}

test('6A-DG01-01: pre-Intent journal crash is abortable; establishment lag remains H-bound', async () => {
  const f = transactionFixture();
  for (const intent of [null, f.intent]) {
    const r = await observe(f, { intent }); action(r, 'abort');
    assert.equal(r.classification, 'abortable'); assert.equal(r.readiness, 'recovery_required');
  }
});

test('M-01 receipt-only A/B/C/D: terminal evidence wins over missing journal', async () => {
  const f = abortedFixture({ receiptOnly: true });
  action(await observe(f, { journal: [], omit: [`${root(f)}/owner.json`] }), null);
  action(await observe(f, { journal: [] }), 'abort');
  action(await observe(f, { journal: [], proof: f.proof }), 'finish_terminal');
  action(await observe(f, { journal: [], proof: f.proof, completion: f.completion }), 'cleanup');
  const invalid = await observe(f, { journal: [], completion: f.completion });
  action(invalid, null); assert.equal(invalid.readiness, 'blocked');
});

test('pre-Intent and H-bound journal terminals reuse Proof, then select cleanup only', async () => {
  for (const withIntent of [false, true]) {
    const f = abortedFixture({ withIntent }), options = { journal: f.proof.payload.journal, intent: withIntent ? f.intent : null };
    action(await observe(f, options), 'finish_terminal');
    action(await observe(f, { ...options, proof: f.proof }), 'finish_terminal');
    action(await observe(f, { ...options, proof: f.proof, completion: f.completion }), 'cleanup');
  }
});

test('H-01 x M-01: successor archive survives every retirement boundary, without semantic regression', async () => {
  const f = abortedFixture({ receiptOnly: true });
  const tokens = new Set();
  for (const retirement of ['ACTIVE', 'RETIRING', 'RETIRED', 'SEALED']) {
    const archive = ownershipFixture(f, { count: 3, retirement });
    const r = await observe(f, { journal: [], proof: f.proof, completion: f.completion,
      gate: ['ACTIVE', 'RETIRING'].includes(retirement), extra: archive.extra },
    { probe: exitedProbe(archive.head.payload.owner) });
    action(r, retirement === 'SEALED' ? null : 'cleanup');
    tokens.add(r.observed_state_hash);
    if (retirement !== 'SEALED') assert.deepEqual(r.evidence.effective_owner, archive.head.payload.owner);
    else assert.equal(r.readiness, 'initialized');
    if (retirement === 'RETIRING') action(await observe(f, { journal: [], proof: f.proof, completion: f.completion,
      extra: { ...archive.extra, [`${root(f)}/backup/fn004-state.json`]: f.state } },
    { probe: exitedProbe(archive.head.payload.owner) }), null);
  }
  assert.equal(tokens.size, 4);
});

test('ownership corruption and changed physical retirement barrier never fall back to an old prefix', async () => {
  const f = abortedFixture({ receiptOnly: true }), archive = ownershipFixture(f, { count: 2, retirement: 'RETIRING' });
  const options = { journal: [], proof: f.proof, completion: f.completion, extra: archive.extra };
  for (const omit of [[`staging/recovery-ownership/${f.binding.transaction_id}/claims/000001.json`],
    ['staging/.fn004-recovery.lock']]) {
    action(await observe(f, { ...options, omit }, { probe: exitedProbe(archive.head.payload.owner) }), null);
  }
  const discovery = recoveryDiscovery(f, options); discovery.identities['staging/.fn004-recovery.lock'].inode = '999';
  const r = classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding, discovery,
    git_audit: f.git_audit, probe: exitedProbe(archive.head.payload.owner) }));
  action(r, null); assert.ok(r.diagnostics.some(value => value.code === 'GATE_OWNERSHIP_MISMATCH'));
});

test('H-01: receipt-only Proof ownership prefix also prevents a missing/truncated archive from becoming a new lineage', async () => {
  const f = abortedFixture({ receiptOnly: true }), archive = ownershipFixture(f, { count: 3 });
  f.proof.payload.authority.recovery = { anchor: archive.anchor, claims: archive.claims }; rehash(f.proof);
  f.completion.payload.proof_hash = f.proof.hash; rehash(f.completion);
  const options = { journal: [], proof: f.proof, completion: f.completion };
  action(await observe(f, options), null);
  action(await observe(f, { ...options, extra: archive.extra }, { probe: exitedProbe(archive.head.payload.owner) }), 'cleanup');
  action(await observe(f, { ...options, extra: archive.extra,
    omit: [`staging/recovery-ownership/${f.binding.transaction_id}/claims/000003.json`] },
  { probe: exitedProbe(archive.claims[1].payload.owner) }), null);
});

test('owner liveness, unsupported boot/namespace, missing gate and raced snapshots never authorize actions', async () => {
  const f = transactionFixture();
  for (const overrides of [{ probe: null }, { consistency: 'raced' }, { git_audit: null },
    { probe: { ...exitedProbe(f.process), status: 'live' } },
    { probe: { ...exitedProbe(f.process), observer: { ...exitedProbe(f.process).observer, boot_id: 'other-boot' } } }]) {
    action(await observe(f, {}, overrides), null);
  }
  action(await observe(f, { gate: false }), null);
});

test('COMMIT_DECIDED is irreversible; all-target and History lag have distinct deterministic actions', async () => {
  for (const options of [{}, { noop: true }, { newEntities: true }]) {
    const f = commitFixture(options);
    validateTerminalProof(f.proof, { histories: [f.record] });
    assert.deepEqual(proveTerminalHistory({ bootstrap: f.bootstrap, records: [f.record], proofs: [f.proof] }).terminal, f.after);
    for (const [stage, state, target, expected] of [
      ['committing', f.state, false, 'rollback'], ['replaced', f.intent.payload.expected_consumed_state, true, 'finalize_success'],
      ['decided', f.intent.payload.expected_consumed_state, true, 'finalize_success'],
      ['historyCommitted', f.intent.payload.expected_consumed_state, true, 'finalize_success'],
      ['completed', f.after, true, 'finish_terminal']]) {
      const extra = ['historyCommitted', 'completed'].includes(stage) ? { [`staging/apply-history/${f.binding.apply_id}.json`]: f.record } : {};
      action(await observe(f, { journal: f.journal.slice(0, f.journal.indexOf(f[stage]) + 1), intent: f.intent, state, target, extra }), expected);
    }
  }
});

test('rollback before/after consumption preserves exact state and supports terminal continuation', async () => {
  for (const consumed of [false, true]) {
    const f = rollbackFixture({ consumed });
    validateJournalChain({ owner: f.owner, intent: f.intent, inputs: f.inputs, entries: f.journal });
    validateTerminalProof(f.proof);
    const profile = proveTerminalHistory({ bootstrap: f.bootstrap, records: [], proofs: [f.proof] });
    assert.deepEqual(profile.terminal, f.after);
    action(await observe(f, { journal: f.journal.slice(0, -1), intent: f.intent,
      state: consumed ? f.intent.payload.expected_consumed_state : f.state }), 'rollback');
    action(await observe(f, { journal: f.journal, intent: f.intent, state: f.after, proof: f.proof }), 'finish_terminal');
    action(await observe(f, { journal: f.journal, intent: f.intent, state: f.after, proof: f.proof, completion: f.completion }), 'cleanup');
    if (consumed) {
      const canonicalPath = f.intent.payload.changed_paths[0], path = `${root(f)}/restore/${canonicalPath}`;
      const options = { journal: f.journal, intent: f.intent, state: f.after, proof: f.proof, extra: { [path]: {} } };
      const discovery = recoveryDiscovery(f, options), raw = f.snapshot.rawBytes[canonicalPath];
      discovery.rawBytes[path] = raw;
      Object.assign(discovery.files.find(file => file.path === path), { byte_length: raw.length, sha256: sha256(raw) });
      action(await observe(f, options, { discovery }), 'finish_terminal');
      discovery.rawBytes[path] = Buffer.from('wrong restore bytes');
      Object.assign(discovery.files.find(file => file.path === path), { byte_length: discovery.rawBytes[path].length,
        sha256: sha256(discovery.rawBytes[path]) });
      action(await observe(f, options, { discovery }), null);
    }
  }
});

test('consumed rollback followed by success composes generation/ID evidence without changing success-only readers', () => {
  const failed = rollbackFixture({ newEntities: true });
  const checkpoint = { ...failed, state: failed.after };
  const next = commitFixture({ checkpoint, requestUuid: '00000000-0000-4000-8000-000000000077', pastProofs: [failed.proof] });
  const result = proveTerminalHistory({ bootstrap: failed.bootstrap, records: [next.record], proofs: [next.proof, failed.proof] });
  assert.deepEqual(result.terminal, next.after);
  assert.equal(next.after.generation, failed.state.generation + 4);
  assert.equal(next.after.history.count, 1);
  for (const range of next.intent.payload.allocation_ranges) {
    assert.equal(range.first, failed.after.high_water_marks[range.namespace] + 1);
  }
  assert.throws(() => proveTerminalHistory({ bootstrap: failed.bootstrap, records: [next.record], proofs: [next.proof] }),
    { code: 'STATE_TRANSITION_PROOF_REQUIRED' });
});

test('failed Proof conflicts with successful History and COMMIT_DECIDED, never falls back to abort', async () => {
  const f = commitFixture(), failed = abortedFixture({ withIntent: true });
  for (const options of [
    { journal: failed.proof.payload.journal, proof: failed.proof, intent: f.intent, extra: { [`staging/apply-history/${f.binding.apply_id}.json`]: f.record } },
    { journal: f.journal.slice(0, 6), intent: f.intent, proof: failed.proof, target: true, state: f.intent.payload.expected_consumed_state }
  ]) {
    const r = await observe(f, options); action(r, null); assert.equal(r.readiness, 'blocked');
  }
});

test('partial publication: complete terminal publication intent resumes; Intent/journal uncertainty stops', async () => {
  const f = abortedFixture(), temp = path => `${path.slice(0, path.lastIndexOf('/') + 1)}.fn004-${path.split('/').at(-1)}.tmp-${uuid}`;
  const terminal = { journal: f.proof.payload.journal };
  action(await observe(f, { ...terminal, extra: { [temp(proofPath(f))]: f.proof } }), 'finish_terminal');
  action(await observe(f, { ...terminal, proof: f.proof, extra: { [temp(completionPath(f))]: f.completion } }), 'finish_terminal');
  action(await observe(f, { extra: { [temp(`${root(f)}/intent.json`)]: f.intent } }), null);
  action(await observe(f, { extra: { [temp(`${root(f)}/journal/000002.json`)]: f.terminal } }), null);
});

test('authoritative changes alter observation tokens and reject stale actions; cache does not become authority', async () => {
  const f = abortedFixture({ receiptOnly: true });
  const a = await observe(f, { journal: [] }), b = await observe(f, { journal: [], proof: f.proof }),
    c = await observe(f, { journal: [], proof: f.proof, completion: f.completion });
  assert.equal(new Set([a, b, c].map(r => r.observed_state_hash)).size, 3);
  const command = { schema_version: 2, request_id: f.binding.request_id, transaction_id: f.binding.transaction_id,
    expected_observed_state_hash: a.observed_state_hash, action: 'abort' };
  assert.equal(matchesRecoveryObservation(command, a), true);
  assert.equal(matchesRecoveryObservation(command, b), false);
  assert.throws(() => matchesRecoveryObservation({ ...command, schema_version: 1 }, a));
  const g = transactionFixture(), first = await observe(g), cache = { schema_version: 1, binding: g.binding,
    head: { sequence: 1, entry_hash: g.genesis.hash } };
  const cached = await observe(g, { extra: { [`${root(g)}/transaction.json`]: cache } });
  assert.equal(first.observed_state_hash, cached.observed_state_hash);
  const request = structuredClone(g.request); request.processing = { ...request.processing, state: 'advisory-only' };
  assert.equal((await observe(g, { extra: { [`staging/apply-requests/${g.binding.request_id}.json`]: request } })).observed_state_hash,
    first.observed_state_hash);
  action(await observe(g, { extra: { [`${root(g)}/transaction.json`]: { ...cache, head: { ...cache.head, entry_hash: 'f'.repeat(64) } } } }), null);
  assert.notEqual((await observe(g, { intent: g.intent })).observed_state_hash, first.observed_state_hash);
});

test('filesystem order and caller mutation cannot alter the immutable pure snapshot decision', async () => {
  const f = transactionFixture(), discovery = recoveryDiscovery(f);
  const args = { binding: f.binding, discovery, git_audit: f.git_audit, probe: exitedProbe(f.process) };
  const snapshot = await prepareRecoverySnapshot(args), expected = classifyRecoverySnapshot(snapshot);
  discovery.files.reverse();
  assert.deepEqual(classifyRecoverySnapshot(await prepareRecoverySnapshot(args)), expected);
  discovery.rawBytes['data/release_tracks.csv'].fill(0); f.owner.payload.accepted_at = 'invalid';
  assert.deepEqual(classifyRecoverySnapshot(snapshot), expected);
  assert.throws(() => classifyRecoverySnapshot({}));
});

test('malformed and nonobject JSON evidence is an explicit typed failure, never absence', async () => {
  const f = transactionFixture();
  for (const raw of [Buffer.from('{'), Buffer.from('null'), Buffer.from('[]'), Buffer.from([0xff])]) {
    const discovery = recoveryDiscovery(f), path = `${root(f)}/intent.json`;
    discovery.rawBytes[path] = raw;
    discovery.files.push({ path, kind: 'file', byte_length: raw.length, sha256: sha256(raw) });
    await assert.rejects(prepareRecoverySnapshot({ binding: f.binding, discovery, git_audit: f.git_audit }),
      error => /^PERSISTENCE_/.test(error.code));
  }
});

test('correctly rehashed conflicting terminal evidence and missing established Intent fail closed', async () => {
  const f = abortedFixture({ withIntent: true });
  const bad = structuredClone(f.completion); bad.payload.proof_hash = 'f'.repeat(64); rehash(bad);
  action(await observe(f, { journal: f.proof.payload.journal, intent: f.intent, proof: f.proof, completion: bad }), null);
  action(await observe(f, { journal: f.proof.payload.journal }), null);
  const p = structuredClone(f.proof); p.payload.intent = null; rehash(p);
  action(await observe(f, { journal: f.proof.payload.journal, intent: f.intent, proof: p }), null);
});

test('rehashed wrong repository/transaction/version/unknown evidence never authorizes automatic mutation', async () => {
  const f = transactionFixture();
  for (const mutate of [v => v.payload.binding.bootstrap_hash = 'f'.repeat(64),
    v => v.payload.binding.transaction_id = 'tx_00000000-0000-4000-8000-000000000099',
    v => v.payload.extra = true, v => v.schema_version = 2]) {
    const bad = structuredClone(f.intent); mutate(bad); rehash(bad);
    action(await observe(f, { intent: bad }), null);
  }
  action(await observe(f, { extra: { [`${root(f)}/unrecognized.json`]: { schema_version: 1 } } }), null);
  action(await observe(f, { extra: { 'staging/transactions/tx_00000000-0000-4000-8000-000000000088/owner.json': f.owner } }), null);
});

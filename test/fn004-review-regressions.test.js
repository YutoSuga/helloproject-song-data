import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRecoverySnapshot } from '../src/fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
import { sha256 } from '../src/canonical-hash.js';
import { buildDecisionRegistry } from '../src/fn004-decision-lifecycle.js';
import { next, seal, source } from './fixtures/decision-lifecycle.js';
import { transactionFixture, commitFixture, rollbackFixture, abortedFixture, ownershipFixture, append, rehash, bytes,
  recoveryDiscovery, exitedProbe } from './fixtures/transaction-evidence.js';

function replaceBytes(discovery, path, raw) {
  discovery.rawBytes[path] = raw;
  Object.assign(discovery.files.find(file => file.path === path), { byte_length: raw.length, sha256: sha256(raw) });
}
async function classify(f, discovery) {
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding, discovery,
    git_audit: f.git_audit, probe: exitedProbe(f.process) }));
}
function conflict(value) {
  assert.deepEqual(value.allowed_actions, []);
  assert.equal(value.classification, 'manual_stop');
  assert.ok(value.diagnostics.some(diagnostic => diagnostic.code === 'INTEGRITY_CONFLICT'));
}

test('R77-H01: failure-after publication requires all original bytes, including checkpoint lag', async () => {
  const f = rollbackFixture({ newEntities: true });
  const options = { journal: f.journal.slice(0, -1), intent: f.intent, state: f.after };
  assert.deepEqual((await classify(f, recoveryDiscovery(f, options))).allowed_actions, ['rollback']);
  conflict(await classify(f, recoveryDiscovery(f, { ...options, target: true })));
  const mixed = recoveryDiscovery(f, options);
  replaceBytes(mixed, 'data/works.csv', f.targetRawBytes['data/works.csv']);
  conflict(await classify(f, mixed));
});

test('R77-H01: partial replacement cannot precede consumption, even when no IDs are allocated', async () => {
  const base = transactionFixture(), draft = structuredClone(base.store.revisions[0]);
  draft.relations.song_performers = [{ local_ref: 'song_performer:sp1', evidence_refs: ['ev_source'],
    song: structuredClone(draft.candidate_bindings[0].song),
    member: { existing_id: 'P00001', assertions: { name: 'Member' }, evidence_refs: ['ev_source'] },
    performer_order: 1, notes: null, source_url: source.source_url }];
  draft.candidate_bindings[0].performer_review = 'specified';
  seal(draft);
  const decision = next(draft, 'confirmed'), store = { schema_version: 1, revisions: [draft, decision] };
  const f = commitFixture({ checkpoint: { ...base, decision, store, registry: buildDecisionRegistry(store) } });
  assert.deepEqual(f.intent.payload.allocation_ranges, []);
  assert.equal(f.intent.payload.changed_paths.length, 2);
  const options = { journal: f.journal.slice(0, 3), intent: f.intent, state: f.state };
  assert.deepEqual((await classify(f, recoveryDiscovery(f, options))).allowed_actions, ['rollback']);
  const mixed = recoveryDiscovery(f, options), path = f.intent.payload.changed_paths[0];
  replaceBytes(mixed, path, f.targetRawBytes[path]);
  conflict(await classify(f, mixed));
  const consumed = recoveryDiscovery(f, { ...options, state: f.intent.payload.expected_consumed_state });
  replaceBytes(consumed, path, f.targetRawBytes[path]);
  assert.deepEqual((await classify(f, consumed)).allowed_actions, ['rollback']);
});

test('R77-H02: historical retirement must bind its own claimed gate after release', async () => {
  const f = abortedFixture({ receiptOnly: true }), archive = ownershipFixture(f, { retirement: 'RETIRED' });
  const retiring = archive.retirements[0], retired = archive.retirements[1];
  const gate = structuredClone(retiring.payload.canonical_gate);
  gate.metadata.lock_id = '00000000-0000-4000-8000-000000000077';
  gate.byte_length = bytes(gate.metadata).length; gate.sha256 = sha256(bytes(gate.metadata));
  retiring.payload.canonical_gate = gate; rehash(retiring);
  retired.payload.retiring_hash = retiring.hash; rehash(retired);
  const snapshot = await prepareRecoverySnapshot({ binding: f.binding,
    discovery: recoveryDiscovery(f, { journal: [], proof: f.proof, completion: f.completion, gate: false, extra: archive.extra }),
    git_audit: f.git_audit, probe: exitedProbe(archive.head.payload.owner) });
  const result = classifyRecoverySnapshot(snapshot);
  assert.deepEqual(result.allowed_actions, []);
  assert.ok(result.diagnostics.some(value => value.code === 'GATE_CORRUPT'));
});

test('R77-H02: gate-free cleanup can retire only its own recovery_cleanup gate', async () => {
  const f = abortedFixture({ receiptOnly: true }), a = ownershipFixture(f, { count: 0, retirement: 'RETIRED' });
  a.anchor.payload.gate = null; a.anchor.payload.predecessor_exit = null; rehash(a.anchor);
  a.barrier.payload.anchor_hash = a.anchor.hash; rehash(a.barrier);
  const retiring = a.retirements[0], retired = a.retirements[1], gate = structuredClone(f.gate);
  Object.assign(gate.metadata, a.head.payload.owner, { operation: 'recovery_cleanup' });
  gate.inode = '22'; gate.byte_length = bytes(gate.metadata).length; gate.sha256 = sha256(bytes(gate.metadata));
  retiring.payload.owner.owner_hash = a.anchor.hash;
  Object.assign(retiring.payload.barrier, { byte_length: bytes(a.barrier).length, sha256: sha256(bytes(a.barrier)) });
  retiring.payload.canonical_gate = gate; rehash(retiring);
  retired.payload.retiring_hash = retiring.hash; rehash(retired);
  async function result() {
    return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding,
      discovery: recoveryDiscovery(f, { journal: [], proof: f.proof, completion: f.completion, gate: false, extra: a.extra }),
      git_audit: f.git_audit, probe: exitedProbe(a.head.payload.owner) }));
  }
  assert.deepEqual((await result()).allowed_actions, ['cleanup']);
  gate.metadata.process_instance_id = '00000000-0000-4000-8000-000000000079';
  gate.byte_length = bytes(gate.metadata).length; gate.sha256 = sha256(bytes(gate.metadata)); rehash(retiring);
  retired.payload.retiring_hash = retiring.hash; rehash(retired);
  assert.deepEqual((await result()).allowed_actions, []);
});

test('R77-M01: other pre-Intent terminal input copies cannot escape repository-wide validation', async () => {
  const f = abortedFixture({ receiptOnly: true });
  const other = transactionFixture({ checkpoint: f, requestUuid: '00000000-0000-4000-8000-000000000078' });
  const terminal = append(other.genesis, { phase: 'ABORTED', terminal_state: other.state });
  const proof = structuredClone(f.proof);
  Object.assign(proof.payload, { binding: other.binding, owner: other.owner, inputs: other.inputs,
    authority: terminal.payload.authority, journal: [other.genesis, terminal] }); rehash(proof);
  const completion = structuredClone(f.completion);
  Object.assign(completion.payload, { binding: other.binding, proof_hash: proof.hash,
    terminal_journal: { sequence: terminal.payload.sequence, entry_hash: terminal.hash } }); rehash(completion);
  const path = `staging/transactions/${other.binding.transaction_id}/plan.json`;
  const extra = { [`staging/apply-requests/${other.binding.request_id}.json`]: other.request,
    [`staging/apply-approvals/${other.binding.approval_id}.json`]: other.inputs.approval,
    [`staging/apply-plans/${other.binding.plan_id}.json`]: other.plan,
    [`staging/transactions/${other.binding.transaction_id}/owner.json`]: other.owner,
    [`staging/transactions/${other.binding.transaction_id}/journal/000001.json`]: other.genesis,
    [`staging/transactions/${other.binding.transaction_id}/journal/000002.json`]: terminal,
    [`staging/transaction-proofs/${other.binding.transaction_id}.json`]: proof,
    [`staging/apply-requests/completions/${other.binding.request_id}.json`]: completion,
    [path]: other.plan };
  assert.deepEqual((await classify(f, recoveryDiscovery(f, { extra }))).allowed_actions, ['abort']);
  extra[path] = { ...other.plan, unexpected: true };
  conflict(await classify(f, recoveryDiscovery(f, { extra })));
});

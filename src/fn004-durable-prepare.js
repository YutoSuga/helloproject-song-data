import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { assertGateOwnership } from './fn004-gate.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { prepareRecoverySnapshot, recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { auditGitIds, inspectGitIdentity } from './fn004-git-audit.js';
import { createEvidencePublisher, evidencePath } from './fn004-evidence-persistence.js';
import { createPrepareArtifactPublisher } from './fn004-prepare-artifacts.js';
import { evidenceHashV1 } from './fn004-evidence-hash.js';
import { constructHistoryRecord } from './fn004-history-construction.js';
import { canonicalJson, sha256 } from './canonical-hash.js';
import { check, same, binding as validateBinding, timestamp } from './fn004-evidence-types.js';

const envelope = (kind, payload) => ({ schema_version: 1, kind, payload, hash: evidenceHashV1(kind, payload) });
const jsonBytes = value => Buffer.from(canonicalJson(value) + '\n');

// Internal prepare kernel for an already accepted Owner and its original live
// lease. It is not connected to Request submit/retry, CLI or any commit executor.
// A failed/previous attempt is inspected, never automatically resumed here.
export async function createTransactionPreparer(root, { io = fs, audit = auditGitIds, onBoundary = async () => {} } = {}) {
  const store = await createPersistence(root, { io }), evidence = await createEvidencePublisher(store.root, { io });
  return Object.freeze({ prepare: async ({ gate, binding, apply_time }) => {
    binding = JSON.parse(canonicalJson(binding));
    validateBinding(binding); timestamp(apply_time); await assertGateOwnership(gate, store.root);
    const initial = await discoverEvidence(store.root, { io });
    const gitAudit = await audit(store.root);
    check(gitAudit !== null && gitAudit !== undefined, 'Prepare requires a complete authoritative Git audit');
    const snapshot = await prepareRecoverySnapshot({ binding, discovery: initial, git_audit: gitAudit, probe: null });
    const s = recoverySnapshotData(snapshot);
    if (s.diagnostics.length || s.base.evidence.input_revalidation !== 'valid') {
      throw new RepositoryError(s.diagnostics[0]?.code ?? 'RECOVERY_REQUIRED', 'Prepare preconditions are not verified');
    }
    const owner = s.owner, inputs = s.proof?.payload.inputs ?? {
      decision: initial.documents['staging/decisions.json'].revisions.find(value => same(binding.decision,
        { decision_id: value.decision_id, revision: value.revision, content_hash: value.content_hash })),
      plan: initial.documents[`staging/apply-plans/${binding.plan_id}.json`],
      approval: initial.documents[`staging/apply-approvals/${binding.approval_id}.json`],
      request: { schema_version: 1, receipt: initial.documents[`staging/apply-requests/${binding.request_id}.json`].receipt } };
    const txRoot = `staging/transactions/${binding.transaction_id}`;
    check(owner && s.chain && s.chain.entries.length === 0 && !s.intent && !s.proof && !s.proof_intent && !s.completion && !s.archive &&
      same(s.gate, owner.payload.gate) && same(s.canonical_manifest, owner.payload.original_manifest) &&
      same(s.state, owner.payload.before_state) && initial.files.every(file => file.kind !== 'file' ||
        !file.path.startsWith(`${txRoot}/`) || file.path === `${txRoot}/owner.json`),
    'Prepare requires a fresh initial Owner, original canonical/state and no terminal/Recovery authority');
    const initialEntries = new Map(initial.files.filter(file => file.kind !== 'missing').map(file => [file.path, file]));
    const expected = new Map(), published = new Set(), allowedDirectories = new Set();
    function expect(path, raw) {
      expected.set(path, Buffer.from(raw));
      let parent = path.slice(0, path.lastIndexOf('/'));
      while (parent) { allowedDirectories.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
    }
    async function guard() {
      await assertGateOwnership(gate, store.root);
      const current = await discoverEvidence(store.root, { io }), actual = new Map(current.files.map(file => [file.path, file]));
      const changed = () => { throw new RepositoryError('RECOVERY_REQUIRED', 'Authoritative evidence changed during owned prepare'); };
      const git = await inspectGitIdentity(store.root);
      if (git.head !== gitAudit.git.audited_head || git.format !== gitAudit.git.object_format) changed();
      for (const [path, before] of initialEntries) {
        if (!same(before, actual.get(path))) changed();
        if (before.kind === 'file' && !same(initial.identities[path], current.identities[path])) changed();
      }
      for (const file of current.files.filter(file => file.kind !== 'missing' && !initialEntries.has(file.path))) {
        if (file.kind === 'directory' && allowedDirectories.has(file.path)) continue;
        const raw = expected.get(file.path);
        if (!raw || file.kind !== 'file' || file.byte_length !== raw.length || file.sha256 !== sha256(raw)) changed();
      }
      for (const path of published) if (actual.get(path)?.kind !== 'file') changed();
      return current;
    }
    await onBoundary({ phase: 'original_verified', transaction_id: binding.transaction_id });
    await guard();
    const entries = []; let intent = null;
    async function publishEvidence(value, phase) {
      const path = evidencePath(value); expect(path, jsonBytes(value)); await guard();
      await onBoundary({ phase: `${phase}:before`, path }); await guard();
      await evidence.publish(value, { gate, context: { owner, inputs, intent, prefix: entries } });
      published.add(path); await guard();
      await onBoundary({ phase: `${phase}:after`, path });
      await guard();
    }
    async function journal(changes, phase) {
      const previous = entries.at(-1);
      const payload = previous ? { ...structuredClone(previous.payload), ...changes,
        sequence: entries.length + 1, previous_entry_hash: previous.hash } : {
        binding, sequence: 1, previous_entry_hash: owner.hash, phase: 'PREPARING', resume_phase: null,
        authority: { gate: owner.payload.gate, recovery: null }, recorded_at: apply_time, apply_time,
        intent_hash: null, original_manifest: owner.payload.original_manifest, target_manifest: null,
        changed_paths: [], backup_refs: [], temp_refs: [], replaced_paths: [], restored_paths: [],
        before_state: owner.payload.before_state, consumed_state: null, id_consumed: false,
        terminal_state: null, history: null, error: null };
      const value = envelope('fn004-journal', payload);
      await publishEvidence(value, phase); entries.push(value);
    }
    await journal({}, 'preparing'); // Durable fixed time before any target/backup/temp.
    const original = { manifest: s.canonical_manifest, rawBytes: Object.fromEntries(owner.payload.original_manifest.files
      .map(file => [file.path, Buffer.from(initial.rawBytes[file.path])])) };
    const artifacts = await createPrepareArtifactPublisher(store.root,
      { gate, owner, inputs, original, apply_time, state_bytes: initial.rawBytes['staging/fn004-state.json'] }, { io });
    const payload = artifacts.intentPayload();
    await journal({ target_manifest: payload.target_manifest, changed_paths: payload.changed_paths }, 'target_bound');
    async function raw(path, phase) {
      // The expected bytes are captured by the publisher; expose only a copy
      // for the private ledger, never a caller-controlled ignore/skip set.
      const bytes = artifacts.bytes(path); expect(path, bytes); await guard();
      await onBoundary({ phase: `${phase}:before`, path }); await guard();
      await artifacts.publish(path); published.add(path); await guard();
      await onBoundary({ phase: `${phase}:after`, path });
      await guard();
    }
    for (const ref of payload.backup_refs) await raw(ref.path, 'backup');
    for (const key of ['decision', 'plan', 'approval', 'request']) await raw(payload.inputs[key].path, 'input');
    await journal({ backup_refs: payload.backup_refs }, 'backup_complete');
    const temps = [];
    for (const ref of payload.temp_refs) {
      await raw(ref.path, 'temp'); temps.push(ref);
      await journal({ temp_refs: [...temps] }, 'temp_checkpoint');
    }
    await guard();
    const candidate = envelope('fn004-intent', payload);
    await publishEvidence(candidate, 'intent'); intent = candidate;
    await journal({ intent_hash: intent.hash, target_manifest: payload.target_manifest, changed_paths: payload.changed_paths,
      backup_refs: payload.backup_refs, temp_refs: payload.temp_refs }, 'intent_bound');
    await journal({ phase: 'PREPARED' }, 'prepared');
    await guard();
    const historyContext = { owner, inputs, intent, original, bootstrap: initial.documents['staging/fn004-bootstrap.json'],
      records: s.histories, proofs: Object.entries(initial.documents).filter(([path]) =>
        /^staging\/transaction-proofs\/[^/]+\.json$/.test(path)).map(([, value]) => value) };
    return Object.freeze({ phase: 'PREPARED', apply_time, intent: structuredClone(intent), journal: structuredClone(entries),
      constructHistory: ({ applied_at }) => constructHistoryRecord({ ...historyContext, applied_at }) });
  } });
}

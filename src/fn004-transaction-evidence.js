import { canonicalJson } from './canonical-hash.js';
import { validateApproval, validateApplyRequest, approvalHash, approvalDecision, initialProcessing,
  receiptHash } from './fn004-approval-schema.js';
import { validateDecisionRevision } from './fn004-decision-core.js';
import { validateApplyPlan } from './fn004-plan-validator.js';
import { deriveConsumedState } from './fn004-state.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { expectedHistoryAllocationRanges } from './fn004-history-verify.js';
import { validateEvidenceEnvelope } from './fn004-evidence-hash.js';
import { validateMutexProof } from './fn004-evidence-ownership.js';
import { validateErrorEvidence } from './fn004-evidence-errors.js';
import { closed, check, binding, timestamp, state, manifest, nullable, same, hash, integer,
  ordered, artifactRef, gateWitness, pathSubsequence, COMMIT_PATHS, PHASES, TERMINAL_PHASES } from './fn004-evidence-types.js';

export function validateEvidenceInputs(b, inputs) {
  closed(inputs, ['decision', 'plan', 'approval', 'request']); binding(b);
  const { decision, plan, approval, request } = inputs;
  validateDecisionRevision(decision); validateApplyPlan(plan, { decision }); validateApproval(approval);
  closed(request, ['schema_version', 'receipt']);
  const envelope = { ...request, receipt_hash: receiptHash(request), processing: initialProcessing() };
  validateApplyRequest(envelope);
  const r = request.receipt;
  check(plan.payload.applicability.applicable === true, 'Accepted evidence references a blocked Plan');
  check(same(b.decision, { decision_id: decision.decision_id, revision: decision.revision, content_hash: decision.content_hash }) &&
    decision.status === 'confirmed' && same(b.decision, approvalDecision(approval)) &&
    b.plan_id === plan.plan_id && b.plan_hash === plan.plan_hash &&
    b.approval_id === approval.approval_id && b.approval_hash === approvalHash(approval) &&
    b.receipt_hash === envelope.receipt_hash && approval.intended_request_id === b.request_id &&
    approval.plan_id === b.plan_id && approval.plan_hash === b.plan_hash &&
    same(b.actor, approval.actor) && approval.repository_instance_id === b.repository_instance_id &&
    plan.payload.repository_instance_id === b.repository_instance_id && plan.payload.bootstrap_hash === b.bootstrap_hash,
  'Evidence input identity mismatch');
  for (const key of ['repository_instance_id', 'transaction_id', 'request_id', 'apply_id', 'decision',
    'plan_id', 'plan_hash', 'approval_id', 'approval_hash', 'request_payload_hash', 'actor']) {
    check(same(b[key], r[key]), `Binding/Receipt mismatch: ${key}`);
  }
  return inputs;
}

export function validateOwner(value, inputs) {
  check(inputs !== undefined && inputs !== null, 'Owner validation requires immutable input snapshots');
  const p = validateEvidenceEnvelope(value, 'fn004-owner');
  closed(p, ['binding', 'gate', 'before_state', 'original_manifest', 'accepted_at']);
  binding(p.binding); gateWitness(p.gate); state(p.before_state); manifest(p.original_manifest); timestamp(p.accepted_at);
  check(p.before_state.pending_transaction === null && p.before_state.repository_instance_id === p.binding.repository_instance_id &&
    p.before_state.bootstrap_hash === p.binding.bootstrap_hash, 'Invalid Owner before state');
  if (inputs !== undefined) {
    validateEvidenceInputs(p.binding, inputs);
    const plan = inputs.plan.payload;
    check(p.accepted_at === inputs.request.receipt.requested_at && same(p.original_manifest, plan.canonical_precondition) &&
      same(plan.id_state_precondition, { schema_version: 1, state_hash: p.before_state.state_hash,
        generation: p.before_state.generation, high_water_marks: p.before_state.high_water_marks, pending_transaction: null }),
    'Owner does not bind accepted preconditions');
  }
  return value;
}

export function validateAuthority(value) {
  closed(value, ['gate', 'recovery']); gateWitness(value.gate);
  nullable(value.recovery, validateMutexProof);
}

function refs(values, paths) {
  ordered(values, value => value.path);
  for (const ref of values) { artifactRef(ref); check(paths.includes(ref.path), 'Reference outside transaction namespace'); }
}

export function transactionPaths(b) {
  const root = `staging/transactions/${b.transaction_id}`;
  return { root,
    backups: [...CANONICAL_TABLES.map(t => `${root}/backup/${t.path}`), `${root}/backup/fn004-state.json`].sort(),
    temps: COMMIT_PATHS.map(path => `${root}/temp/${path}`),
    inputs: { plan: `${root}/plan.json`, decision: `${root}/decision-snapshot.json`,
      approval: `${root}/approval.json`, request: `${root}/request.json` } };
}

function changed(paths) { pathSubsequence(paths, COMMIT_PATHS); }

export function allocationRanges(plan, before, transactionId) {
  return expectedHistoryAllocationRanges({ transaction_id: transactionId,
    id_mappings: plan.payload.planned_id_mappings.map(mapping => ({ ...mapping, canonical_id: mapping.planned_id })) }, before);
}

export function validateIntent(value, { owner, inputs } = {}) {
  check(owner !== undefined && inputs !== undefined && inputs !== null, 'Intent validation requires Owner/input snapshots');
  const p = validateEvidenceEnvelope(value, 'fn004-intent');
  closed(p, ['binding', 'owner_hash', 'apply_time', 'original_manifest', 'target_manifest', 'before_state',
    'expected_consumed_state', 'allocation_ranges', 'changed_paths', 'backup_refs', 'temp_refs', 'inputs']);
  binding(p.binding); timestamp(p.apply_time); manifest(p.original_manifest); manifest(p.target_manifest);
  state(p.before_state); state(p.expected_consumed_state); changed(p.changed_paths);
  check(hash(p.owner_hash) && Array.isArray(p.allocation_ranges), 'Invalid Intent owner/ranges');
  ordered(p.allocation_ranges, range => range.namespace);
  for (const range of p.allocation_ranges) {
    closed(range, ['transaction_id', 'namespace', 'first', 'last']);
    check(range.transaction_id === p.binding.transaction_id && Object.hasOwn(p.before_state.high_water_marks, range.namespace) &&
      integer(range.first, 1) && integer(range.last, range.first) && range.last <= 99999 &&
      range.first === p.before_state.high_water_marks[range.namespace] + 1, 'Invalid Intent allocation range');
  }
  const paths = transactionPaths(p.binding);
  refs(p.backup_refs, paths.backups); refs(p.temp_refs, paths.temps);
  check(same(p.backup_refs.map(r => r.path), paths.backups) &&
    same(p.temp_refs.map(r => r.path), p.changed_paths.map(path => `${paths.root}/temp/${path}`).sort()),
  'Incomplete Intent prepare references');
  for (const file of p.original_manifest.files) {
    const ref = p.backup_refs.find(ref => ref.path === `${paths.root}/backup/${file.path}`);
    check(ref.byte_length === file.byte_length && ref.sha256 === file.sha256, 'Backup reference differs from original manifest');
  }
  for (const ref of p.temp_refs) {
    const file = p.target_manifest.files.find(file => file.path === ref.path.slice(`${paths.root}/temp/`.length));
    check(file && ref.byte_length === file.byte_length && ref.sha256 === file.sha256, 'Temp reference differs from target manifest');
  }
  closed(p.inputs, ['plan', 'decision', 'approval', 'request']);
  for (const key of Object.keys(p.inputs)) { artifactRef(p.inputs[key]); check(p.inputs[key].path === paths.inputs[key], 'Invalid input copy path'); }
  const actualChanged = COMMIT_PATHS.filter(path => !same(p.original_manifest.files.find(f => f.path === path),
    p.target_manifest.files.find(f => f.path === path)));
  check(same(p.changed_paths, actualChanged) && p.original_manifest.files.every(f => COMMIT_PATHS.includes(f.path) ||
    same(f, p.target_manifest.files.find(t => t.path === f.path))), 'Intent changed paths/readonly table mismatch');
  check(same(p.expected_consumed_state, deriveConsumedState(p.before_state, p.binding.transaction_id, p.allocation_ranges)),
    'Intent expected consumed transition mismatch');
  if (owner !== undefined) {
    validateOwner(owner, inputs);
    check(p.owner_hash === owner.hash && same(p.binding, owner.payload.binding) &&
      same(p.before_state, owner.payload.before_state) && same(p.original_manifest, owner.payload.original_manifest),
    'Intent/Owner mismatch');
  }
  if (inputs !== undefined) {
    validateEvidenceInputs(p.binding, inputs);
    check(same(p.allocation_ranges, allocationRanges(inputs.plan, p.before_state, p.binding.transaction_id)), 'Intent/Plan range mismatch');
  }
  return value;
}

// Individual shape validation; complete prefix/Intent consistency is checked separately.
export function validateJournalEntry(value) {
  const p = validateEvidenceEnvelope(value, 'fn004-journal');
  closed(p, ['binding', 'sequence', 'previous_entry_hash', 'phase', 'resume_phase', 'authority', 'recorded_at',
    'apply_time', 'intent_hash', 'original_manifest', 'target_manifest', 'changed_paths', 'backup_refs', 'temp_refs',
    'replaced_paths', 'restored_paths', 'before_state', 'consumed_state', 'id_consumed', 'terminal_state', 'history', 'error']);
  binding(p.binding); validateAuthority(p.authority); timestamp(p.recorded_at); timestamp(p.apply_time);
  check(integer(p.sequence, 1) && hash(p.previous_entry_hash) && PHASES.includes(p.phase) &&
    (p.intent_hash === null || hash(p.intent_hash)) && typeof p.id_consumed === 'boolean', 'Invalid journal fields');
  check(p.phase === 'RECOVERY_REQUIRED' ? PHASES.includes(p.resume_phase) &&
    p.resume_phase !== 'RECOVERY_REQUIRED' && !TERMINAL_PHASES.includes(p.resume_phase) && p.error !== null :
    p.resume_phase === null, 'Invalid resume phase');
  manifest(p.original_manifest); nullable(p.target_manifest, manifest); changed(p.changed_paths);
  const paths = transactionPaths(p.binding); refs(p.backup_refs, paths.backups); refs(p.temp_refs, paths.temps);
  pathSubsequence(p.replaced_paths, p.changed_paths, { prefix: true });
  pathSubsequence(p.restored_paths, p.changed_paths, { reverse: true });
  state(p.before_state); nullable(p.consumed_state, state); nullable(p.terminal_state, state);
  check(TERMINAL_PHASES.includes(p.phase) === (p.terminal_state !== null), 'Invalid terminal state presence');
  if (p.history !== null) { closed(p.history, ['record']); validateHistoryRecord(p.history.record); }
  if (p.error !== null) {
    validateErrorEvidence(p.error);
  }
  canonicalJson(value);
  return value;
}

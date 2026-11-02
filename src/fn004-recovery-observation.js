import { hashCanonicalJson } from './canonical-hash.js';
import { validateGitAuditIdentity, validateNamespaceMap } from './fn004-state.js';
import { validateApplyRequest, receiptHash } from './fn004-approval-schema.js';
import { validateDiagnostics } from './fn004-evidence-errors.js';
import { closed, check, hash, integer, binding, manifest, nullable, ordered, observedPath,
  processOwner, journalRef, PHASES, uuid } from './fn004-evidence-types.js';

export function validateObservedEvidence(evidence) {
  closed(evidence, ['repository_instance_id', 'bootstrap_hash', 'transaction_id', 'request_id', 'files',
    'canonical_manifest', 'state_hash', 'history_head_hash', 'git_audit', 'historical_maxima', 'journal_head',
    'journal_phase', 'terminal_proof_hash', 'completion_hash', 'effective_owner', 'owner_status',
    'input_revalidation', 'consistency']);
  check(typeof evidence.repository_instance_id === 'string' && evidence.repository_instance_id.startsWith('repo_') &&
    uuid(evidence.repository_instance_id.slice(5)) && hash(evidence.bootstrap_hash) && uuid(evidence.request_id) &&
    typeof evidence.transaction_id === 'string' && evidence.transaction_id.startsWith('tx_') && uuid(evidence.transaction_id.slice(3)),
  'Invalid observed identity');
  ordered(evidence.files, file => file.path);
  for (const file of evidence.files) {
    closed(file, ['path', 'kind', 'byte_length', 'sha256']); observedPath(file.path);
    check(['file', 'directory', 'missing', 'symlink', 'other'].includes(file.kind) &&
      (file.kind === 'file' ? integer(file.byte_length) && hash(file.sha256) :
        file.byte_length === null && file.sha256 === null), 'Invalid observed file');
  }
  nullable(evidence.canonical_manifest, manifest); nullable(evidence.git_audit, validateGitAuditIdentity);
  nullable(evidence.historical_maxima, validateNamespaceMap); nullable(evidence.journal_head, journalRef);
  nullable(evidence.effective_owner, processOwner);
  check(['state_hash', 'history_head_hash', 'terminal_proof_hash', 'completion_hash']
    .every(key => evidence[key] === null || hash(evidence[key])) &&
    (evidence.journal_phase === null || PHASES.includes(evidence.journal_phase)) &&
    ['live', 'exited', 'unverifiable', 'none'].includes(evidence.owner_status) &&
    ['valid', 'stale', 'unavailable'].includes(evidence.input_revalidation) &&
    ['stable', 'raced'].includes(evidence.consistency), 'Invalid observed summary');
  check((evidence.git_audit === null) === (evidence.historical_maxima === null), 'Incomplete Git audit pair');
  return evidence;
}

export function observationProjectionV2({ binding: b, evidence, requests }) {
  binding(b); validateObservedEvidence(evidence);
  check(['repository_instance_id', 'bootstrap_hash', 'transaction_id', 'request_id'].every(key => evidence[key] === b[key]),
    'Observation/Binding mismatch');
  const sorted = [...requests].sort((a, b) => a.receipt.request_id < b.receipt.request_id ? -1 : 1);
  sorted.forEach(request => validateApplyRequest(request));
  ordered(sorted, request => request.receipt.request_id);
  const files = evidence.files.filter(file => !/^staging\/transactions\/tx_[0-9a-f-]{36}\/transaction\.json$/.test(file.path) &&
    !/^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(file.path));
  return { schema_version: 2, kind: 'fn004-recovery-observation', binding: b,
    requests: sorted.map(request => ({ request_id: request.receipt.request_id, receipt_hash: receiptHash(request) })),
    evidence: { ...evidence, files } };
}

export const observationHashV2 = input => hashCanonicalJson(observationProjectionV2(input));

export function validateRecoveryObservation(value) {
  closed(value, ['schema_version', 'binding', 'evidence', 'observed_state_hash', 'classification', 'allowed_actions', 'readiness', 'diagnostics']);
  binding(value.binding); validateObservedEvidence(value.evidence); validateDiagnostics(value.diagnostics);
  const actions = { abortable: 'abort', rollbackable: 'rollback', decidable_success: 'finalize_success',
    finalizable: 'finalize_success', terminal_incomplete: 'finish_terminal', cleanup_only: 'cleanup',
    active: null, terminal: null, manual_stop: null };
  check(value.schema_version === 2 && hash(value.observed_state_hash) && Object.hasOwn(actions, value.classification) &&
    Array.isArray(value.allowed_actions) && value.allowed_actions.length === (actions[value.classification] === null ? 0 : 1) &&
    (value.allowed_actions.length === 0 || value.allowed_actions[0] === actions[value.classification]) &&
    ['initialized', 'cleanup_required', 'recovery_required', 'blocked'].includes(value.readiness) &&
    ['repository_instance_id', 'bootstrap_hash', 'transaction_id', 'request_id'].every(key => value.binding[key] === value.evidence[key]),
  'Invalid Recovery observation/result');
  return value;
}

export function validateRecoveryCommand(command) {
  closed(command, ['schema_version', 'request_id', 'transaction_id', 'expected_observed_state_hash', 'action']);
  check(command.schema_version === 2 && uuid(command.request_id) &&
    typeof command.transaction_id === 'string' && command.transaction_id.startsWith('tx_') && uuid(command.transaction_id.slice(3)) &&
    hash(command.expected_observed_state_hash) && ['abort', 'rollback', 'finalize_success', 'finish_terminal', 'cleanup'].includes(command.action),
  'Unsupported Recovery command/version');
  return command;
}

// Readonly stale-token predicate only; it does not implement Recovery run.
export function matchesRecoveryObservation(command, observation) {
  validateRecoveryCommand(command);
  validateRecoveryObservation(observation);
  return observation.schema_version === 2 && command.request_id === observation.binding.request_id &&
    command.transaction_id === observation.binding.transaction_id &&
    command.expected_observed_state_hash === observation.observed_state_hash &&
    observation.allowed_actions.length === 1 && observation.allowed_actions[0] === command.action;
}

import { validateEvidenceEnvelope } from './fn004-evidence-hash.js';
import { validateOwner, validateAuthority } from './fn004-transaction-evidence.js';
import { validateJournalChain } from './fn004-journal-chain.js';
import { validateDiagnostics } from './fn004-evidence-errors.js';
import { closed, check, same, binding, state, manifest, timestamp, hash, journalRef,
  nullable, TERMINAL_PHASES } from './fn004-evidence-types.js';

export function validateTerminalProof(value, { histories = [] } = {}) {
  const p = validateEvidenceEnvelope(value, 'fn004-terminal-proof');
  closed(p, ['binding', 'owner', 'inputs', 'intent', 'journal', 'phase', 'before_state',
    'consumed_state', 'after_state', 'final_manifest', 'history', 'authority', 'ended_at', 'diagnostics']);
  binding(p.binding); validateOwner(p.owner, p.inputs); validateAuthority(p.authority);
  timestamp(p.ended_at); validateDiagnostics(p.diagnostics); state(p.before_state);
  nullable(p.consumed_state, state); state(p.after_state); manifest(p.final_manifest);
  check(TERMINAL_PHASES.includes(p.phase) && same(p.binding, p.owner.payload.binding) &&
    same(p.before_state, p.owner.payload.before_state) && same(p.authority.gate, p.owner.payload.gate),
  'Invalid terminal identity/authority');
  if (p.authority.recovery !== null) check(same(p.authority.recovery.anchor.payload.binding, p.binding) &&
    same(p.authority.recovery.anchor.payload.gate, p.authority.gate), 'Foreign terminal authority');
  const chain = validateJournalChain({ owner: p.owner, intent: p.intent, entries: p.journal, inputs: p.inputs });
  check(same(chain.entries, p.journal), 'Proof journal array is not in canonical sequence order');
  const head = chain.head?.payload;
  if (head) {
    check(head.phase === p.phase && same(head.authority, p.authority) && head.recorded_at === p.ended_at &&
      same(head.terminal_state, p.after_state) && same(head.before_state, p.before_state), 'Proof/terminal journal mismatch');
    check(same(p.consumed_state, head.id_consumed ? p.intent.payload.expected_consumed_state : null),
      'Proof actual consumption differs from terminal evidence');
  } else {
    check(p.phase === 'ABORTED' && p.intent === null && p.consumed_state === null &&
      same(p.before_state, p.after_state), 'Only receipt-only ABORTED may omit journal');
  }
  if (p.phase === 'COMPLETED') {
    check(p.history !== null && head && same(p.history, head.history.record) &&
      same(p.final_manifest, p.intent.payload.target_manifest), 'Successful proof/History/target mismatch');
  } else {
    check(p.history === null && same(p.final_manifest, p.owner.payload.original_manifest) &&
      !histories.some(record => record.payload.transaction_id === p.binding.transaction_id ||
        record.payload.apply_id === p.binding.apply_id || record.payload.request.request_id === p.binding.request_id),
    'Failed proof conflicts with successful History');
  }
  return value;
}

export function validateCompletion(value, proof) {
  const p = validateEvidenceEnvelope(value, 'fn004-completion');
  closed(p, ['binding', 'phase', 'proof_hash', 'terminal_journal', 'ended_at', 'diagnostics', 'result']);
  binding(p.binding); timestamp(p.ended_at); validateDiagnostics(p.diagnostics); nullable(p.terminal_journal, journalRef);
  check(hash(p.proof_hash) && TERMINAL_PHASES.includes(p.phase), 'Invalid Completion');
  check(proof !== null && proof !== undefined, 'Completion without required proof');
  validateTerminalProof(proof);
  const original = proof.payload, head = original.journal.at(-1);
  const expectedRef = head ? { sequence: head.payload.sequence, entry_hash: head.hash } : null;
  const result = original.phase === 'COMPLETED' ? {
    apply_id: original.history.payload.apply_id, record_hash: original.history.record_hash } : null;
  check(p.proof_hash === proof.hash && same(p.binding, original.binding) && p.phase === original.phase &&
    p.ended_at === original.ended_at && same(p.diagnostics, original.diagnostics) &&
    same(p.terminal_journal, expectedRef) && same(p.result, result), 'Completion does not bind exact Proof');
  return value;
}

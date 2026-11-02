import { validateBootstrapRecord, validateFn004State, deriveConsumedState } from './fn004-state.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { validateHistoryChain, validateHistoryPlanPrefixes, historyPrefixPrecondition, buildHistoryIndexes } from './fn004-history-projections.js';
import { RepositoryError } from './persistence.js';
import { historyGenesisState } from './fn004-history-verify.js';
import { validateTerminalProof } from './fn004-terminal-evidence.js';
import { allocationRanges } from './fn004-transaction-evidence.js';
import { terminalStateForEntry } from './fn004-journal-chain.js';
import { check, same } from './fn004-evidence-types.js';

// Additional pure profile only. Ordinary success-only reader guards are unchanged.
export function proveTerminalHistory({ bootstrap, records, proofs }) {
  validateBootstrapRecord(bootstrap);
  const identity = { repository_instance_id: bootstrap.payload.repository_instance_id, bootstrap_hash: bootstrap.bootstrap_hash };
  records.forEach(validateHistoryRecord);
  const histories = validateHistoryPlanPrefixes(validateHistoryChain(records, identity), identity);
  buildHistoryIndexes(histories, identity);
  const edges = [], zeroChanges = [], txs = new Set(), requests = new Set(), applies = new Set();
  for (const proof of proofs) {
    validateTerminalProof(proof, { histories });
    const p = proof.payload, b = p.binding;
    const expectedPrefix = historyPrefixPrecondition(histories.slice(0, p.before_state.history.count), identity);
    if (!same(p.inputs.plan.payload.history_precondition, expectedPrefix)) throw new RepositoryError('HISTORY_CHAIN_MISMATCH', 'Terminal Plan History prefix mismatch');
    check(b.repository_instance_id === identity.repository_instance_id && b.bootstrap_hash === identity.bootstrap_hash &&
      !txs.has(b.transaction_id) && !requests.has(b.request_id) && !applies.has(b.apply_id), 'Duplicate/foreign terminal proof');
    txs.add(b.transaction_id); requests.add(b.request_id); applies.add(b.apply_id);
    if (p.phase === 'COMPLETED') check(histories.some(record => same(record, p.history)), 'Successful proof has no exact History original');
    else if (p.consumed_state === null) zeroChanges.push(proof);
    else edges.push({ before: p.before_state, after: p.after_state, history: null });
  }
  for (const record of histories) {
    const p = record.payload, before = p.state_transition.before;
    const ranges = allocationRanges(record.plan_snapshot, before, p.transaction_id);
    const consumed = deriveConsumedState(before, p.transaction_id, ranges);
    check(same(ranges, p.state_transition.allocation_ranges) && same(consumed, p.state_transition.consumed), 'Unproven History consumption');
    edges.push({ before, after: terminalStateForEntry({ phase: 'COMPLETED', consumed_state: consumed, history: { record } }), history: record });
  }
  let terminal = historyGenesisState(bootstrap), historyCount = 0;
  const checkpoints = [terminal];
  edges.sort((a, b) => a.before.generation - b.before.generation);
  for (const edge of edges) {
    validateFn004State(edge.before); validateFn004State(edge.after);
    if (edge.before.generation > terminal.generation) throw new RepositoryError('STATE_TRANSITION_PROOF_REQUIRED', 'Missing terminal state edge');
    check(same(edge.before, terminal) && edge.after.generation === terminal.generation + 2, 'Terminal state edge fork/conflict');
    if (edge.history !== null) check(edge.history.payload.sequence === ++historyCount, 'Failure edge advanced History');
    terminal = edge.after; checkpoints.push(terminal);
  }
  for (const proof of zeroChanges) if (!checkpoints.some(checkpoint => same(checkpoint, proof.payload.before_state) &&
    same(checkpoint, proof.payload.after_state))) throw new RepositoryError('STATE_TRANSITION_PROOF_REQUIRED', 'Unproven zero-change checkpoint');
  return { terminal, checkpoints, histories };
}

import { materializeCanonicalTarget, materializedOperationRow } from './fn004-target-materialization.js';
import { validateIntent } from './fn004-transaction-evidence.js';
import { validateStoredSuccessfulPlan } from './fn004-history-plan.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { proveTerminalHistory } from './fn004-terminal-history.js';
import { historyRecordHash, historyPrefixPrecondition, validateHistoryChain, buildHistoryIndexes } from './fn004-history-projections.js';
import { rowHash, compareKeys } from './fn004-history-schema.js';
import { check, same, timestamp, compareTimestamps } from './fn004-evidence-types.js';
import { canonicalJson } from './canonical-hash.js';

// Candidate record only: the caller binds applied_at once at the future first
// COMMIT_DECIDED publication intent. Preparing this value is not success evidence.
// This module has no IO, state writer or History publisher.
export async function constructHistoryRecord({ owner, intent, inputs, original, bootstrap, records, proofs, applied_at }) {
  ({ owner, intent, inputs, bootstrap, records, proofs, applied_at } = JSON.parse(canonicalJson({ owner, intent, inputs, bootstrap, records, proofs, applied_at })));
  validateIntent(intent, { owner, inputs }); timestamp(applied_at);
  const p = intent.payload, b = p.binding;
  check(compareTimestamps(p.apply_time, applied_at) <= 0, 'History precedes fixed apply_time');
  const profile = proveTerminalHistory({ bootstrap, records, proofs });
  const identity = { repository_instance_id: b.repository_instance_id, bootstrap_hash: b.bootstrap_hash };
  check(same(profile.terminal, p.before_state) && same(inputs.plan.payload.history_precondition,
    historyPrefixPrecondition(profile.histories, identity)), 'History construction prefix/checkpoint mismatch');
  const materialized = await materializeCanonicalTarget({ owner, inputs, original, apply_time: p.apply_time });
  check(same(materialized.target.manifest, p.target_manifest), 'History target differs from Intent');
  const verifiedPlan = validateStoredSuccessfulPlan(inputs.plan, inputs.decision), plan = inputs.plan.payload;
  const payload = { schema_version: 1, ...identity, sequence: p.before_state.history.count + 1,
    previous_history_hash: p.before_state.history.head_hash, apply_id: b.apply_id, transaction_id: b.transaction_id,
    decision: b.decision, plan: { plan_id: b.plan_id, plan_hash: b.plan_hash },
    approval: { approval_id: b.approval_id, approval_hash: b.approval_hash },
    request: { request_id: b.request_id, request_payload_hash: b.request_payload_hash }, actor: b.actor,
    candidate_coverage: inputs.decision.candidate_bindings.map(binding => ({ candidate_id: binding.candidate_id,
      source_identity: binding.source_identity, fingerprint: binding.fingerprint,
      work_id: verifiedPlan.resolve(binding.work), song_id: verifiedPlan.resolve(binding.song),
      release_track_keys: binding.release_track_refs.map(ref => plan.operations.find(operation =>
        operation.table === 'release_tracks' && operation.source.subject.ref === ref).key)
        .sort((a, b) => compareKeys('release_tracks', a, b)) })),
    id_mappings: plan.planned_id_mappings.map(({ planned_id, ...mapping }) => ({ ...mapping, canonical_id: planned_id })),
    results: plan.operations.map(operation => {
      const row = materializedOperationRow(operation, p.apply_time);
      return { operation_id: operation.operation_id, classification: operation.classification, table: operation.table,
        key: operation.key, row, row_hash: rowHash(operation.table, row) };
    }), before_manifest: p.original_manifest, after_manifest: p.target_manifest,
    state_transition: { before: p.before_state, consumed: p.expected_consumed_state, allocation_ranges: p.allocation_ranges },
    apply_time: p.apply_time, applied_at, rules: { plan: plan.rules, transaction: 1, history_record: 1,
      history_hash: 1, history_chain: 1, history_set: 1, state_proof: 1 } };
  const record = { schema_version: 1, payload, record_hash: historyRecordHash(payload),
    decision_snapshot: structuredClone(inputs.decision), plan_snapshot: structuredClone(inputs.plan), metadata: { published_at: applied_at } };
  validateHistoryRecord(record);
  buildHistoryIndexes(validateHistoryChain([...profile.histories, record], identity), identity);
  return structuredClone(record);
}

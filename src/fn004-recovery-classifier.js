import { recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { same, TERMINAL_PHASES } from './fn004-evidence-types.js';
import { terminalStateForEntry } from './fn004-journal-chain.js';
import { validateRecoveryObservation } from './fn004-recovery-observation.js';

const classifications = Object.freeze({ abort: 'abortable', rollback: 'rollbackable',
  finalize_success: 'finalizable', finish_terminal: 'terminal_incomplete', cleanup: 'cleanup_only' });
const blocked = code => !['RECOVERY_REQUIRED', 'STATE_TRANSITION_PROOF_REQUIRED', 'GATE_BUSY',
  'GATE_CORRUPT', 'GATE_ACQUIRE_FAILED', 'GATE_OWNERSHIP_MISMATCH', 'GATE_RELEASE_FAILED'].includes(code);

// Pure decision only. All IO, OS/Git probes, byte validation and regeneration
// occur before construction of this immutable validated input. No action executes.
export function classifyRecoverySnapshot(snapshot) {
  const s = recoverySnapshotData(snapshot), e = s.base.evidence;
  const codes = new Set(s.diagnostics.map(diagnostic => diagnostic.code));
  const mixedException = s.provenance?.mixed && e.input_revalidation !== 'unavailable';
  const blockingCodes = () => [...codes].filter(code => !(mixedException && s.semantic_codes.includes(code)));
  const result = (classification, action, readiness, code = null) => {
    if (code) codes.add(code);
    return validateRecoveryObservation({ ...s.base, classification, allowed_actions: action === null ? [] : [action], readiness,
      diagnostics: [...codes].sort().map(code => ({ code })) });
  };
  const stop = (code = 'RECOVERY_REQUIRED') => result('manual_stop', null,
    (code === null ? blockingCodes() : [...blockingCodes(), code]).some(blocked) ? 'blocked' : 'recovery_required', code);
  if (blockingCodes().some(blocked)) return stop(null);
  if (blockingCodes().length > 0) return blockingCodes().length === 1 && codes.has('GATE_BUSY') ?
    result('active', null, 'recovery_required') : stop(null);
  if (e.consistency !== 'stable' || e.git_audit === null || e.historical_maxima === null) return stop();
  if (!s.owner || !s.chain || !s.state || !s.canonical_manifest) return stop();
  const owner = s.owner.payload, head = s.chain.head?.payload ?? null;
  const phase = head?.phase === 'RECOVERY_REQUIRED' ? head.resume_phase : head?.phase ?? null;
  const original = same(s.canonical_manifest, owner.original_manifest);
  const target = s.intent !== null && same(s.canonical_manifest, s.intent.payload.target_manifest);
  const before = same(s.state, owner.before_state);
  const consumed = s.intent !== null && same(s.state, s.intent.payload.expected_consumed_state);
  const noop = s.intent !== null && s.intent.payload.changed_paths.length === 0;
  const known = s.canonical_manifest.files.every(file => {
    const originalFile = owner.original_manifest.files.find(value => value.path === file.path);
    const targetFile = s.intent?.payload.target_manifest.files.find(value => value.path === file.path);
    return same(file, originalFile) || targetFile !== undefined && same(file, targetFile);
  });
  const semanticComplete = s.proof !== null && s.completion !== null;
  // Historical terminal validation never equates an old final manifest with the
  // current canonical after later legitimate transactions/edits.
  if (semanticComplete && !s.cleanup_required && same(s.state, s.profile_terminal)) {
    return result('terminal', null, 'initialized');
  }
  if (!known) return stop('INTEGRITY_CONFLICT');
  if (head?.id_consumed && before) return stop('INTEGRITY_CONFLICT');
  let action = null, readiness = 'recovery_required';
  if (semanticComplete) {
    if (!same(s.state, s.proof.payload.after_state) || !same(s.canonical_manifest, s.proof.payload.final_manifest)) return stop('INTEGRITY_CONFLICT');
    if (!s.cleanup_required) return result('terminal', null, 'initialized');
    if (s.archive?.state === 'SEALED') return stop();
    action = 'cleanup'; readiness = 'cleanup_required';
  } else if (s.proof || s.proof_intent || head && TERMINAL_PHASES.includes(head.phase)) {
    const terminal = s.proof?.payload ?? s.proof_intent?.payload;
    const finalState = terminal?.after_state ?? head.terminal_state;
    const finalManifest = terminal?.final_manifest ?? (head.phase === 'COMPLETED' ? s.intent.payload.target_manifest : owner.original_manifest);
    if (!same(s.state, finalState) || !same(s.canonical_manifest, finalManifest)) return stop('INTEGRITY_CONFLICT');
    action = 'finish_terminal';
  } else if (s.chain.decision !== null) {
    if (!target) return stop('INTEGRITY_CONFLICT');
    const after = terminalStateForEntry({ phase: 'COMPLETED', consumed_state: s.intent.payload.expected_consumed_state,
      history: s.chain.decision });
    if (!(consumed || phase === 'HISTORY_COMMITTED' && same(s.state, after))) return stop('STATE_TRANSITION_PROOF_REQUIRED');
    action = 'finalize_success';
  } else if (['COMMITTING', 'ROLLING_BACK'].includes(phase)) {
    const failureAfter = terminalStateForEntry({ phase: 'ROLLED_BACK', id_consumed: true,
      consumed_state: s.intent.payload.expected_consumed_state });
    if (!(before || consumed || phase === 'ROLLING_BACK' && same(s.state, failureAfter))) return stop('STATE_TRANSITION_PROOF_REQUIRED');
    // Replacement follows consumption; failure-after follows complete restore.
    // A lagging journal does not permit actual state to lead either side effect.
    if (!original && (before || phase === 'ROLLING_BACK' && same(s.state, failureAfter))) return stop('INTEGRITY_CONFLICT');
    if (phase === 'ROLLING_BACK') action = 'rollback';
    else if (target && !noop && before) return stop('INTEGRITY_CONFLICT');
    else if (noop && before || !target) action = 'rollback';
    else if (!consumed) return stop('STATE_TRANSITION_PROOF_REQUIRED');
    else if (e.input_revalidation === 'valid') action = 'finalize_success';
    else if (e.input_revalidation === 'stale') action = 'rollback';
    else return stop();
  } else if (phase === null || ['PREPARING', 'PREPARED'].includes(phase)) {
    if (!original || !before || s.state.pending_transaction !== null) return stop('INTEGRITY_CONFLICT');
    action = 'abort';
  } else return stop();
  if (action !== 'cleanup' && (!s.gate || !same(s.gate, owner.gate))) return stop('GATE_OWNERSHIP_MISMATCH');
  if (action === 'cleanup' && s.gate !== null) {
    const expected = s.archive?.head.payload.gate ?? (s.archive ? null : owner.gate);
    if (expected !== null && !same(expected, s.gate)) return stop('GATE_OWNERSHIP_MISMATCH');
    if (expected === null) {
      const current = Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
        'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, s.gate.metadata[key]]));
      if (s.gate.metadata.operation !== 'recovery_cleanup' || !same(current, s.archive.head.payload.owner)) return stop('GATE_OWNERSHIP_MISMATCH');
    }
  }
  if (s.archive?.state === 'RETIRED' && s.gate !== null) return stop('GATE_CORRUPT');
  const selfOwned = s.self_owned === true;
  if (e.owner_status === 'live' && !selfOwned) return result('active', null, readiness, 'GATE_BUSY');
  if (!selfOwned && e.owner_status !== 'exited' && !(action === 'cleanup' && e.owner_status === 'none' && s.gate === null)) return stop();
  const classification = action === 'finalize_success' && phase === 'COMMITTING' ? 'decidable_success' : classifications[action];
  return result(classification, action, readiness, 'RECOVERY_REQUIRED');
}

import { hashState } from './fn004-state.js';
import { validateOwner, validateIntent, validateJournalEntry } from './fn004-transaction-evidence.js';
import { check, same, compareTimestamps, TERMINAL_PHASES, closed, binding, journalRef, COMMIT_PATHS } from './fn004-evidence-types.js';

const nextPhases = Object.freeze({ PREPARING: ['PREPARED', 'ABORTED'], PREPARED: ['COMMITTING', 'ABORTED'],
  COMMITTING: ['COMMIT_DECIDED', 'ROLLING_BACK'], COMMIT_DECIDED: ['HISTORY_COMMITTED'],
  HISTORY_COMMITTED: ['COMPLETED'], ROLLING_BACK: ['ROLLED_BACK'] });
const checkpoints = ['PREPARING', 'COMMITTING', 'ROLLING_BACK'];
const extendsRefs = (before, after) => before.every(ref => after.some(candidate => same(ref, candidate)));

export function validateJournalCache(value, { owner, entries }) {
  closed(value, ['schema_version', 'binding', 'head']); binding(value.binding); journalRef(value.head);
  check(value.schema_version === 1 && same(value.binding, owner.payload.binding) && entries.some(entry =>
    entry.payload.sequence === value.head.sequence && entry.hash === value.head.entry_hash), 'Invalid latest cache prefix reference');
  return value;
}

export function terminalStateForEntry(p) {
  if (p.phase === 'ABORTED' || (p.phase === 'ROLLED_BACK' && !p.id_consumed)) return p.before_state;
  check(p.consumed_state !== null, 'Missing expected consumed state');
  const after = structuredClone(p.consumed_state);
  after.generation++; after.pending_transaction = null;
  if (p.phase === 'COMPLETED') {
    const r = p.history?.record;
    check(r, 'Completed state has no History');
    after.history = { count: r.payload.sequence, head_hash: r.record_hash, last_apply_id: r.payload.apply_id };
  }
  after.state_hash = hashState(after);
  return after;
}

export function validateJournalChain({ owner, intent, entries, inputs }) {
  check(inputs !== undefined && inputs !== null && intent !== undefined, 'Journal validation requires complete input/Intent context');
  validateOwner(owner, inputs);
  if (intent !== null) validateIntent(intent, { owner, inputs });
  check(Array.isArray(entries), 'Missing journal set');
  entries.forEach(entry => validateJournalEntry(entry));
  const chain = [...entries].sort((a, b) => a.payload.sequence - b.payload.sequence);
  let previous = null, established = null, target = null, decision = null, committing = false;
  let recovery = null, consumed = false, rollback = false;
  for (let index = 0; index < chain.length; index++) {
    const entry = validateJournalEntry(chain[index]), p = entry.payload;
    check(p.sequence === index + 1 && p.previous_entry_hash === (previous?.hash ?? owner.hash), 'Journal gap/fork/duplicate/predecessor mismatch');
    check(same(p.binding, owner.payload.binding) && same(p.before_state, owner.payload.before_state) &&
      same(p.original_manifest, owner.payload.original_manifest) && same(p.authority.gate, owner.payload.gate),
    'Journal/Owner identity mismatch');
    check(compareTimestamps(p.apply_time, p.recorded_at) <= 0, 'Journal predates fixed apply time');
    if (index === 0) {
      check(p.phase === 'PREPARING' && p.apply_time === p.recorded_at && p.intent_hash === null &&
        p.target_manifest === null && !p.id_consumed && p.consumed_state === null &&
        p.terminal_state === null && p.history === null && ['changed_paths', 'backup_refs', 'temp_refs',
          'replaced_paths', 'restored_paths'].every(key => p[key].length === 0), 'Invalid journal genesis');
    } else {
      const prev = previous.payload;
      check(!TERMINAL_PHASES.includes(prev.phase), 'Journal appended after terminal');
      check(p.apply_time === prev.apply_time, 'Apply time changed');
      if (prev.phase === 'RECOVERY_REQUIRED') {
        check(p.phase === prev.resume_phase || (p.phase === 'RECOVERY_REQUIRED' && p.resume_phase === prev.resume_phase),
          'Recovery must resume the saved phase');
        check(p.authority.recovery !== null, 'Resume requires Recovery authority');
      } else if (p.phase === 'RECOVERY_REQUIRED') {
        check(p.resume_phase === prev.phase, 'Recovery resume policy changed');
      } else {
        check((p.phase === prev.phase && checkpoints.includes(p.phase)) || nextPhases[prev.phase]?.includes(p.phase),
          'Illegal journal phase transition');
      }
      check(extendsRefs(prev.backup_refs, p.backup_refs) && extendsRefs(prev.temp_refs, p.temp_refs), 'Prepare references shrank/changed');
      check(prev.replaced_paths.every((path, i) => p.replaced_paths[i] === path) &&
        prev.restored_paths.every((path, i) => p.restored_paths[i] === path), 'Journal progress regressed');
      if (p.replaced_paths.length > prev.replaced_paths.length) check(p.id_consumed &&
        ['COMMITTING', 'COMMIT_DECIDED'].includes(p.phase), 'Replacement progress at illegal phase');
      if (p.restored_paths.length > prev.restored_paths.length) check(p.phase === 'ROLLING_BACK', 'Restore progress at illegal phase');
    }
    if (p.authority.recovery !== null) {
      const proof = p.authority.recovery;
      check(same(proof.anchor.payload.binding, p.binding) && same(proof.anchor.payload.gate, owner.payload.gate), 'Foreign Recovery authority');
      if (recovery !== null) check(same(proof.anchor, recovery.anchor) && proof.claims.length >= recovery.claims.length &&
        recovery.claims.every((claim, i) => same(claim, proof.claims[i])), 'Recovery authority prefix regressed');
      recovery = proof;
    } else check(recovery === null, 'Recovery authority reverted to initial owner');
    if (established !== null) check(p.intent_hash === established, 'Established Intent hash changed/disappeared');
    if (p.intent_hash !== null) {
      check(intent !== null && p.intent_hash === intent.hash && p.apply_time === intent.payload.apply_time &&
        same(p.target_manifest, intent.payload.target_manifest) && same(p.changed_paths, intent.payload.changed_paths) &&
        same(p.backup_refs, intent.payload.backup_refs) && same(p.temp_refs, intent.payload.temp_refs), 'Intent binding mismatch/missing artifact');
      established = p.intent_hash;
    } else {
      const effective = p.phase === 'RECOVERY_REQUIRED' ? p.resume_phase : p.phase;
      check(['PREPARING', 'ABORTED'].includes(effective), 'Null Intent at forbidden phase');
      if (effective === 'ABORTED') check(intent === null, 'Pre-Intent terminal has an established Intent');
    }
    if (target !== null) check(same(p.target_manifest, target), 'Target manifest changed/disappeared');
    if (p.target_manifest !== null) target = p.target_manifest;
    else check(p.changed_paths.length === 0, 'Changed paths without target');
    if (target !== null) check(same(p.changed_paths, COMMIT_PATHS.filter(path =>
      !same(p.original_manifest.files.find(file => file.path === path), target.files.find(file => file.path === path)))) &&
      p.original_manifest.files.every(file => COMMIT_PATHS.includes(file.path) || same(file, target.files.find(value => value.path === file.path))),
    'Journal target/changed paths mismatch');
    const root = `staging/transactions/${p.binding.transaction_id}`;
    for (const ref of p.backup_refs.filter(ref => ref.path.startsWith(`${root}/backup/data/`))) {
      const file = p.original_manifest.files.find(file => ref.path === `${root}/backup/${file.path}`);
      check(file && ref.byte_length === file.byte_length && ref.sha256 === file.sha256, 'Journal backup differs from original');
    }
    for (const ref of p.temp_refs) {
      const file = target?.files.find(file => ref.path === `${root}/temp/${file.path}`);
      check(file && p.changed_paths.includes(file.path) && ref.byte_length === file.byte_length && ref.sha256 === file.sha256,
        'Journal temp differs from target');
    }
    check(!consumed || p.id_consumed, 'ID consumption checkpoint regressed');
    if (p.id_consumed && !consumed) check(p.phase === 'COMMITTING', 'Consumption requires COMMITTING confirmation');
    consumed ||= p.id_consumed;
    const effective = p.phase === 'RECOVERY_REQUIRED' ? p.resume_phase : p.phase;
    if (['PREPARING', 'PREPARED', 'ABORTED'].includes(effective)) {
      check(p.consumed_state === null && !p.id_consumed && p.replaced_paths.length === 0 &&
        p.restored_paths.length === 0 && p.history === null, 'Pre-commit phase contains mutation evidence');
    } else {
      check(intent !== null && same(p.consumed_state, intent.payload.expected_consumed_state), 'Expected consumption changed/missing');
    }
    if (effective === 'COMMITTING' && !committing) {
      check(!p.id_consumed && p.replaced_paths.length === 0 && p.restored_paths.length === 0, 'Invalid first COMMITTING');
      committing = true;
    }
    if (effective === 'ROLLING_BACK') { check(decision === null, 'Rollback after success decision'); rollback = true; }
    if (effective === 'COMMIT_DECIDED') {
      check(!rollback && p.id_consumed && p.history !== null && same(p.replaced_paths, p.changed_paths) &&
        p.restored_paths.length === 0, 'Invalid irreversible success evidence');
      const r = p.history.record, b = p.binding;
      check(r.payload.apply_time === p.apply_time && (p.phase !== 'COMMIT_DECIDED' || r.payload.applied_at === p.recorded_at) &&
        r.metadata.published_at === r.payload.applied_at && r.payload.transaction_id === b.transaction_id &&
        r.payload.apply_id === b.apply_id && r.payload.request.request_id === b.request_id &&
        r.payload.request.request_payload_hash === b.request_payload_hash && same(r.payload.decision, b.decision) &&
        r.payload.plan.plan_id === b.plan_id && r.payload.plan.plan_hash === b.plan_hash &&
        r.payload.approval.approval_id === b.approval_id && r.payload.approval.approval_hash === b.approval_hash &&
        same(r.payload.actor, b.actor) && same(r.payload.before_manifest, p.original_manifest) &&
        same(r.payload.after_manifest, p.target_manifest) && same(r.payload.state_transition.before, p.before_state) &&
        same(r.payload.state_transition.consumed, p.consumed_state) &&
        same(r.payload.state_transition.allocation_ranges, intent.payload.allocation_ranges) &&
        (inputs === undefined || same(r.plan_snapshot, inputs.plan) && same(r.decision_snapshot, inputs.decision)),
      'History intent/transaction binding mismatch');
      decision ??= p.history;
    }
    if (decision !== null) check(same(p.history, decision) && p.id_consumed &&
      same(p.replaced_paths, p.changed_paths) && p.restored_paths.length === 0 &&
      !['ROLLING_BACK', 'ROLLED_BACK', 'ABORTED'].includes(effective), 'Irreversible decision regressed');
    else check(p.history === null, 'History intent before decision');
    if (TERMINAL_PHASES.includes(p.phase)) check(same(p.terminal_state, terminalStateForEntry(p)), 'Terminal state transition mismatch');
    previous = entry;
  }
  if (intent !== null && established === null) check(chain.length > 0 &&
    (previous.payload.phase === 'PREPARING' || (previous.payload.phase === 'RECOVERY_REQUIRED' &&
      previous.payload.resume_phase === 'PREPARING')) && intent.payload.apply_time === chain[0].payload.apply_time,
  'Established Intent has incompatible unbound prefix');
  return { entries: chain, head: previous, intent_state: intent === null ? 'NOT_CREATED' : 'ESTABLISHED',
    intent_hash: intent?.hash ?? null, decision, rollback };
}

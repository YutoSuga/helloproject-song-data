import { materializeCanonicalTarget } from './fn004-target-materialization.js';
import { terminalStateForEntry } from './fn004-journal-chain.js';
import { currentIdMaxima, ID_NAMESPACES } from './fn004-id-audit.js';
import { check, same } from './fn004-evidence-types.js';
import { RepositoryError } from './persistence.js';

const prefix = (small, large) => small.every((value, i) => value === large[i]);
// Derived evidence only: never repairs bytes, invents artifacts or suppresses
// semantic diagnostics. All endpoints come from the saved inputs and fixed time.
export async function validateCanonicalProvenance({ owner, intent, inputs, original, canonical, rawBytes, chain,
  state, bootstrap, git_audit }) {
  if (!intent || !chain?.head || !original || !inputs || !state || !git_audit) return null;
  check(original.validation.ok, 'Original endpoint is not whole-valid');
  const materialized = await materializeCanonicalTarget({ owner, inputs, original, apply_time: intent.payload.apply_time });
  const target = materialized.target, p = intent.payload, root = `staging/transactions/${p.binding.transaction_id}`;
  check(same(target.manifest, p.target_manifest) && same(materialized.changed_paths, p.changed_paths), 'Target replay differs from immutable Intent');
  const head = chain.head.payload, phase = head.phase === 'RECOVERY_REQUIRED' ? head.resume_phase : head.phase;
  const members = canonical.manifest?.files.map(file => {
    const raw = rawBytes[file.path], o = materialized.original.rawBytes[file.path], t = target.rawBytes[file.path];
    return { path: file.path, original: !!raw && raw.equals(o), target: !!raw && raw.equals(t) };
  });
  check(members?.length === 14 && members.every(file => file.original || file.target), 'Unknown canonical bytes');
  const d = p.changed_paths, current = d.filter(path => members.find(file => file.path === path).target);
  const allOriginal = current.length === 0, allTarget = current.length === d.length;
  const mixed = !allOriginal && !allTarget;
  if (!['COMMITTING', 'ROLLING_BACK'].includes(phase) || chain.decision || chain.entries.some(entry =>
    ['ABORTED', 'ROLLED_BACK', 'COMPLETED'].includes(entry.payload.phase))) return { mixed: false };
  // Rollback requires complete original copies, not a later canonical reread.
  for (const file of owner.payload.original_manifest.files) {
    const backup = rawBytes[`${root}/backup/${file.path}`];
    check(backup && backup.equals(materialized.original.rawBytes[file.path]), 'Rollback original backup is incomplete or different');
  }
  const consumed = same(state, p.expected_consumed_state), before = same(state, owner.payload.before_state);
  const after = terminalStateForEntry({ phase: 'ROLLED_BACK', id_consumed: true, consumed_state: p.expected_consumed_state });
  check(consumed || allOriginal && (before && !head.id_consumed || phase === 'ROLLING_BACK' && same(state, after)),
    'Canonical/state publication order conflicts');
  if (phase === 'COMMITTING') {
    check(prefix(current, d) && prefix(head.replaced_paths, current), 'Actual commit bytes are not a valid replacement prefix');
    check(head.restored_paths.length === 0, 'Commit contains restoration progress');
  } else {
    const first = chain.entries.find(entry => entry.payload.phase === 'ROLLING_BACK');
    check(first, 'Missing durable rollback policy');
    const P = first.payload.replaced_paths;
    check(prefix(P, d) && prefix(current, P), 'Rollback bytes are outside the fixed replacement prefix');
    check(same(head.replaced_paths, P), 'Rollback replacement prefix changed');
    const actualRestored = P.slice(current.length).reverse();
    check(head.restored_paths.every(path => actualRestored.includes(path)), 'Recorded restoration is ahead of actual bytes');
    if (consumed || same(state, after)) check(head.id_consumed && chain.entries.some(entry =>
      entry.payload.phase === 'COMMITTING' && entry.payload.id_consumed), 'Rollback consumption confirmation is missing');
  }
  if (mixed) {
    check(consumed, 'Mixed canonical requires the exact consumed state');
    const o = currentIdMaxima(materialized.original), t = currentIdMaxima(target);
    if (!ID_NAMESPACES.every(n => state.high_water_marks[n] >= Math.max(o[n], t[n], git_audit.maxima[n], bootstrap.payload.high_water_marks[n]))) {
      throw new RepositoryError('STATE_HIGH_WATER_INVALID', 'Consumed state does not cover both validated endpoints');
    }
  }
  return { mixed, all_original: allOriginal, all_target: allTarget, target_paths: current };
}

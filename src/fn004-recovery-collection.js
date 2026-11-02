import { discoverEvidence } from './fn004-evidence-discovery.js';
import { auditGitIds } from './fn004-git-audit.js';
import { prepareRecoverySnapshot, recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { same } from './fn004-evidence-types.js';

// Internal readonly collection adapter, not a public CLI or Recovery run.
// The probe is trusted application/test infrastructure. Default lack of an OS
// termination proof deliberately yields unverifiable, never stale-PID takeover.
export async function collectRecoverySnapshot(root, binding, {
  discover = discoverEvidence, audit = auditGitIds, probeOwner = async () => null
} = {}) {
  async function collect() {
    const discovery = await discover(root), git_audit = await audit(root);
    const preliminary = await prepareRecoverySnapshot({ binding, discovery, git_audit, probe: null });
    const owner = recoverySnapshotData(preliminary).base.evidence.effective_owner;
    const probe = owner === null ? null : await probeOwner(owner);
    const snapshot = await prepareRecoverySnapshot({ binding, discovery, git_audit, probe });
    return { discovery, git_audit, probe, snapshot };
  }
  const first = await collect(), second = await collect();
  const physical = value => Object.fromEntries(['staging/.fn004.lock', 'staging/.fn004-recovery.lock']
    .map(path => [path, value.discovery.identities[path] ?? null]));
  const decision = snapshot => {
    const { observed_state_hash, classification, allowed_actions, readiness, diagnostics } = classifyRecoverySnapshot(snapshot);
    return { observed_state_hash, classification, allowed_actions, readiness, diagnostics };
  };
  if (same(decision(first.snapshot), decision(second.snapshot)) &&
    same(physical(first), physical(second))) return second.snapshot;
  return prepareRecoverySnapshot({ binding, discovery: second.discovery, git_audit: second.git_audit,
    probe: second.probe, consistency: 'raced' });
}

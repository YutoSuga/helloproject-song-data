import { createPersistence, RepositoryError } from './persistence.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { auditGitIds, inspectGitIdentity } from './fn004-git-audit.js';
import { prepareRecoverySnapshot, asInitialOwnedSnapshot, recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { canonicalJson } from './canonical-hash.js';
import { check } from './fn004-evidence-types.js';
import { recoveryProcessIdentity } from './fn004-recovery-process.js';

// Original-owner finalization is post-decision only. This is a live-lease
// adapter, not a second ownership protocol or normal commit dispatcher.
export async function originalSuccessAuthority(root, binding, gate, { io, audit = auditGitIds }) {
  const store = await createPersistence(root, { io });
  binding = JSON.parse(canonicalJson(binding));
  const gitAudit = await audit(store.root);
  check(gitAudit?.git, 'Original finalization requires a complete Git audit');
  const self = await recoveryProcessIdentity();
  let active = true, snapshot, discovery;
  async function refresh() {
    check(active, 'Original finalization context is revoked');
    const git = await inspectGitIdentity(store.root);
    if (git.head !== gitAudit.git.audited_head || git.format !== gitAudit.git.object_format) {
      throw new RepositoryError('RECOVERY_REQUIRED', 'Git identity changed during finalization');
    }
    discovery = await discoverEvidence(store.root, { io });
    snapshot = await asInitialOwnedSnapshot(await prepareRecoverySnapshot({ binding, discovery, git_audit: gitAudit,
      probe: {owner:self,observer:self,status:'live'} }), gate, store.root);
    return snapshot;
  }
  await refresh();
  const s = recoverySnapshotData(snapshot), o = classifyRecoverySnapshot(snapshot);
  check(s.chain?.decision && s.chain.head.payload.phase !== 'RECOVERY_REQUIRED' &&
    ['finalize_success','finish_terminal','cleanup'].includes(o.allowed_actions[0]),
  'Original finalizer requires an established success decision and its original live lease');
  // No mutable authority object is exposed; only copied discovery data and
  // closure-controlled liveness are visible to the internal executor.
  const session = Object.freeze({ get active() { return active; }, get discovery() {
    return { ...discovery, files: structuredClone(discovery.files), documents: structuredClone(discovery.documents),
      identities: structuredClone(discovery.identities), rawBytes: Object.fromEntries(Object.entries(discovery.rawBytes).map(([p,b])=>[p,Buffer.from(b)])) };
  } });
  return Object.freeze({ session, refresh, revoke: () => { active = false; }, snapshot,
    command: Object.freeze({ schema_version:2, request_id:binding.request_id, transaction_id:binding.transaction_id,
      expected_observed_state_hash:o.observed_state_hash, action:o.allowed_actions[0] }) });
}

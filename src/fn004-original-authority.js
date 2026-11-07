import { createPersistence, RepositoryError } from './persistence.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { auditGitIds, inspectGitIdentity } from './fn004-git-audit.js';
import { prepareRecoverySnapshot, asInitialOwnedSnapshot, recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { canonicalJson } from './canonical-hash.js';
import { check } from './fn004-evidence-types.js';
import { recoveryProcessIdentity } from './fn004-recovery-process.js';
import { confirmExistingBytes } from './fn004-recovery-durability.js';
import { evidencePath } from './fn004-evidence-persistence.js';

// Nominal live-lease adapter shared by original-owner prepare/commit and both
// terminal sides. It does not introduce a second ownership or takeover protocol.
async function originalAuthority(root, binding, gate, { io, audit = auditGitIds }, side) {
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
  const action=o.allowed_actions[0];
  check(s.chain && s.chain.head?.payload.phase !== 'RECOVERY_REQUIRED' && action,
    'Original owner lacks a verified continuation');
  if(side==='success') check((s.chain.decision || o.classification==='decidable_success') &&
    ['finalize_success','finish_terminal','cleanup'].includes(action), 'Original success continuation is not proven');
  if(side==='failure') check(!s.chain.decision && s.proof?.payload.phase!=='COMPLETED' &&
    ['abort','rollback','finish_terminal','cleanup'].includes(action), 'Original failure continuation is not proven');
  if(side==='failure') {
    // The normal failure handler may follow an uncertain complete publication.
    // Establish durability of the validated prefix before any terminal effect.
    for(const value of [s.owner,s.intent,...s.chain.entries].filter(Boolean)) {
      const path=evidencePath(value);
      await confirmExistingBytes(store,io,path,discovery.rawBytes[path]);
    }
    await refresh();
  }
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

export const originalSuccessAuthority=(root,binding,gate,options)=>originalAuthority(root,binding,gate,options,'success');
export const originalFailureAuthority=(root,binding,gate,options)=>originalAuthority(root,binding,gate,options,'failure');
// Private normal-commit context. Its caller separately validates the exact
// owned PREPARED/COMMITTING prefix before each authorized normal side effect.
export const originalApplyAuthority=(root,binding,gate,options)=>originalAuthority(root,binding,gate,options,'apply');

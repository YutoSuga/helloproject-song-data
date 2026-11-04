import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPersistence, RepositoryError } from './persistence.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { auditGitIds, inspectGitIdentity } from './fn004-git-audit.js';
import { prepareRecoverySnapshot, recoverySnapshotData, asOwnedRecoverySnapshot } from './fn004-recovery-snapshot.js';
import { collectRecoverySnapshot } from './fn004-recovery-collection.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { matchesRecoveryObservation, observationProjectionV2 } from './fn004-recovery-observation.js';
import { evidenceHashV1 } from './fn004-evidence-hash.js';
import { evidencePath } from './fn004-evidence-persistence.js';
import { validateMutexAnchor, validateMutexClaim, validateMutexBarrier } from './fn004-evidence-ownership.js';
import { readRecoveryArchive } from './fn004-recovery-archive.js';
import { recoveryProcessIdentity, probeRecoveryOwner } from './fn004-recovery-process.js';
import { same, check } from './fn004-evidence-types.js';
import { canonicalJson } from './canonical-hash.js';
import { confirmExistingBytes } from './fn004-recovery-durability.js';

const sessions = new WeakMap();
const views = new WeakMap();
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const details = session => { const s = sessions.get(session); check(s?.active, 'Expected a live internal Recovery capability'); return s; };
export const recoveryEnvelope = (kind, payload) => ({ schema_version: 1, kind, payload, hash: evidenceHashV1(kind, payload) });
export function ownedRecoverySnapshot(snapshot, session) {
  const s = sessions.get(session);
  return !!s?.active && s.snapshot === snapshot && recoverySnapshotData(snapshot).archive?.state === 'ACTIVE';
}
export function recoverySessionDetails(session) {
  const s = details(session);
  if (!views.has(session)) {
    const view = {};
    for (const key of Object.keys(s)) Object.defineProperty(view, key, { enumerable: true, get: () => {
      if (key !== 'discovery' || s.discovery === null) return s[key];
      const d = s.discovery;
      return { ...d, files: JSON.parse(canonicalJson(d.files)), documents: JSON.parse(canonicalJson(d.documents)),
        identities: JSON.parse(canonicalJson(d.identities)), rawBytes: Object.fromEntries(Object.entries(d.rawBytes).map(([p,b]) => [p, Buffer.from(b)])) };
    } });
    views.set(session, Object.freeze(view));
  }
  return views.get(session);
}
const changed = message => { throw new RepositoryError('RECOVERY_REQUIRED', message); };
function projection(snapshot, discovery) {
  const s = recoverySnapshotData(snapshot);
  const requests = Object.entries(discovery.documents).filter(([p]) => /^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(p)).map(([,v]) => v);
  return observationProjectionV2({ binding: s.base.binding, evidence: s.base.evidence, requests });
}
function compareAcquisition(before, after, allowed) {
  const p = structuredClone(after), old = new Map(before.evidence.files.map(f => [f.path, f]));
  const directories = new Set();
  for (const path of allowed) {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent) { directories.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
  }
  p.evidence.files = p.evidence.files.filter(file => old.has(file.path) || !(allowed.has(file.path) || file.kind === 'directory' && directories.has(file.path)))
    .map(file => allowed.has(file.path) && old.has(file.path) ? old.get(file.path) : file);
  p.evidence.effective_owner = before.evidence.effective_owner; p.evidence.owner_status = before.evidence.owner_status;
  if (!same(before, p)) changed('Evidence changed while acquiring Recovery ownership');
}

// Internal lifecycle service. No public CLI, serialized witness or client flag
// can create a session: it is minted only after actual observation and OS proof.
export async function acquireRecoveryAuthority(root, binding, command, { io = fs, audit = auditGitIds,
  probeOwner = probeRecoveryOwner, clock = () => new Date().toISOString(), onBoundary = async () => {} } = {}) {
  binding = JSON.parse(canonicalJson(binding)); command = JSON.parse(canonicalJson(command));
  const store = await createPersistence(root, { io });
  const initial = await collectRecoverySnapshot(store.root, binding, { discover: r => discoverEvidence(r, { io }), audit, probeOwner });
  const observation = classifyRecoverySnapshot(initial);
  if (!matchesRecoveryObservation(command, observation)) changed('Stale or ineligible Recovery command');
  if (command.action === 'finalize_success') changed('Success-side Recovery belongs to Slice 6D');
  const old = recoverySnapshotData(initial), self = await recoveryProcessIdentity();
  if (old.chain?.decision || old.proof?.payload.phase === 'COMPLETED') changed('Success-side Recovery belongs to Slice 6D');
  const d0 = await discoverEvidence(store.root, { io }), ga = await audit(store.root);
  const again = await prepareRecoverySnapshot({ binding, discovery: d0, git_audit: ga,
    probe: old.base.evidence.effective_owner ? await probeOwner(old.base.evidence.effective_owner) : null });
  if (classifyRecoverySnapshot(again).observed_state_hash !== observation.observed_state_hash) changed('Recovery observation changed before claim');
  const predecessor = old.base.evidence.effective_owner;
  if (predecessor && (await probeOwner(predecessor))?.status !== 'exited') changed('Predecessor OS termination is unproven');
  const checkedAt = clock(), now = clock();
  const exit = predecessor ? { owner: predecessor, checked_at: checkedAt, status: 'exited' } : null;
  const allowed = new Set(), before = projection(initial, d0);
  async function publish(value, phase) {
    const path = evidencePath(value); allowed.add(path);
    await onBoundary({ phase: `${phase}:before`, path });
    await store.createJsonExclusive(path, value);
    check(same(await store.readJson(path, { strict: true }), value), 'Ownership publication differs on readback');
    await onBoundary({ phase: `${phase}:after`, path });
  }
  let anchor, claim, barrier;
  if (!old.archive) {
    check(!old.barrier, 'Unanchored barrier cannot be adopted');
    anchor = recoveryEnvelope('fn004-recovery-mutex', { mutex_id: randomUUID(), binding, gate: old.gate,
      owner: self, operator: { id: 'local:recovery', assurance: 'local_process' }, predecessor_exit: exit,
      observed_state_hash: observation.observed_state_hash, acquired_at: now });
    validateMutexAnchor(anchor);
    barrier = recoveryEnvelope('fn004-recovery-barrier', { binding, mutex_id: anchor.payload.mutex_id,
      anchor_hash: anchor.hash, barrier_id: randomUUID() }); validateMutexBarrier(barrier);
    await publish(barrier, 'barrier');
    // This unanchored publication interval is allowed only in this invocation.
    // Any crash loses the construction capability and requires manual STOP.
    const d = await discoverEvidence(store.root, { io });
    for (const file of d0.files.filter(f => f.kind === 'file')) {
      if (/^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(file.path) || /\/transaction\.json$/.test(file.path)) continue;
      check(d.rawBytes[file.path]?.equals(d0.rawBytes[file.path]), 'Evidence changed before anchor');
    }
    check(Object.entries(d.rawBytes).every(([path, raw]) => d0.rawBytes[path] || path === evidencePath(barrier) && same(d.documents[path], barrier)), 'Unexpected evidence before anchor');
    await publish(anchor, 'anchor');
  } else {
    check(old.archive.state !== 'SEALED' && old.barrier, 'Sealed or missing Recovery lineage cannot be reopened');
    anchor = d0.documents[`staging/recovery-ownership/${binding.transaction_id}/anchor.json`];
    barrier = old.barrier;
    for (const path of Object.keys(d0.rawBytes).filter(path =>
      path.startsWith(`staging/recovery-ownership/${binding.transaction_id}/`) || path === 'staging/.fn004-recovery.lock')) {
      await confirmExistingBytes(store, io, path, d0.rawBytes[path]);
    }
    claim = recoveryEnvelope('fn004-recovery-claim', { mutex_id: anchor.payload.mutex_id, binding,
      sequence: old.archive.sequence + 1, previous_claim_hash: old.archive.head.hash, owner: self,
      operator: { id: 'local:recovery', assurance: 'local_process' }, gate: old.gate, predecessor_exit: exit,
      observed_state_hash: observation.observed_state_hash, acquired_at: now }); validateMutexClaim(claim);
    await publish(claim, 'claim');
  }
  if (predecessor && (await probeOwner(predecessor))?.status !== 'exited') changed('Predecessor changed during claim acquisition');
  const head = claim ?? anchor;
  const session = Object.freeze({});
  const internal = { active: true, store, io, binding: freeze(binding), self, head: freeze(head), anchor: freeze(anchor),
    barrier: freeze(barrier), snapshot: null, discovery: null,
    audit: freeze(ga), clock, onBoundary, probeOwner, barrierIdentity: null };
  sessions.set(session, internal);
  try {
    const snapshot = await refreshRecoveryAuthority(session);
    compareAcquisition(before, projection(snapshot, internal.discovery), allowed);
    return session;
  } catch (error) { internal.active = false; throw error; }
}

export async function refreshRecoveryAuthority(session) {
  const s = details(session), d = await discoverEvidence(s.store.root, { io: s.io });
  const git = await inspectGitIdentity(s.store.root);
  if (git.head !== s.audit.git.audited_head || git.format !== s.audit.git.object_format) changed('Git audit changed during Recovery');
  const snapshot = await prepareRecoverySnapshot({ binding: s.binding, discovery: d, git_audit: s.audit,
    probe: { owner: s.self, observer: s.self, status: 'live' } });
  const v = recoverySnapshotData(snapshot);
  check(v.archive?.head.hash === s.head.hash && same(v.archive.head.payload.owner, s.self) && same(v.barrier, s.barrier), 'Recovery owner/barrier no longer matches capability');
  const identity = d.identities['staging/.fn004-recovery.lock'];
  if (s.barrierIdentity) check(same(identity, s.barrierIdentity), 'Recovery barrier inode changed');
  else s.barrierIdentity = Object.freeze(identity);
  s.snapshot = snapshot; s.discovery = d;
  if (v.archive.state === 'ACTIVE') s.snapshot = asOwnedRecoverySnapshot(snapshot, session);
  return s.snapshot;
}

export async function assertRecoveryAuthority(session) {
  const s = details(session), {archive,barrier,identity} = await readRecoveryArchive(s.store,s.io,s.binding.transaction_id);
  check(archive.head.hash === s.head.hash && same(archive.head.payload.owner, s.self) &&
    same(barrier, s.barrier) && same(identity, s.barrierIdentity),
    'Latest ownership/barrier does not match live capability');
  check(archive.state !== 'SEALED', 'Sealed Recovery capability cannot be reused');
  return recoverySessionDetails(session);
}
export function revokeRecoveryAuthority(session) { details(session).active = false; }

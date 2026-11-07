import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { createPersistence, RepositoryError } from "./persistence.js";
import { canonicalJson } from "./canonical-hash.js";
import { recoveryProcessIdentity } from './fn004-recovery-process.js';

export const GATE_PATH = "staging/.fn004.lock";
const leases = new WeakMap();
const scope = new AsyncLocalStorage();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function processIdentity() {
  const { process_id, hostname, platform, ...identity } = await recoveryProcessIdentity();
  return identity;
}

async function inspectExisting(store) {
  try {
    const metadata = await store.readJson(GATE_PATH);
    if (metadata.schema_version !== 1 || !uuid.test(metadata.lock_id) || metadata.root !== store.root ||
        !Number.isInteger(metadata.process_id) || metadata.process_id < 1 || typeof metadata.operation !== "string" || !metadata.operation ||
        typeof metadata.started_at !== "string" || !Number.isFinite(Date.parse(metadata.started_at))) throw new Error("Invalid lock metadata");
    return metadata;
  } catch (cause) {
    throw new RepositoryError("GATE_CORRUPT", "Existing lock is unreadable, incomplete or unsupported; recovery inspection required", { path: GATE_PATH, cause });
  }
}

// Non-reentrant; explicitly pass the original live lease to inner operations.
// A crash leaves the file in place. There is deliberately no force/stale unlock.
export async function acquireGate(options = {}) { return acquireGateInternal(options); }
async function acquireGateInternal({ root = process.cwd(), operation = "canonical_read", actor = null, io = fs } = {}, recovery = null) {
  const store = await createPersistence(root, { io });
  const scopedToken = scope.getStore()?.get(store.root);
  if (scopedToken && leases.get(scopedToken)?.active) throw new RepositoryError("GATE_NESTED", "Pass the current gate lease instead of nested acquisition");
  if (!recovery) await (await import('./fn004-gate-recovery-guard.js')).assertNormalRecoveryClear(store, io);
  if (typeof operation !== "string" || !operation || (actor !== null && typeof actor !== "string")) throw new TypeError("Gate operation and actor must be strings");
  const metadata = Object.freeze({ schema_version: 1, lock_id: randomUUID(), root: store.root,
    process_id: process.pid, operation, mode: "exclusive", started_at: new Date().toISOString(),
    actor, hostname: hostname(), platform: process.platform, ...await processIdentity() });
  const bytes = Buffer.from(canonicalJson(metadata) + "\n");
  await store.ensureDirectory("staging");
  const path = await store.resolvePath(GATE_PATH);
  let handle;
  try { handle = await io.open(path, "wx", 0o600); }
  catch (cause) {
    if (cause.code === "EEXIST") {
      const existing = await inspectExisting(store);
      throw new RepositoryError("GATE_BUSY", "Repository gate is already held; it is never removed automatically", { path: GATE_PATH, metadata: existing });
    }
    throw new RepositoryError("GATE_ACQUIRE_FAILED", "Cannot create repository gate", { path: GATE_PATH, cause });
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await store.syncDirectory("staging");
    const identity = await handle.stat({ bigint: true });
    const token = Object.freeze({ lock_id: metadata.lock_id, root: store.root, operation, acquired_at: metadata.started_at });
    leases.set(token, { store, io, path, handle, identity, bytes, active: true, releasing: false, recovery });
    if (!recovery) {
      try { await (await import('./fn004-gate-recovery-guard.js')).assertNormalRecoveryClear(store, io); }
      catch (error) { await releaseGate(token); throw error; }
    }
    return token;
  } catch (cause) {
    try { await handle.close(); } catch { /* preserve acquire/sync failure */ }
    // A partial lock is not absent. Keep it to stop other operations.
    if (cause instanceof RepositoryError && ['GATE_BUSY','GATE_CORRUPT','RECOVERY_REQUIRED'].includes(cause.code)) throw cause;
    throw new RepositoryError("GATE_ACQUIRE_FAILED", "Gate metadata/sync failed; lock retained for inspection", { path: GATE_PATH, cleanup_required: true, cause });
  }
}

export async function assertGateOwnership(token, root) {
  const lease = token && leases.get(token);
  if (!lease?.active || lease.releasing) throw new RepositoryError("GATE_OWNERSHIP_MISMATCH", "Expected the live gate lease for this root");
  if (root !== undefined && await lease.io.realpath(root) !== token.root) throw new RepositoryError("GATE_OWNERSHIP_MISMATCH", "Gate belongs to another root");
  await verifyLock(lease);
  if (lease.recovery) await (await import('./fn004-recovery-authority.js')).assertRecoveryAuthority(lease.recovery);
}

// Recovery-only adoption: a serialized witness alone never becomes a lease.
// The nominal session has already claimed and verified the full archive and
// barrier. Original metadata/inode/bytes remain unchanged.
export async function adoptRecoveryGate(authority) {
  const { assertRecoveryAuthority } = await import('./fn004-recovery-authority.js');
  const s = await assertRecoveryAuthority(authority);
  const witness = s.head.payload.gate;
  if (witness === null) {
    const { recoverySnapshotData } = await import('./fn004-recovery-snapshot.js');
    const current = recoverySnapshotData(s.snapshot);
    if (!(current.proof && current.completion && current.gate === null)) {
      throw new RepositoryError('RECOVERY_REQUIRED', 'Gate absence is allowed only for proven terminal cleanup');
    }
    return acquireGateInternal({ root: s.store.root, operation: 'recovery_cleanup', io: s.io }, authority);
  }
  const path = await s.store.resolvePath(GATE_PATH);
  let handle;
  try { handle = await s.io.open(path, 'r'); }
  catch (cause) { throw new RepositoryError(cause.code === 'ENOENT' ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_READ_FAILED',
    'Cannot open the claimed gate', { cause, path: GATE_PATH, phase: null, published: null }); }
  try {
    const identity = await handle.stat({ bigint: true }), bytes = await s.io.readFile(path);
    if (identity.dev.toString() !== witness.device || identity.ino.toString() !== witness.inode ||
        !bytes.equals(Buffer.from(canonicalJson(witness.metadata) + '\n'))) {
      throw new RepositoryError('GATE_OWNERSHIP_MISMATCH', 'Adopted gate differs from claimed witness');
    }
    const token = Object.freeze({ lock_id: witness.metadata.lock_id, root: s.store.root,
      operation: 'recovery', acquired_at: witness.metadata.started_at });
    leases.set(token, { store: s.store, io: s.io, path, handle, identity, bytes, active: true,
      releasing: false, recovery: authority });
    await assertGateOwnership(token, s.store.root);
    return token;
  } catch (cause) {
    try { await handle.close(); } catch { /* preserve original adoption error */ }
    if (cause instanceof RepositoryError) throw cause;
    throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot verify claimed gate bytes/identity',
      { cause, path: GATE_PATH, phase: null, published: null });
  }
}

async function verifyLock(lease) {
  try {
    const stat = await lease.io.lstat(lease.path, { bigint: true });
    const bytes = await lease.io.readFile(lease.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== lease.identity.dev || stat.ino !== lease.identity.ino || !bytes.equals(lease.bytes)) throw new Error("Lock identity/content changed");
  } catch (cause) {
    throw new RepositoryError("GATE_OWNERSHIP_MISMATCH", "Lock ownership cannot be verified; lock retained", { path: GATE_PATH, cleanup_required: true, cause });
  }
}

export async function releaseGate(token) {
  const lease = token && leases.get(token);
  if (!lease?.active || lease.releasing) throw new RepositoryError("GATE_OWNERSHIP_MISMATCH", "Unknown, releasing or released gate lease");
  if (lease.recovery) await (await import('./fn004-recovery-authority.js')).assertRecoveryAuthority(lease.recovery);
  lease.releasing = true;
  try {
    await verifyLock(lease);
    lease.active = false; // revoke before closing/unlinking; cannot reuse token
    await lease.handle.close(); lease.handle = null;
    await lease.io.unlink(lease.path);
    await lease.store.syncDirectory("staging");
  } catch (cause) {
    lease.active = false;
    const error = cause instanceof RepositoryError && cause.code === "GATE_OWNERSHIP_MISMATCH" ? cause :
      new RepositoryError("GATE_RELEASE_FAILED", "Gate release/sync failed; cleanup required", { path: GATE_PATH, cleanup_required: true, cause });
    lease.release_error = error;
    throw error;
  } finally {
    if (lease.handle) { try { await lease.handle.close(); } catch { /* failure already propagated */ } lease.handle = null; }
  }
}

// Failure retention closes only this process's descriptor. It neither unlinks
// the gate nor transfers/retires its owner; a restart still needs OS proof.
export async function closeRetainedGate(token) {
  const lease = token && leases.get(token);
  if (!lease) throw new RepositoryError('GATE_OWNERSHIP_MISMATCH', 'Unknown retained gate lease');
  lease.active = false;
  lease.retained = true;
  if (lease.handle) { const handle = lease.handle; lease.handle = null; await handle.close(); }
}

export async function withCanonicalGate({ root = process.cwd(), operation = "canonical_read", actor = null, gate, fn, io = fs }) {
  if (gate) { await assertGateOwnership(gate, root); return fn(gate); }
  const token = await acquireGate({ root, operation, actor, io });
  let result, operationError, failed = false;
  try { result = await scope.run(new Map([...(scope.getStore() ?? []), [token.root, token]]), () => fn(token)); }
  catch (error) { operationError = error; failed = true; }
  try {
    const lease = leases.get(token);
    if (lease.active) await releaseGate(token);
    // An awaited internal owner may consume the same lease. Never release a
    // second time, or unlink a retained failure gate. Caught release failures
    // still cannot be presented as a successful callback.
    else if (lease.release_error) throw lease.release_error;
    else if (lease.retained && !failed) throw new RepositoryError('RECOVERY_REQUIRED', 'Owner retained the gate for explicit Recovery');
  }
  catch (error) {
    if (failed) { error.operation_error = operationError; error.diagnostics = [...(operationError?.diagnostics ?? []), ...error.diagnostics]; }
    throw error;
  }
  if (failed) throw operationError;
  return result;
}

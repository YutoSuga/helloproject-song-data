import { canonicalJson, sha256 } from './canonical-hash.js';
import { parseStrictJson } from './strict-json.js';
import { gateWitness } from './fn004-evidence-types.js';
import { RepositoryError } from './persistence.js';
import { GATE_PATH, gateCandidatePath } from './fn004-gate-candidate.js';
import { gateNow, gateDeadline } from './fn004-gate-budget.js';

const sameIdentity = (a, b) => typeof a.dev === 'bigint' && typeof a.ino === 'bigint' &&
  a.dev === b.dev && a.ino === b.ino;
const regular = stat => stat.isFile() && !stat.isSymbolicLink();
const assert = (value, message) => { if (!value) throw new Error(message); };
const close = async handle => { if (handle) await handle.close(); };
export function gateErrorDescriptor(error) {
  const seen = new Set();
  while (error && !seen.has(error)) {
    seen.add(error); if (error.descriptor !== undefined) return error.descriptor;
    error = error.cause;
  }
}

// Read bytes through the descriptor whose identity was measured. Namespace
// changes never turn invalid bytes already read into an absent/valid file.
async function readName(store, io, relative) {
  const path = await store.resolvePath(relative);
  const handle = await io.open(path, 'r');
  let result, readError, failed = false;
  try {
    const identity = await handle.stat({ bigint: true });
    assert(regular(identity), 'Expected a regular file');
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    assert(sameIdentity(identity, after) && BigInt(bytes.length) === after.size, 'Descriptor identity/size changed');
    result = { identity, bytes };
  } catch (cause) { failed = true; readError = cause; }
  try { await close(handle); }
  catch (close_error) {
    if (!failed) throw close_error;
    // A second failure must not overwrite the first errno/permission evidence.
    throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Gate read and descriptor close failed',
      { path: relative, cause: readError, close_error,
        ...(gateErrorDescriptor(readError) === undefined ? {} : { descriptor: gateErrorDescriptor(readError) }) });
  }
  if (failed) throw readError;
  return result;
}

function validateMetadata(bytes, root) {
  let metadata;
  try { metadata = parseStrictJson(bytes); }
  catch (cause) { throw new RepositoryError(cause instanceof TypeError ? 'PERSISTENCE_INVALID_UTF8' : 'PERSISTENCE_PARSE_FAILED',
    'Invalid Gate JSON', { path: GATE_PATH, cause }); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new RepositoryError('PERSISTENCE_ROOT_TYPE', 'Gate requires an object', { path: GATE_PATH });
  // Reuse the full v1 type validation, without minting a witness or lease.
  // Legacy valid JSON need not have canonical serialization to remain BUSY.
  const canonical = Buffer.from(canonicalJson(metadata) + '\n');
  gateWitness({ metadata, byte_length: canonical.length, sha256: sha256(canonical), device: '0', inode: '0' });
  assert(metadata.root === root, 'Gate root binding differs');
  return metadata;
}

async function observeFinal(store, io, own) {
  let last;
  // Each newly observed inode is validated independently; no unbounded ABA loop.
  for (let i = 0; i < 2; i++) {
    let read;
    try { read = await readName(store, io, GATE_PATH); }
    catch (cause) {
      if (cause.code === 'ENOENT') return { kind: 'raced', cause };
      throw new RepositoryError('GATE_CORRUPT', 'Existing gate cannot be validated', { path: GATE_PATH, cause });
    }
    let metadata;
    try { metadata = validateMetadata(read.bytes, store.root); }
    catch (cause) { throw new RepositoryError('GATE_CORRUPT', 'Existing gate metadata is invalid', { path: GATE_PATH, cause }); }
    if (sameIdentity(read.identity, own.identity) && read.bytes.equals(own.bytes)) return { kind: 'own' };
    try {
      const stat = await io.lstat(await store.resolvePath(GATE_PATH), { bigint: true });
      assert(regular(stat), 'Unsafe final name');
      if (sameIdentity(stat, read.identity)) return { kind: 'busy', metadata };
      last = new Error('Final name changed inode');
    } catch (cause) {
      if (cause.code === 'ENOENT') return { kind: 'raced', cause };
      throw new RepositoryError('GATE_CORRUPT', 'Final gate name cannot be verified', { path: GATE_PATH, cause });
    }
  }
  throw new RepositoryError('GATE_ACQUIRE_FAILED', 'Repeated name changes cannot establish a stable owner',
    { path: GATE_PATH, cause: last, phase: 'publish', published: null });
}

async function verifyName(store, io, relative, own) {
  const current = await readName(store, io, relative);
  assert(sameIdentity(current.identity, own.identity) && current.bytes.equals(own.bytes), 'Name differs from created inode/bytes');
  const stat = await io.lstat(await store.resolvePath(relative), { bigint: true });
  assert(regular(stat) && sameIdentity(stat, own.identity), 'Name changed after readback');
}

export const verifyPublishedGate = lease => verifyName(lease.store, lease.io, GATE_PATH, lease);

// No caller-selected candidate and no descriptor/serialized token adoption.
// The creation handle and inode stay private until the common gate registers
// its nominal lease. Publication failures retain both names, never self-release.
export async function publishGate(store, io, metadata, bytes, guard) {
  const temp = gateCandidatePath(metadata.lock_id);
  let handle, identity, phase = 'ensure_directory', published = false, attempted = false;
  let namespaceDeadline = Infinity, retries = 0, contention, busyError;
  const own = { bytes };
  try {
    assert(process.platform === 'linux' && Number(process.versions.node.split('.')[0]) >= 20,
      'Gate publication requires Node >=20 on Linux');
    await store.ensureDirectory('staging');
    const candidate = await store.resolvePath(temp), path = await store.resolvePath(GATE_PATH);
    phase = 'temp_create'; handle = await io.open(candidate, 'wx', 0o600);
    phase = 'temp_write'; await handle.writeFile(bytes);
    phase = 'file_sync'; await handle.sync();
    phase = 'temp_verify'; identity = await handle.stat({ bigint: true }); own.identity = identity;
    assert(regular(identity) && typeof identity.dev === 'bigint' && typeof identity.ino === 'bigint', 'Invalid candidate identity');
    await verifyName(store, io, temp, own);
    for (;;) {
      phase = 'publish'; attempted = true;
      try { await io.link(candidate, path); published = true; break; }
      catch (cause) {
        published = null;
        if (cause.code !== 'EEXIST') throw cause;
        contention = cause;
        namespaceDeadline = Math.min(namespaceDeadline, gateNow() + 1000, gateDeadline());
        const current = await observeFinal(store, io, own);
        if (current.kind === 'own') { published = true; throw cause; }
        if (current.kind === 'busy') {
          // Kernel EEXIST plus a separately verified other inode is the only
          // normal losing publication path. Delete only our own candidate.
          published = false; phase = 'temp_cleanup';
          busyError = new RepositoryError('GATE_BUSY', 'Repository gate is already held',
            { path: GATE_PATH, metadata: current.metadata, cause, phase: 'publish', published: false });
          await verifyName(store, io, temp, own);
          await io.unlink(candidate); await store.syncDirectory('staging');
          await close(handle); handle = null;
          throw busyError;
        }
        contention = current.cause;
        if (retries >= 8 || gateNow() >= namespaceDeadline) throw contention;
        await verifyName(store, io, temp, own);
        await store.resolvePath(GATE_PATH); await guard();
        if (gateNow() >= namespaceDeadline) throw contention;
        retries++;
      }
    }
    phase = 'directory_sync'; await store.syncDirectory('staging');
    phase = 'temp_verify'; await verifyName(store, io, GATE_PATH, own);
    phase = 'temp_cleanup'; await verifyName(store, io, temp, own);
    await io.unlink(candidate);
    phase = 'directory_sync'; await store.syncDirectory('staging');
    // The original handle remains open and immutable for the nominal lease.
    return { handle, identity, bytes, path, store, io };
  } catch (cause) {
    if (cause.code === 'GATE_BUSY') throw cause;
    // link can take effect before an adapter throws. Same bytes alone, or an
    // absent final, cannot prove non-publication.
    if (attempted && published !== false && published !== true && identity) {
      try { const current = await readName(store, io, GATE_PATH);
        if (sameIdentity(current.identity, identity) && current.bytes.equals(bytes)) published = true;
      } catch { /* retain unknown and the original cause */ }
    }
    try { await close(handle); } catch { /* preserve original failure */ }
    if (cause.code === 'GATE_CORRUPT') {
      Object.assign(cause, { phase, published, temp,
        ...(gateErrorDescriptor(cause) === undefined ? {} : { descriptor: gateErrorDescriptor(cause) }) }); throw cause;
    }
    throw new RepositoryError('GATE_ACQUIRE_FAILED', 'Gate acquisition did not establish durable ownership; evidence retained',
      { path: GATE_PATH, cause, phase, published, temp, cleanup_required: true,
        ...(busyError ? { operation_error: busyError } : {}),
        ...(gateErrorDescriptor(cause) === undefined ? {} : { descriptor: gateErrorDescriptor(cause) }) });
  }
}

export async function observeReleasedGate(lease) {
  try {
    const value = await readName(lease.store, lease.io, GATE_PATH);
    return sameIdentity(value.identity, lease.identity) && value.bytes.equals(lease.bytes) ? 'same' : 'other';
  } catch (cause) { return cause.code === 'ENOENT' ? 'absent' : 'unknown'; }
}

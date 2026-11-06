import { RepositoryError } from './persistence.js';
import { check } from './fn004-evidence-types.js';

export async function readPublishedBytes(store, io, path) {
  try { return await io.readFile(await store.resolvePath(path)); }
  catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    throw new RepositoryError(cause.code === 'ENOENT' ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_READ_FAILED',
      'Cannot read published immutable bytes', { cause, path, phase: null, published: true });
  }
}

export async function readPublishedJson(store, path) {
  try { return await store.readJson(path, { strict: true }); }
  catch (error) {
    if (error instanceof RepositoryError) Object.assign(error, { phase: error.phase ?? null, published: true });
    throw error;
  }
}

// Reconfirm an already published immutable artifact without replacing it.
// Used after crash/uncertain sync; no missing/partial evidence is repaired.
export async function confirmExistingBytes(store, io, path, expected) {
  let handle, phase = 'file_sync';
  try {
    handle = await io.open(await store.resolvePath(path), 'r');
    await handle.sync(); await handle.close(); handle = null;
    phase = 'directory_sync'; await store.syncDirectory(path.slice(0, path.lastIndexOf('/')));
    phase = null;
    const raw = await io.readFile(await store.resolvePath(path));
    check(raw.equals(expected), 'Existing immutable bytes changed during durability confirmation');
  } catch (cause) {
    if (handle) { try { await handle.close(); } catch { /* original failure retained */ } }
    if (cause instanceof RepositoryError && ['INTEGRITY_CONFLICT','PATH_UNSAFE'].includes(cause.code)) throw cause;
    throw new RepositoryError(phase === null ? cause.code === 'ENOENT' ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_READ_FAILED' :
      'PERSISTENCE_SYNC_FAILED', 'Existing artifact durability is unconfirmed', { cause, path, phase, published: true });
  }
}

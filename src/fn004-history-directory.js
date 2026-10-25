import * as fs from 'node:fs/promises';
import { RepositoryError } from './persistence.js';

export const APPLY_HISTORY_PATH = 'staging/apply-history';
export const APPLY_ID_PATTERN = /^apply_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function applyHistoryPath(applyId) {
  if (typeof applyId !== 'string' || !APPLY_ID_PATTERN.test(applyId)) throw new RepositoryError('PATH_UNSAFE', 'Invalid Apply History identity');
  return `${APPLY_HISTORY_PATH}/${applyId}.json`;
}

// Caller holds the common gate. Capture kinds without following links; records
// use the persistence strict parser and path checks on the same file bytes.
// This is a directory snapshot, not proof that its records/state are valid.
export async function readApplyHistoryDirectory(store, { io = fs } = {}) {
  if (!await store.exists(APPLY_HISTORY_PATH)) return { present: false, entries: [] };
  const path = await store.resolvePath(APPLY_HISTORY_PATH);
  let names;
  try { names = (await io.readdir(path)).sort(); }
  catch (cause) { throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot list Apply History', { path: APPLY_HISTORY_PATH, cause }); }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !APPLY_ID_PATTERN.test(name.slice(0, -5))) throw new RepositoryError('HISTORY_CORRUPT', 'Unknown Apply History entry', { path: `${APPLY_HISTORY_PATH}/${name}` });
    const file = applyHistoryPath(name.slice(0,-5));
    let stat;
    try { stat = await io.lstat(`${path}/${name}`); }
    catch (cause) { throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot inspect Apply History entry', { path: file, cause }); }
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    entries.push({ name, kind, document: kind === 'file' ? await store.readJson(file, { strict: true }) : null });
  }
  return { present: true, entries };
}

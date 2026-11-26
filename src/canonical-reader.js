import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { readCanonicalSnapshot } from './canonical-snapshot.js';

// Readonly. Editors must finish writes before validation/build starts.
export async function readValidatedCanonical(root = process.cwd()) {
  root = await realpath(root);
  for (const path of ['data', ...CANONICAL_TABLES.map(t => t.path)]) {
    let stat;
    try { stat = await lstat(join(root, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || (path === 'data' ? !stat.isDirectory() : !stat.isFile())) {
      throw Object.assign(new Error(`${path}: unsafe canonical path`), { code: 'PATH_UNSAFE' });
    }
  }
  const snapshot = await readCanonicalSnapshot(root);
  if (!snapshot.validation.ok) {
    throw Object.assign(new Error(snapshot.validation.diagnostics.map(d => `${d.file ?? d.table}: ${d.code} ${d.column ?? ''} ${d.message}`).join('\n')),
      { code: 'CANONICAL_INVALID', diagnostics: snapshot.validation.diagnostics });
  }
  return snapshot;
}

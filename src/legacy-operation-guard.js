import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

// Presence, including corrupt bytes/a symlink, selects the new operation model.
export async function assertLegacyOperationAllowed(root = process.cwd()) {
  try { await lstat(join(root, 'data', 'id-high-water.json')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Object.assign(new Error('FN-004 is archived for this checkout; use CSV editing and canonical:validate / ids:validate.'),
    { code: 'LEGACY_OPERATION_DISABLED' });
}

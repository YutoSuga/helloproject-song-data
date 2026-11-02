import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { parseStrictJson } from './strict-json.js';
import { sha256 } from './canonical-hash.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { observedPath, check, uuid } from './fn004-evidence-types.js';
import { validateJournalEntry } from './fn004-transaction-evidence.js';

const roots = ['data', 'staging'];
const fixed = ['staging/fn004-bootstrap.json', 'staging/fn004-state.json', 'staging/decisions.json',
  'staging/song-candidates.json', 'staging/.fn004.lock', 'staging/.fn004-recovery.lock'];

// Readonly raw discovery. Nothing is deleted, skipped as a corrupt tail, repaired
// or claimed. Unknown files are retained for the domain namespace validator.
export async function discoverEvidence(root, { io = fs, expectedPaths = [] } = {}) {
  const store = await createPersistence(root, { io }), files = [], rawBytes = {}, documents = {}, identities = {};
  const seen = new Set();
  async function visit(path) {
    observedPath(path);
    if (seen.has(path)) return;
    seen.add(path);
    const absolute = `${store.root}/${path}`;
    let stat;
    try { stat = await io.lstat(absolute, { bigint: true }); }
    catch (cause) {
      if (cause.code === 'ENOENT') { files.push({ path, kind: 'missing', byte_length: null, sha256: null }); return; }
      throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot discover evidence', { path, cause });
    }
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    const entry = { path, kind, byte_length: null, sha256: null };
    files.push(entry);
    if (kind === 'symlink' || kind === 'other') return;
    await store.resolvePath(path);
    if (kind === 'directory') {
      let names;
      try { names = await io.readdir(absolute); }
      catch (cause) { throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot list evidence', { path, cause }); }
      for (const name of names.sort()) await visit(`${path}/${name}`);
      return;
    }
    let bytes;
    try { bytes = await io.readFile(absolute); }
    catch (cause) { throw new RepositoryError('PERSISTENCE_READ_FAILED', 'Cannot read discovered evidence', { path, cause }); }
    rawBytes[path] = Buffer.from(bytes); entry.byte_length = bytes.length; entry.sha256 = sha256(bytes);
    identities[path] = { device: stat.dev.toString(), inode: stat.ino.toString() };
    if (path.endsWith('.json') || /\.json\.tmp-/.test(path) || fixed.includes(path) && path.endsWith('.lock')) {
      try { documents[path] = parseStrictJson(bytes); }
      catch (cause) { throw new RepositoryError(cause instanceof TypeError ? 'PERSISTENCE_INVALID_UTF8' : 'PERSISTENCE_PARSE_FAILED', 'Malformed discovered JSON evidence', { path, cause }); }
      if (documents[path] === null || typeof documents[path] !== 'object' || Array.isArray(documents[path])) {
        throw new RepositoryError('PERSISTENCE_ROOT_TYPE', 'Evidence JSON requires an object root', { path });
      }
    }
  }
  for (const path of roots) await visit(path);
  for (const path of [...fixed, ...CANONICAL_TABLES.map(table => table.path), ...expectedPaths]) await visit(path);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { root: store.root, files, rawBytes, documents, identities };
}

export async function discoverJournal(root, transactionId, options = {}) {
  check(typeof transactionId === 'string' && transactionId.startsWith('tx_') && uuid(transactionId.slice(3)), 'Invalid transaction ID');
  const prefix = `staging/transactions/${transactionId}/journal/`;
  const discovery = await discoverEvidence(root, options);
  const entries = discovery.files.filter(file => file.path.startsWith(prefix));
  for (const entry of entries) check(entry.kind === 'file' && /^(?:[0-9]{6}|[1-9][0-9]{6,})\.json$/.test(entry.path.slice(prefix.length)),
    'Unknown/nonregular journal entry');
  const artifacts = entries.map(file => discovery.documents[file.path]);
  artifacts.forEach(validateJournalEntry);
  artifacts.sort((a, b) => a.payload.sequence - b.payload.sequence);
  for (const entry of entries) check(entry.path === `${prefix}${String(discovery.documents[entry.path].payload.sequence).padStart(6, '0')}.json`,
    'Journal filename/sequence mismatch');
  return { discovery, artifacts };
}

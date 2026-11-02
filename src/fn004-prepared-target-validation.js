import { readCanonicalSnapshotFromAdapter } from './canonical-snapshot.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { rowKey, compareKeys } from './fn004-history-schema.js';
import { sha256 } from './canonical-hash.js';
import { check, same } from './fn004-evidence-types.js';

// Inverse syntax predicate only: no CSV bytes/rows are generated or written.
function serializerV1Syntax(bytes) {
  if (bytes.length === 0 || bytes.at(-1) !== 10 || bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return false;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      index++; let required = false, closed = false;
      while (index < text.length) {
        const char = text[index++];
        if (char === '"') {
          if (text[index] === '"') { index++; required = true; }
          else { closed = true; break; }
        } else if (char === ',' || char === '\r' || char === '\n') required = true;
      }
      if (!required || !closed) return false;
    } else {
      while (index < text.length && text[index] !== ',' && text[index] !== '\n') {
        if (text[index] === '"' || text[index] === '\r') return false;
        index++;
      }
    }
    if (text[index] !== ',' && text[index] !== '\n') return false;
    index++;
  }
  return true;
}

// Validate already-existing temp/canonical evidence against the saved Plan.
// This does not implement 6B target materialization or a serializer/backup writer.
// null means required historical target bytes are no longer physically available;
// the action-specific presence/rollback checks remain the caller's responsibility.
export async function validatePreparedTargetBytes({ owner, intent, inputs, original, rawBytes }) {
  if (!original) return null;
  const selected = {}, root = `staging/transactions/${owner.payload.binding.transaction_id}`;
  for (const file of intent.payload.target_manifest.files) {
    const candidates = [rawBytes[file.path], rawBytes[`${root}/temp/${file.path}`], original.rawBytes[file.path]];
    const bytes = candidates.find(bytes => bytes && bytes.length === file.byte_length && sha256(bytes) === file.sha256);
    if (!bytes) return null;
    selected[file.path] = bytes;
  }
  const target = await readCanonicalSnapshotFromAdapter({ list: () => CANONICAL_TABLES.map(table => table.path.slice(5)), read: path => selected[path] });
  check(target.validation.ok && same(target.manifest, intent.payload.target_manifest), 'Prepared target canonical evidence is invalid');
  for (const table of CANONICAL_TABLES) {
    const before = original.tables[table.name], after = target.tables[table.name];
    const inserts = inputs.plan.payload.operations.filter(operation => operation.table === table.name && operation.classification === 'insert');
    check(after.length === before.length + inserts.length && before.every((row, index) => same(row, after[index])), 'Target altered existing rows/order');
    if (inserts.length === 0) {
      check(same(original.manifest.files.find(file => file.path === table.path), target.manifest.files.find(file => file.path === table.path)),
        'Target rewrote a non-insert table');
      continue;
    }
    check(serializerV1Syntax(selected[table.path]), 'Prepared target violates serializer v1 byte syntax');
    const seen = new Set();
    for (let index = before.length; index < after.length; index++) {
      const row = after[index], key = rowKey(table.name, row);
      const operation = inserts.find(operation => same(operation.key, key));
      check(operation && !seen.has(operation.operation_id), 'Unplanned/duplicate target insert');
      seen.add(operation.operation_id);
      if (index > before.length) check(compareKeys(table.name, rowKey(table.name, after[index - 1]), key) < 0, 'New target rows are not typed-PK ordered');
      for (const column of table.columns) {
        const expected = operation.result.row_template[column.name];
        check(row[column.name] === (typeof expected === 'object' ? intent.payload.apply_time : expected), 'Target insert differs from fixed Plan/apply_time');
      }
    }
  }
  return target;
}

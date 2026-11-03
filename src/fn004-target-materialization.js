import { CANONICAL_TABLES, CANONICAL_SCHEMA } from './canonical-schema.js';
import { validateCanonicalTables } from './canonical-validator.js';
import { readCanonicalSnapshotFromAdapter } from './canonical-snapshot.js';
import { validateOwner } from './fn004-transaction-evidence.js';
import { validateStoredSuccessfulPlan } from './fn004-history-plan.js';
import { canonicalTypedKey } from './fn004-plan-primitives.js';
import { compareKeys } from './fn004-history-schema.js';
import { validateHypotheticalTarget } from './fn004-plan-target.js';
import { canonicalJson } from './canonical-hash.js';
import { RepositoryError } from './persistence.js';
import { parseCsv } from './csv.js';
import { check, same, timestamp, COMMIT_PATHS } from './fn004-evidence-types.js';

// Serializer rule 1. Values are canonical CSV strings, never coerced/normalized.
export function serializeCanonicalTable(tableName, rows) {
  const table = CANONICAL_SCHEMA[tableName];
  check(table && Array.isArray(rows), 'Unknown canonical serialization table');
  const columns = table.columns.map(column => column.name);
  const field = value => {
    check(typeof value === 'string', 'Canonical serialization requires string fields');
    return /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  };
  const raw = Buffer.from(columns.join(',') + '\n' + rows.map(row => {
    check(row && same(Object.keys(row).sort(), [...columns].sort()), 'Canonical row column mismatch');
    return columns.map(column => field(row[column])).join(',') + '\n';
  }).join(''), 'utf8');
  try {
    canonicalJson(rows);
    check(same(parseCsv(raw.toString('utf8'), { strict: true }), [columns, ...rows.map(row => columns.map(column => row[column]))]),
      'CSV serialization changed field values');
  } catch (cause) { throw new RepositoryError('INTEGRITY_CONFLICT', 'Invalid canonical serialization input', { cause }); }
  return raw;
}

export function materializedOperationRow(operation, applyTime) {
  if (operation.classification !== 'insert') {
    check(['reuse', 'no_op'].includes(operation.classification), 'Unsupported materialization operation');
    return structuredClone(operation.result.existing_row);
  }
  return Object.fromEntries(Object.entries(operation.result.row_template).map(([key, value]) => {
    if (typeof value !== 'object') return [key, value];
    check(['created_at', 'updated_at'].includes(key) && same(value, { system_binding: 'apply_time' }), 'Invalid time binding');
    return [key, applyTime];
  }));
}

// Memory only. The source of original bytes is the bound snapshot, never a
// later read of current canonical. No ID allocation, clock or filesystem write.
export async function materializeCanonicalTarget({ owner, inputs, original, apply_time }) {
  owner = JSON.parse(canonicalJson(owner)); inputs = JSON.parse(canonicalJson(inputs));
  validateOwner(owner, inputs); timestamp(apply_time);
  const raw = Object.fromEntries(Object.entries(original.rawBytes).map(([path, value]) => [path, Buffer.from(value)]));
  const source = await readCanonicalSnapshotFromAdapter({ list: () => Object.keys(raw).map(path => path.slice(5)), read: path => raw[path] });
  check(source.validation.ok && same(source.manifest, owner.payload.original_manifest) && same(original.manifest, source.manifest),
    'Materialization original snapshot mismatch');
  validateStoredSuccessfulPlan(inputs.plan, inputs.decision);
  const plan = inputs.plan.payload, hypothetical = validateHypotheticalTarget({ snapshot: source, operations: plan.operations });
  check(hypothetical.applicability.applicable && hypothetical.validation.target_semantic_hash === plan.validation.target_semantic_hash,
    'Saved hypothetical target differs from original/operations');
  const tables = structuredClone(source.tables), inserts = new Map(CANONICAL_TABLES.map(table => [table.name, []]));
  for (const operation of plan.operations) {
    const row = materializedOperationRow(operation, apply_time);
    const existing = source.tables[operation.table].find(value => same(canonicalTypedKey(operation.table, value), operation.key));
    if (operation.classification === 'insert') {
      check(!existing && COMMIT_PATHS.includes(CANONICAL_SCHEMA[operation.table].path), 'Insert collides with original or readonly table');
      inserts.get(operation.table).push(row);
    } else check(existing && same(existing, row), 'Reuse/no_op does not preserve original row');
  }
  for (const [table, rows] of inserts) tables[table].push(...rows.sort((a, b) =>
    compareKeys(table, canonicalTypedKey(table, a), canonicalTypedKey(table, b))));
  const validation = validateCanonicalTables(tables);
  if (!validation.ok) throw new RepositoryError('CANONICAL_INVALID', 'Materialized target failed whole validation', { diagnostics: validation.diagnostics });
  const rawBytes = Object.fromEntries(CANONICAL_TABLES.map(table => [table.path, inserts.get(table.name).length ?
    serializeCanonicalTable(table.name, tables[table.name]) : Buffer.from(raw[table.path])]));
  const target = await readCanonicalSnapshotFromAdapter({ list: () => CANONICAL_TABLES.map(table => table.path.slice(5)), read: path => rawBytes[path] });
  check(target.validation.ok && same(target.tables, tables), 'Serialized target failed roundtrip/whole validation');
  const changed_paths = COMMIT_PATHS.filter(path => !same(source.manifest.files.find(file => file.path === path),
    target.manifest.files.find(file => file.path === path)));
  return { original: source, target, changed_paths, apply_time };
}

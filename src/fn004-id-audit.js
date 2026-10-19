import { CANONICAL_TABLES, CANONICAL_SCHEMA } from "./canonical-schema.js";
import { parseCsv } from "./csv.js";
import { RepositoryError } from "./persistence.js";

// Derive namespaces from master identity patterns, not a second prefix list.
const masters = CANONICAL_TABLES.filter((table) => table.primaryKey.length === 1 &&
  table.columns.some((column) => column.name === table.primaryKey[0] && column.type === "id" && column.target === table.name));
export const ID_NAMESPACES = Object.freeze([...new Set(masters.flatMap((table) => {
  const column = table.columns.find((item) => item.name === table.primaryKey[0]);
  return Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)).filter((prefix) => column.pattern.test(`${prefix}00000`));
}))].sort());
export const emptyMaxima = () => Object.fromEntries(ID_NAMESPACES.map((key) => [key, 0]));
export const maximumMaps = (...maps) => Object.fromEntries(ID_NAMESPACES.map((key) => [key, Math.max(...maps.map((map) => map[key]))]));
export const exhaustedNamespaces = (map) => ID_NAMESPACES.filter((key) => map[key] === 99999);

function consume(maxima, column, value, details) {
  if (value === "" && !column.required) return;
  if (typeof value !== "string" || !column.pattern.test(value) || !Object.hasOwn(maxima, value[0])) {
    throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Cannot interpret canonical ID", { ...details, column: column.name, key: value });
  }
  maxima[value[0]] = Math.max(maxima[value[0]], Number(value.slice(1)));
}

// Caller supplies a whole-validated snapshot. This also checks identity values
// independently so malformed IDs cannot silently disappear from a projection.
export function currentIdMaxima(snapshot) {
  const maxima = emptyMaxima();
  for (const table of masters) {
    const column = table.columns.find((item) => item.name === table.primaryKey[0]);
    if (!Array.isArray(snapshot.tables[table.name])) throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Missing canonical master", { table: table.name });
    for (const row of snapshot.tables[table.name]) consume(maxima, column, row[column.name], { file: table.path });
  }
  return maxima;
}

// Historical non-ID columns may evolve. Every known identity column remains
// required in the header; relation references count as historical usage too.
export function historicalCsvMaxima(path, bytes) {
  const table = CANONICAL_SCHEMA[path.slice(5, -4)];
  if (!table || table.path !== path) throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Unknown historical canonical table", { path });
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const records = parseCsv(text, { strict: true });
    const header = records.shift();
    const columns = table.columns.filter((column) => column.type === "id");
    if (!header?.length || header.some((name) => !name) || new Set(header).size !== header.length ||
        columns.some((column) => !header.includes(column.name)) ||
        header.some((name) => (name === "id" || name.endsWith("_id")) && !table.columns.some((column) => column.name === name))) {
      throw new Error("Unidentifiable historical identity columns");
    }
    const maxima = emptyMaxima();
    for (const [index, record] of records.entries()) {
      if (record.length !== header.length) throw new Error("Historical CSV column count mismatch");
      for (const column of columns) consume(maxima, column, record[header.indexOf(column.name)], { file: path, row: index + 2 });
    }
    return maxima;
  } catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Historical canonical CSV cannot be audited", { path, cause });
  }
}

import { CANONICAL_TABLES, CANONICAL_SCHEMA } from "./canonical-schema.js";

export function isCanonicalDate(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function datetimeValid(value) {
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(Z|[+-]([0-9]{2}):([0-9]{2}))$/.exec(value);
  return Boolean(match && isCanonicalDate(match[1]) && +match[2] < 24 && +match[3] < 60 && +match[4] < 60 &&
    (match[5] === "Z" || (+match[6] < 24 && +match[7] < 60)));
}

function urlValid(value) {
  if (!/^[\x21-\x7E]+$/.test(value) || !/^https:\/\//.test(value) || value.includes("\\")) return false;
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname); }
  catch { return false; }
}

export function canonicalDiagnostic(code, schema, message, details = {}) {
  return { code, severity: "error", file: schema.path, table: schema.name, ...details, message };
}

function valueError(column, value) {
  if (typeof value !== "string") return "INVALID_FIELD_TYPE";
  if (value === "") return column.required ? "REQUIRED_FIELD_MISSING" : null;
  switch (column.type) {
    case "id": return column.pattern.test(value) ? null : "INVALID_ID";
    case "enum": return column.values.includes(value) ? null : "INVALID_ENUM";
    case "integer": return /^[0-9]+$/.test(value) && BigInt(value) >= BigInt(column.min) ? null : "INVALID_INTEGER";
    case "date": return isCanonicalDate(value) ? null : "INVALID_DATE";
    case "datetime": return datetimeValid(value) ? null : "INVALID_DATETIME";
    case "url": return urlValid(value) ? null : "INVALID_URL";
    default: return null;
  }
}

// Keys use typed integer values, so e.g. track 01 and track 1 are the same key.
function keyOf(schema, row, columns) {
  const values = [];
  for (const name of columns) {
    const column = schema.columns.find((item) => item.name === name);
    const value = row[name];
    if (value === "" || valueError(column, value)) return null;
    values.push(column.type === "integer" ? BigInt(value).toString() : value);
  }
  return JSON.stringify(values);
}

// Pure whole-canonical validation. Rows retain CSV strings; no normalization or
// mutation. Diagnostics use 1-based CSV record numbers (header = record 1).
export function validateCanonicalTables(tables) {
  if (tables === null || typeof tables !== "object" || Array.isArray(tables)) {
    return { ok: false, diagnostics: [{ code: "INVALID_CANONICAL_TABLES", severity: "error", message: "Expected an object of canonical table arrays" }] };
  }
  const diagnostics = [];
  const validRows = {};
  const add = (code, schema, message, details) => diagnostics.push(canonicalDiagnostic(code, schema, message, details));
  for (const name of Object.keys(tables).sort()) {
    if (!Object.hasOwn(CANONICAL_SCHEMA, name)) diagnostics.push({ code: "UNEXPECTED_CANONICAL_TABLE", severity: "error", table: name, message: "Unknown canonical table" });
  }
  for (const schema of CANONICAL_TABLES) {
    const rows = tables[schema.name];
    validRows[schema.name] = [];
    if (!Array.isArray(rows)) { add("CANONICAL_TABLE_MISSING", schema, "Expected a row array"); continue; }
    Array.from(rows).forEach((row, index) => {
      const details = { row: index + 2 };
      if (row === null || typeof row !== "object" || Array.isArray(row)) { add("INVALID_ROW", schema, "Expected a row object", details); return; }
      validRows[schema.name].push({ row, number: index + 2 });
      const names = new Set(schema.columns.map((column) => column.name));
      for (const name of Object.keys(row).sort()) if (!names.has(name)) add("UNEXPECTED_COLUMN", schema, "Unknown column", { ...details, column: name });
      for (const column of schema.columns) {
        const code = Object.hasOwn(row, column.name) ? valueError(column, row[column.name]) : "COLUMN_MISSING";
        if (code) add(code, schema, `Invalid ${column.name} (${column.type})`, { ...details, column: column.name });
      }
      if (schema.period) {
        const [start, end] = schema.period;
        if (isCanonicalDate(row[start]) && isCanonicalDate(row[end]) && row[start] > row[end]) {
          add("INVALID_PERIOD", schema, "End date precedes start date", { ...details, column: end });
        }
      }
    });
  }

  const indexes = new Map();
  const indexFor = (schema, columns) => {
    const identity = JSON.stringify([schema.name, columns]);
    if (!indexes.has(identity)) {
      const index = new Set();
      for (const { row } of validRows[schema.name]) { const key = keyOf(schema, row, columns); if (key !== null) index.add(key); }
      indexes.set(identity, index);
    }
    return indexes.get(identity);
  };
  for (const schema of CANONICAL_TABLES) {
    const unique = (columns, code, optional = false) => {
      const seen = new Set();
      for (const { row, number } of validRows[schema.name]) {
        if (optional && row[columns.at(-1)] === "") continue;
        const key = keyOf(schema, row, columns);
        if (key === null) continue;
        if (seen.has(key)) add(code, schema, `Duplicate ${columns.join(", ")}`, { row: number, column: columns.join(","), key });
        seen.add(key);
      }
    };
    unique(schema.primaryKey, "DUPLICATE_PRIMARY_KEY");
    for (const columns of schema.unique) unique(columns, "DUPLICATE_UNIQUE_VALUE");
    for (const order of schema.orders) unique([...order.scope, order.column], "DUPLICATE_ORDER", true);
    for (const reference of schema.foreignKeys) {
      const target = CANONICAL_SCHEMA[reference.table];
      const index = indexFor(target, reference.targetColumns);
      for (const { row, number } of validRows[schema.name]) {
        const key = keyOf(schema, row, reference.columns);
        if (key !== null && !index.has(key)) add(reference.columns.length > 1 ? "COMPOUND_FOREIGN_KEY_NOT_FOUND" : "FOREIGN_KEY_NOT_FOUND", schema,
          `Reference not found in ${reference.table}`, { row: number, column: reference.columns.join(","), key });
      }
    }
    if (schema.requiredRelation) {
      const relation = schema.requiredRelation;
      const target = CANONICAL_SCHEMA[relation.table];
      const matching = new Set(validRows[target.name].filter(({ row }) => Object.entries(relation.where).every(([field, value]) => row[field] === value) &&
        keyOf(target, row, target.primaryKey) !== null).map(({ row }) => row[relation.column]));
      for (const { row, number } of validRows[schema.name]) {
        if (keyOf(schema, row, schema.primaryKey) !== null && !matching.has(row[relation.column])) {
          add(relation.code, schema, "Song requires at least one primary artist", { row: number, column: relation.column, key: row[relation.column] });
        }
      }
    }
    if (schema.nonOverlapping) {
      const groups = new Map();
      const [start, end] = schema.period;
      for (const item of validRows[schema.name]) {
        const key = keyOf(schema, item.row, schema.nonOverlapping);
        if (key === null || !isCanonicalDate(item.row[start]) || (item.row[end] !== "" && !isCanonicalDate(item.row[end])) || (item.row[end] && item.row[start] > item.row[end])) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      for (const [key, items] of groups) {
        items.sort((a, b) => a.row[start] < b.row[start] ? -1 : a.row[start] > b.row[start] ? 1 : a.number - b.number);
        let latestEnd = "";
        for (const { row, number } of items) {
          if (row[start] <= latestEnd) add("OVERLAPPING_PERIOD", schema, "Affiliation periods for the same member and artist overlap", { row: number, column: start, key });
          const until = row[end] || "9999-12-31";
          if (until > latestEnd) latestEnd = until;
        }
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

// Shared cell rules for readonly stored-row verification.
export { valueError as canonicalValueError };

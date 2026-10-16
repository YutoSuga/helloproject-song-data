import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "./csv.js";
import { CANONICAL_TABLES, CANONICAL_SCHEMA_VERSION } from "./canonical-schema.js";
import { canonicalDiagnostic, validateCanonicalTables } from "./canonical-validator.js";
import { hashCanonicalJson, sha256 } from "./canonical-hash.js";

// Low-level readonly reader, NOT an atomic multi-file snapshot. The caller must
// prevent concurrent writers (the shared gate belongs to the next slice).
// Treat returned rawBytes/rows as readonly. Hash and parse use each same Buffer.
export async function readCanonicalSnapshot(root = process.cwd()) {
  const rawBytes = {}, tables = {}, files = [], diagnostics = [];
  const schemas = [...CANONICAL_TABLES].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let complete = true;
  try {
    const expected = new Set(schemas.map((schema) => schema.path.slice(5)));
    for (const name of (await readdir(join(root, "data"))).sort()) {
      if (name.endsWith(".csv") && !expected.has(name)) {
        diagnostics.push({ code: "UNEXPECTED_CANONICAL_TABLE", severity: "error", file: `data/${name}`, message: "Unknown canonical CSV" });
        complete = false;
      }
    }
  } catch (error) {
    diagnostics.push({ code: "CANONICAL_DIRECTORY_UNREADABLE", severity: "error", file: "data", message: error.code ?? "Cannot list canonical directory" });
    complete = false;
  }
  for (const schema of schemas) {
    tables[schema.name] = [];
    const add = (code, message, details) => diagnostics.push(canonicalDiagnostic(code, schema, message, details));
    let bytes;
    try { bytes = await readFile(join(root, ...schema.path.split("/"))); }
    catch (error) { add(error.code === "ENOENT" ? "CANONICAL_FILE_MISSING" : "CANONICAL_FILE_UNREADABLE", error.code ?? "Cannot read CSV"); complete = false; continue; }
    rawBytes[schema.path] = bytes;
    files.push({ path: schema.path, byte_length: bytes.byteLength, sha256: sha256(bytes) });
    let text, records;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { add("INVALID_UTF8", "Canonical CSV must be valid UTF-8"); continue; }
    try { records = parseCsv(text, { strict: true }); }
    catch (error) { add("INVALID_CSV", error.message); continue; }
    const header = records.shift();
    if (!header) { add("HEADER_MISSING", "CSV header is missing", { row: 1 }); continue; }
    const columns = schema.columns.map((column) => column.name);
    if (header.length !== columns.length || header.some((name, index) => name !== columns[index])) {
      add("HEADER_MISMATCH", "CSV header must exactly match schema column names and order", { row: 1 });
      continue;
    }
    // Do not drop blank records: they are structurally invalid data, unlike a
    // single optional terminating newline (which parseCsv already handles).
    let shapeValid = true;
    records.forEach((record, index) => {
      if (record.length !== columns.length) { add("COLUMN_COUNT_MISMATCH", "CSV record has an incorrect field count", { row: index + 2 }); shapeValid = false; }
    });
    if (shapeValid) tables[schema.name] = records.map((record) => Object.fromEntries(columns.map((name, index) => [name, record[index]])));
  }
  const semantic = validateCanonicalTables(tables);
  diagnostics.push(...semantic.diagnostics);
  // Formal contract: SHA-256 over JCS of the ASCII-path-sorted entry ARRAY.
  // schema_version describes this contract; it is not an extra hash wrapper.
  const manifest = complete ? { schema_version: CANONICAL_SCHEMA_VERSION, files, manifest_hash: hashCanonicalJson(files) } : null;
  return { rawBytes, tables, manifest, validation: { ok: diagnostics.length === 0, diagnostics } };
}

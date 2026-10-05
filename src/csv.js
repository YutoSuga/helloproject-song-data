import { readFile } from "node:fs/promises";

// RFC 4180 parser. In particular, delimiters and newlines inside quoted fields
// are data, and a doubled quote inside a quoted field represents one quote.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function readCsv(path) {
  const rows = parseCsv(await readFile(path, "utf8"));
  const headers = rows.shift();
  if (!headers) return [];
  return rows.filter((row) => row.some(Boolean)).map((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(`${path}: row ${rowIndex + 2} has ${row.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
}

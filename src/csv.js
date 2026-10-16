import { readFile } from "node:fs/promises";

// RFC 4180 parser. In particular, delimiters and newlines inside quoted fields
// are data, and a doubled quote inside a quoted field represents one quote.
export function parseCsv(text, { strict = false } = {}) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (strict && ((character < " " && character !== "\r" && character !== "\n") || character === "\x7f")) {
      throw new Error("Invalid control character in CSV field");
    }
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = strict;
      } else {
        field += character;
      }
    } else if (strict && closedQuote && ![",", "\n", "\r"].includes(character)) {
      throw new Error("Unexpected character after closing CSV quote");
    } else if (character === '"' && field.length === 0 && !closedQuote) {
      quoted = true;
    } else if (strict && character === '"') {
      throw new Error("Unexpected quote in unquoted CSV field");
    } else if (character === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (strict && character === "\r" && text[index + 1] !== "\n") throw new Error("CSV record endings must be LF or CRLF");
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (field.length > 0 || row.length > 0 || closedQuote) {
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

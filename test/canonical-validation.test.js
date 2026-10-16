import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_TABLES, CANONICAL_SCHEMA } from "../src/canonical-schema.js";
import { canonicalJson, hashCanonicalJson, sha256 } from "../src/canonical-hash.js";
import { validateCanonicalTables } from "../src/canonical-validator.js";
import { readCanonicalSnapshot } from "../src/canonical-snapshot.js";
import { parseCsv } from "../src/csv.js";
import { loadCanonicalData } from "../src/canonical.js";
import { loadReviewCanonical } from "../src/prepare-reviews.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const current = await readCanonicalSnapshot(root);
const tables = () => structuredClone(current.tables);
const check = (data) => validateCanonicalTables(data);
const codes = (result) => result.diagnostics.map((item) => item.code);
const completeRow = (name, values) => Object.fromEntries(CANONICAL_SCHEMA[name].columns.map(({ name }) => [name, values[name] ?? ""]));
const source = "https://example.test/evidence";
const time = "2026-10-16T10:00:00+09:00";

function videoData() {
  const data = tables(), song_id = data.songs[0].song_id;
  data.videos.push(completeRow("videos", { video_id: "V00001", youtube_video_id: "example001", title: "公式動画", channel_name: "公式", published_date: "2024-02-29", url: "https://www.youtube.com/watch?v=example001", source_url: source, created_at: time, updated_at: time }));
  data.video_songs.push(completeRow("video_songs", { video_id: "V00001", song_id, start_seconds: "0", performer_credit: "公式名義", source_url: source }));
  data.video_song_performers.push(completeRow("video_song_performers", { video_id: "V00001", song_id, start_seconds: "0", member_id: data.members[0].member_id, performer_order: "1", source_url: source }));
  return data;
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "hp-canonical-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, "data"), join(dir, "data"), { recursive: true });
  return dir;
}

test("current canonical: all 14 tables pass without changing legacy readers", async () => {
  assert.equal(CANONICAL_TABLES.length, 14);
  assert.deepEqual(current.validation, { ok: true, diagnostics: [] });
  assert.deepEqual(await loadReviewCanonical(root), current.tables);
  const legacy = await loadCanonicalData(root);
  for (const [name, rows] of Object.entries({ artists: legacy.artists, creators: legacy.creators, works: legacy.works, songs: legacy.songs, song_artists: legacy.songArtists, song_creators: legacy.songCreators })) assert.deepEqual(rows, current.tables[name]);
});

test("manifest: fixed paths, raw byte lengths/hashes, independent JCS hash, deterministic", async () => {
  const again = await readCanonicalSnapshot(root);
  assert.deepEqual(again, current);
  const { files, schema_version, manifest_hash } = current.manifest;
  assert.equal(schema_version, 1);
  assert.equal(files.length, 14);
  assert.deepEqual(files.map((item) => item.path), files.map((item) => item.path).sort());
  for (const file of files) {
    assert.match(file.path, /^data\/[a-z_]+\.csv$/);
    const bytes = await readFile(join(root, file.path));
    assert.deepEqual(bytes, current.rawBytes[file.path]);
    assert.equal(file.byte_length, bytes.length);
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  // Entry property names have a fixed lexical order, independent of API insertion.
  const independent = "[" + files.map(({ path, byte_length, sha256 }) => JSON.stringify({ byte_length, path, sha256 })).join(",") + "]";
  assert.equal(manifest_hash, createHash("sha256").update(independent).digest("hex"));
});

test("JCS: RFC 8785 primitive/number encoding, nested UTF-16 key sorting and no normalization", () => {
  assert.equal(canonicalJson({ z: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27], a: { b: true, a: null } }), '{"a":{"a":null,"b":true},"z":[333333333.3333333,1e+30,4.5,0.002,1e-27]}');
  assert.equal(canonicalJson({ "\uE000": 1, "😀": 2, "\r": 3, "1": 4 }), '{"\\r":3,"1":4,"😀":2,"":1}');
  assert.equal(hashCanonicalJson({ b: 2, a: 1 }), hashCanonicalJson({ a: 1, b: 2 }));
  assert.notEqual(hashCanonicalJson("é"), hashCanonicalJson("e\u0301"));
  assert.notEqual(hashCanonicalJson([1, 2]), hashCanonicalJson([2, 1]));
  assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), cycle, [undefined], Array(1), { x: undefined }, "\uDEAD", { "\uD800": 1 }]) assert.throws(() => canonicalJson(value), TypeError);
});

test("CSV strict parsing preserves quotes, commas, quoted newlines, UTF-8, empty and final fields", () => {
  const expected = [["日本語", "a,b", 'a"b', "line1\nline2", ""]];
  for (const ending of ["", "\n", "\r\n"]) assert.deepEqual(parseCsv('日本語,"a,b","a""b","line1\nline2",' + ending, { strict: true }), expected);
  assert.deepEqual(parseCsv('""', { strict: true }), [[""]]);
  for (const text of ['ab"cd', '"a"junk', '"a" "b"', '"open', 'a\rb', 'a\0b', '"a\tb"']) assert.throws(() => parseCsv(text, { strict: true }));
  assert.deepEqual(parseCsv('ab"cd'), [['ab"cd']]); // legacy default retained
});

for (const schema of CANONICAL_TABLES) {
  test(`${schema.name}: required schema, PK/compound PK, ID and enum constraints`, () => {
    const data = videoData();
    if (schema.name === "member_affiliations") data.member_affiliations.push(completeRow(schema.name, { member_id: data.members[0].member_id, artist_id: data.artists[0].artist_id, start_date: "2020-01-01", source_url: source }));
    assert.equal(check(data).ok, true);
    const original = structuredClone(data[schema.name][0]);
    data[schema.name].push(structuredClone(original));
    assert.ok(codes(check(data)).includes("DUPLICATE_PRIMARY_KEY"));
    data[schema.name].pop();
    for (const column of schema.columns) {
      const row = data[schema.name][0];
      if (column.required) {
        row[column.name] = "";
        assert.ok(codes(check(data)).includes("REQUIRED_FIELD_MISSING"), column.name);
      }
      row[column.name] = original[column.name];
      if (column.type === "id" || column.type === "enum") {
        row[column.name] = "invalid";
        assert.ok(codes(check(data)).includes(column.type === "id" ? "INVALID_ID" : "INVALID_ENUM"), column.name);
        row[column.name] = original[column.name];
      }
    }
    for (const name of schema.primaryKey) {
      data[schema.name][0][name] = "";
      assert.equal(check(data).ok, false);
      data[schema.name][0][name] = original[name];
    }
  });
  for (const reference of schema.foreignKeys) {
    test(`${schema.name}.${reference.columns.join("+")}: FK/compound reference integrity`, () => {
      const data = videoData();
      if (schema.name === "member_affiliations") data.member_affiliations.push(completeRow(schema.name, { member_id: data.members[0].member_id, artist_id: data.artists[0].artist_id, start_date: "2020-01-01", source_url: source }));
      const column = schema.columns.find((item) => item.name === reference.columns.at(-1));
      data[schema.name][0][column.name] = column.type === "integer" ? "123456" : column.pattern.source.match(/[A-Z]/)[0] + "99999";
      assert.ok(codes(check(data)).includes(reference.columns.length > 1 ? "COMPOUND_FOREIGN_KEY_NOT_FOUND" : "FOREIGN_KEY_NOT_FOUND"));
    });
  }
}

test("integers: strict full field, positive/non-negative and optional empty, without precision loss", () => {
  const data = videoData();
  for (const schema of CANONICAL_TABLES) for (const column of schema.columns.filter((item) => item.type === "integer")) {
    const row = data[schema.name][0], original = row[column.name];
    for (const value of ["1abc", "1.1", "1e2", "-1", "+1", " 1", "1 ", ...(column.min === 1 ? ["0"] : [])]) {
      row[column.name] = value;
      assert.ok(codes(check(data)).includes("INVALID_INTEGER"), `${schema.name}.${column.name}: ${value}`);
    }
    row[column.name] = original;
  }
  data.video_song_performers[0].start_seconds = "00";
  assert.equal(check(data).ok, true); // numeric compound FK matches 0
  data.video_songs[0].start_seconds = "9007199254740992";
  data.video_song_performers[0].start_seconds = "9007199254740992";
  assert.equal(check(data).ok, true); // spec defines no upper limit
  data.video_song_performers[0].start_seconds = "9007199254740993";
  assert.ok(codes(check(data)).includes("COMPOUND_FOREIGN_KEY_NOT_FOUND"));
  data.release_tracks.push({ ...data.release_tracks[0], disc_number: "0" + data.release_tracks[0].disc_number });
  assert.ok(codes(check(data)).includes("DUPLICATE_PRIMARY_KEY"));
});

test("dates/datetimes: calendar, leap years, timezone and future releases", () => {
  const data = tables(), row = data.releases[0];
  for (const value of ["2026-2-01", "2026-02-30", "1900-02-29", "2026-13-01", "2026-00-01", "2026-01-00", "2026-01-32"]) {
    row.release_date = value;
    assert.ok(codes(check(data)).includes("INVALID_DATE"), value);
  }
  for (const value of ["2000-02-29", "2099-12-31", ""]) { row.release_date = value; assert.equal(check(data).ok, true); }
  for (const value of ["2026-02-30T10:00:00Z", "2026-10-16T10:00:00", "2026-10-16T24:00:00Z", "2026-10-16T10:60:00Z", "2026-10-16T10:00:60Z", "2026-10-16T10:00:00+24:00", "2026-10-16T10:00:00+09:60"]) {
    row.created_at = value;
    assert.ok(codes(check(data)).includes("INVALID_DATETIME"), value);
  }
  for (const value of [time, "2026-10-16T01:00:00Z", "2026-10-16T01:00:00.123456-03:30"]) { row.created_at = value; assert.equal(check(data).ok, true); }
});

test("URLs: absolute ASCII HTTPS; optional source_url/notes stay optional", () => {
  const data = tables();
  for (const value of ["http://example.test/", "/relative", "https:", "https://", "https://example.test/a b", "https://example.test/日本語", "https:\\example.test"]) {
    data.works[0].source_url = value;
    assert.ok(codes(check(data)).includes("INVALID_URL"), value);
  }
  data.works[0].source_url = source;
  for (const name of ["artists", "creators", "members"]) { data[name][0].source_url = ""; data[name][0].notes = ""; }
  assert.equal(check(data).ok, true);
});

for (const schema of CANONICAL_TABLES.filter((item) => item.orders.length)) test(`${schema.name}: order uniqueness uses specified context, no contiguity rule`, () => {
  const data = videoData(), first = data[schema.name][0], order = schema.orders[0];
  const second = { ...first };
  // Change entity within the same order scope, keeping both FKs valid.
  const name = schema.name === "song_artists" ? "artist_id" : schema.name === "song_creators" ? "creator_id" : "member_id";
  const target = schema.columns.find((column) => column.name === name).target;
  second[name] = data[target].find((item) => item[name] !== first[name])[name];
  first[order.column] = "100"; second[order.column] = "100";
  data[schema.name].push(second);
  assert.ok(codes(check(data)).includes("DUPLICATE_ORDER"));
  second[order.column] = "102";
  // Existing records may already include this entity, so only assert the order rule.
  assert.ok(!codes(check(data)).includes("DUPLICATE_ORDER"));
  first[order.column] = ""; second[order.column] = "";
  assert.ok(!codes(check(data)).includes("DUPLICATE_ORDER"));
});

test("multiple primary artists and per-role artist order are allowed; missing primary rejected", () => {
  const data = tables(), song = data.songs[0].song_id;
  data.song_artists = data.song_artists.filter((row) => row.song_id !== song);
  assert.ok(codes(check(data)).includes("PRIMARY_ARTIST_MISSING"));
  for (const [index, artist] of data.artists.entries()) data.song_artists.push({ song_id: song, artist_id: artist.artist_id, role: index < 2 ? "primary" : "featured", credit_order: index < 2 ? String(index + 1) : "1", source_url: source });
  assert.equal(check(data).ok, true);
});

test("artist/member periods: end >= start, same-pair overlap including open ends, different artist allowed", () => {
  const data = tables(), member_id = data.members[0].member_id, artist_id = data.artists[0].artist_id;
  const add = (start, end, artist = artist_id) => data.member_affiliations.push(completeRow("member_affiliations", { member_id, artist_id: artist, start_date: start, end_date: end, source_url: source }));
  add("2020-01-01", "2020-12-31"); add("2021-01-01", ""); add("2020-02-01", "", data.artists[1].artist_id);
  assert.equal(check(data).ok, true);
  add("2022-01-01", "2022-01-01");
  assert.ok(codes(check(data)).includes("OVERLAPPING_PERIOD"));
  data.member_affiliations.pop();
  add("2020-12-31", "2021-01-02");
  assert.ok(codes(check(data)).includes("OVERLAPPING_PERIOD"));
  data.member_affiliations.pop();
  data.member_affiliations[0].end_date = "2019-12-31";
  assert.ok(codes(check(data)).includes("INVALID_PERIOD"));
  data.artists[0].start_date = "2020-01-01"; data.artists[0].end_date = "2019-12-31";
  assert.ok(check(data).diagnostics.some((item) => item.table === "artists" && item.code === "INVALID_PERIOD"));
});

test("video: unique YouTube identity/URL and exact interval (not just separate video/song FKs)", () => {
  const data = videoData();
  assert.equal(check(data).ok, true);
  data.video_song_performers[0].start_seconds = "1";
  assert.ok(codes(check(data)).includes("COMPOUND_FOREIGN_KEY_NOT_FOUND"));
  data.video_song_performers[0].start_seconds = "0";
  data.videos.push({ ...data.videos[0], video_id: "V00002" });
  assert.equal(check(data).diagnostics.filter((item) => item.code === "DUPLICATE_UNIQUE_VALUE").length, 2);
});

test("diagnostics: structured, deterministic, pure and no process.exit", () => {
  for (const invalid of [null, undefined, [], "invalid"]) assert.deepEqual(codes(check(invalid)), ["INVALID_CANONICAL_TABLES"]);
  const data = tables(); data.songs[0].song_id = "bad"; data.releases[0].release_date = "bad";
  const before = structuredClone(data), result = check(data);
  assert.equal(result.ok, false);
  assert.deepEqual(check(data), result);
  assert.deepEqual(data, before);
  const diagnostic = result.diagnostics.find((item) => item.code === "INVALID_ID");
  assert.deepEqual({ ...diagnostic, message: "" }, { code: "INVALID_ID", severity: "error", file: "data/songs.csv", table: "songs", row: 2, column: "song_id", message: "" });
  assert.ok(typeof diagnostic.message === "string");
  delete data.works;
  assert.ok(codes(check(data)).includes("CANONICAL_TABLE_MISSING"));
  data.unknown = [];
  assert.ok(codes(check(data)).includes("UNEXPECTED_CANONICAL_TABLE"));
  data.songs[0] = null;
  assert.ok(codes(check(data)).includes("INVALID_ROW"));
  data.songs = Array(1);
  assert.ok(codes(check(data)).includes("INVALID_ROW"));
});

for (const [name, mutate, expected] of [
  ["missing header", () => "", "HEADER_MISSING"],
  ["missing column", (text) => text.replace("work_id,title,", "title,"), "HEADER_MISMATCH"],
  ["reordered header", (text) => text.replace("work_id,title,", "title,work_id,"), "HEADER_MISMATCH"],
  ["unexpected column", (text) => text.replace("work_id,title,", "work_id,extra,title,"), "HEADER_MISMATCH"],
  ["duplicate column", (text) => text.replace("work_id,title,", "work_id,work_id,"), "HEADER_MISMATCH"],
  ["wrong record width", (text) => text + "W99999,Title\n", "COLUMN_COUNT_MISMATCH"],
  ["quote after unquoted data", (text) => text + 'ab"cd\n', "INVALID_CSV"],
  ["junk after quote", (text) => text + '"bad"junk\n', "INVALID_CSV"],
  ["unclosed quote", (text) => text + '"bad', "INVALID_CSV"],
  ["empty record", (text) => text + "\n", "COLUMN_COUNT_MISMATCH"]
]) test(`snapshot rejects ${name}`, async (t) => {
  const dir = await fixture(t), path = join(dir, "data/works.csv");
  await writeFile(path, mutate(await readFile(path, "utf8")));
  const result = await readCanonicalSnapshot(dir);
  assert.equal(result.validation.ok, false);
  assert.ok(codes(result.validation).includes(expected));
  assert.deepEqual((await readCanonicalSnapshot(dir)).validation, result.validation);
});

test("empty tables: all 14 headers required, empty rows are valid", async (t) => {
  const dir = await fixture(t);
  for (const schema of CANONICAL_TABLES) await writeFile(join(dir, schema.path), schema.columns.map((column) => column.name).join(",") + "\n");
  assert.equal((await readCanonicalSnapshot(dir)).validation.ok, true);
  for (const schema of CANONICAL_TABLES) {
    const path = join(dir, schema.path), header = await readFile(path);
    await writeFile(path, "");
    assert.ok((await readCanonicalSnapshot(dir)).validation.diagnostics.some((item) => item.table === schema.name && item.code === "HEADER_MISSING"));
    await writeFile(path, header);
  }
});

test("missing file/unknown CSV suppress complete manifest; malformed UTF-8 is an error", async (t) => {
  const dir = await fixture(t), path = join(dir, "data/videos.csv");
  await rm(path);
  let snapshot = await readCanonicalSnapshot(dir);
  assert.equal(snapshot.manifest, null);
  assert.ok(codes(snapshot.validation).includes("CANONICAL_FILE_MISSING"));
  await writeFile(path, Buffer.from([0xc3, 0x28]));
  snapshot = await readCanonicalSnapshot(dir);
  assert.ok(codes(snapshot.validation).includes("INVALID_UTF8"));
  assert.equal(snapshot.manifest.files.find((item) => item.path === "data/videos.csv").sha256, sha256(Buffer.from([0xc3, 0x28])));
  await writeFile(join(dir, "data/unknown.csv"), "x\n");
  snapshot = await readCanonicalSnapshot(dir);
  assert.equal(snapshot.manifest, null);
  assert.ok(codes(snapshot.validation).includes("UNEXPECTED_CANONICAL_TABLE"));
});

test("snapshot uses the returned bytes for parsing and hashes; LF/CRLF and quoting alter only identity", async (t) => {
  const dir = await fixture(t), path = join(dir, "data/works.csv");
  const original = await readFile(path);
  // One ASCII byte changes a non-identity header's spelling; still hash the exact bytes on validation failure.
  const changed = Buffer.from(original); changed[0] ^= 1;
  await writeFile(path, changed);
  const bad = await readCanonicalSnapshot(dir);
  assert.notEqual(bad.manifest.manifest_hash, current.manifest.manifest_hash);
  assert.equal(bad.manifest.files.find((item) => item.path === "data/works.csv").sha256, sha256(changed));
  assert.deepEqual(current.rawBytes["data/works.csv"], original); // earlier snapshot unaffected
  const text = original.toString("utf8");
  for (const variant of [text.replaceAll("\n", "\r\n"), text.replace("W00001", '"W00001"'), text.replace(/\n$/, "")]) {
    await writeFile(path, variant);
    const snapshot = await readCanonicalSnapshot(dir);
    assert.equal(snapshot.validation.ok, true);
    assert.deepEqual(snapshot.tables, current.tables);
    assert.notEqual(snapshot.manifest.manifest_hash, current.manifest.manifest_hash);
    assert.equal(snapshot.manifest.files.find((item) => item.path === "data/works.csv").sha256, sha256(snapshot.rawBytes["data/works.csv"]));
  }
});

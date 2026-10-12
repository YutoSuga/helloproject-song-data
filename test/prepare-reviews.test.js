import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSongReviews, loadReviewCanonical, prepareReviews, saveSongReviews, sortCandidates, validateCandidates, validateReviewResults } from "../src/prepare-reviews.js";

const candidate = (id, title = "New Song", date = "2020-01-01", extra = {}) => ({ candidate_id: id, title, release_date: date, artist_name: "Group", source_url: "https://example.test/release", source_release_url: "https://example.test/release", edition: "【初回生産限定盤A】", product_number: id, credits: { lyrics: { raw: "作詞：Writer", names: ["Writer"] }, performer: { raw: "歌：Group", names: ["Group"] } }, ...extra });
const canonical = () => ({ artists: [{ artist_id: "G00001", name: "Group", type: "group" }], creators: [{ creator_id: "C00001", name: "Writer" }], works: [{ work_id: "W00001", title: "Old Song" }], songs: [{ song_id: "J00001", work_id: "W00001", title: "Old Song", release_date: "2019-01-01", version_type: "original", version_name: "" }], song_creators: [{ song_id: "J00001", creator_id: "C00001", role: "lyrics", credit_name: "Writer" }] });
const csv = (header, rows = []) => header + "\n" + rows.map((row) => row.join(",")).join("\n") + (rows.length ? "\n" : "");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hp-reviews-"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "staging"));
  const data = {
    artists: csv("artist_id,name,type", [["G00001", "Group", "group"]]),
    creators: csv("creator_id,name", [["C00001", "Writer"]]),
    works: csv("work_id,title", [["W00001", "Old Song"]]),
    songs: csv("song_id,work_id,title,release_date,version_type,version_name", [["J00001", "W00001", "Old Song", "2019-01-01", "original", ""]]),
    song_artists: csv("song_id,artist_id,role"),
    song_creators: csv("song_id,creator_id,role,credit_name", [["J00001", "C00001", "lyrics", "Writer"]]),
    members: csv("member_id"), member_affiliations: csv("member_id,artist_id,start_date"), song_performers: csv("song_id,member_id"),
    releases: csv("release_id"), release_tracks: csv("release_id,disc_number,track_number"),
    videos: csv("video_id"), video_songs: csv("video_id,song_id,start_seconds"), video_song_performers: csv("video_id,song_id,start_seconds,member_id")
  };
  for (const [name, content] of Object.entries(data)) await writeFile(join(root, "data", name + ".csv"), content);
  return { root, data };
}

test("A/B/C: release date and letter editions determine stable processing order", () => {
  const rows = [candidate("late", "X", "2021-01-01"), candidate("b", "X", "2020-01-01", { edition: "【初回生産限定盤B】", product_number: "1" }), candidate("c", "X", "2020-01-01", { edition: "【初回生産限定盤C】", product_number: "0" }), candidate("a", "X", "2020-01-01", { edition: "【初回生産限定盤A】", product_number: "2" })];
  assert.deepEqual(sortCandidates(rows).map((row) => row.candidate_id), ["a", "b", "c", "late"]);
  assert.deepEqual(sortCandidates([...rows].reverse()).map((row) => row.candidate_id), ["a", "b", "c", "late"]);
});

test("C: SP and non-letter editions use only source tie-break", () => {
  const rows = [candidate("z", "X", "2020-01-01", { edition: "【通常盤】", product_number: "2" }), candidate("a", "X", "2020-01-01", { edition: "【初回生産限定盤SP】", product_number: "1" })];
  assert.deepEqual(sortCandidates(rows).map((row) => row.candidate_id), ["a", "z"]);
});

test("D-H: canonical priority, provisional reuse, release context, and exact resolution", () => {
  const data = canonical();
  const rows = [candidate("new2", "New Song", "2020-02-01"), candidate("new1", "New Song", "2020-01-01"), candidate("old", "Old Song", "2020-03-01")];
  const result = buildSongReviews(rows, data).reviews;
  const [first, second, third] = result;
  assert.equal(first.candidate_id, "new1");
  assert.equal(first.provisional_work.provisional_work_id, second.provisional_work.provisional_work_id);
  assert.equal(first.release_order.work_candidate_position, 1);
  assert.equal(second.release_order.work_candidate_position, 2);
  assert.equal(first.release_order.original_candidate, true);
  assert.ok(first.human_required.includes("version_type"));
  assert.equal(first.resolved.version_type, undefined);
  assert.equal(third.provisional_work, null);
  assert.deepEqual(third.canonical_matches.works.exact.map((row) => row.work_id), ["W00001"]);
  assert.deepEqual(third.canonical_matches.songs.exact.map((row) => row.song_id), ["J00001"]);
  assert.equal(third.release_order.older_canonical_song, true);
  assert.equal(third.resolved.artist_id, "G00001");
  assert.equal(third.canonical_matches.creators[0].resolved_creator_id, "C00001");
  assert.equal(third.resolved.work_id, undefined);
  assert.equal(third.resolved.song_id, undefined);
});

test("I/J/L: ambiguity remains reviewable, bad source is blocked, hold survives", () => {
  const data = canonical();
  data.works.push({ work_id: "W00002", title: "Old Song" });
  data.songs.push({ song_id: "J00002", work_id: "W00002", title: "Old Song", release_date: "2018-01-01" });
  data.creators.push({ creator_id: "C00002", name: "Writer" });
  const old = candidate("old", "Old Song");
  const bad = candidate("bad", "", "2020-01-01");
  const result = buildSongReviews([bad, old, candidate("next", "New Song", "2021-01-01")], data, new Map([["old", { candidate_id: "old", status: "hold", notes: "check", decision: { version_type: "cover" } }]])).reviews;
  assert.equal(result.find((row) => row.candidate_id === "bad").blocked[0], "missing_title");
  const review = result.find((row) => row.candidate_id === "old");
  assert.equal(review.canonical_matches.works.exact.length, 2);
  assert.equal(review.canonical_matches.songs.exact.length, 2);
  assert.equal(review.canonical_matches.creators[0].exact.length, 2);
  assert.equal(review.previous_review_result.notes, "check");
  assert.equal(review.blocked.length, 0);
  assert.ok(result.find((row) => row.candidate_id === "next").provisional_work);
});

test("P: both input schema versions and duplicate IDs are validated", () => {
  assert.throws(() => validateCandidates({ schema_version: 2, candidates: [] }), /schema/);
  assert.throws(() => validateCandidates({ schema_version: 1, candidates: [{ candidate_id: "x" }, { candidate_id: "x" }] }), /Duplicate/);
  assert.throws(() => validateReviewResults({ schema_version: 2, results: [] }), /schema/);
  assert.throws(() => validateReviewResults({ schema_version: 1, results: [{ candidate_id: "x", status: "other" }] }), /entry/);
});

test("K/M/N: STOP preserves output; rerun regenerates; all inputs stay byte-identical", async () => {
  const { root, data } = await fixture();
  try {
    const candidatePath = join(root, "staging", "song-candidates.json"), resultPath = join(root, "staging", "review-results.json"), outputPath = join(root, "staging", "song-reviews.json");
    await writeFile(candidatePath, JSON.stringify({ schema_version: 1, candidates: [candidate("x")] }));
    await writeFile(resultPath, JSON.stringify({ schema_version: 1, results: [{ candidate_id: "x", status: "hold", notes: "needs check" }] }));
    const beforeCandidates = await readFile(candidatePath), beforeResults = await readFile(resultPath);
    const first = await prepareReviews({ root });
    assert.equal(first.reviews[0].previous_review_result.status, "hold");
    assert.equal(first.reviews[0].previous_review_result.notes, "needs check");
    assert.equal((await readFile(outputPath, "utf8")).includes("needs check"), true);
    await writeFile(outputPath, "stale");
    await prepareReviews({ root });
    assert.notEqual(await readFile(outputPath, "utf8"), "stale");
    assert.deepEqual(await readFile(candidatePath), beforeCandidates);
    assert.deepEqual(await readFile(resultPath), beforeResults);
    for (const [name, original] of Object.entries(data)) assert.equal(await readFile(join(root, "data", name + ".csv"), "utf8"), original);
    await writeFile(join(root, "data", "works.csv"), csv("work_id,title", [["W00001", "Old Song"], ["W00001", "Again"]]));
    const stable = await readFile(outputPath);
    await assert.rejects(prepareReviews({ root }), /duplicate key/);
    assert.deepEqual(await readFile(outputPath), stable);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("first run accepts absent review-results; malformed review-results and missing canonical STOP", async () => {
  const { root } = await fixture();
  try {
    await writeFile(join(root, "staging", "song-candidates.json"), JSON.stringify({ schema_version: 1, candidates: [candidate("x")] }));
    assert.equal((await prepareReviews({ root })).reviews[0].previous_review_result, null);
    const output = await readFile(join(root, "staging", "song-reviews.json"));
    await writeFile(join(root, "staging", "review-results.json"), '{"schema_version":2,"results":[]}');
    await assert.rejects(prepareReviews({ root }), /review-results schema/);
    assert.deepEqual(await readFile(join(root, "staging", "song-reviews.json")), output);
    await rm(join(root, "data", "works.csv"));
    await assert.rejects(prepareReviews({ root }), /Missing canonical CSV/);
    assert.deepEqual(await readFile(join(root, "staging", "song-reviews.json")), output);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("candidate schema damage and canonical CSV parse failure STOP before output", async () => {
  const { root } = await fixture();
  try {
    const candidatePath = join(root, "staging", "song-candidates.json");
    const outputPath = join(root, "staging", "song-reviews.json");
    await writeFile(outputPath, "original");
    await writeFile(candidatePath, '{"schema_version":2,"candidates":[]}');
    await assert.rejects(prepareReviews({ root }), /song-candidates schema/);
    await writeFile(candidatePath, JSON.stringify({ schema_version: 1, candidates: [candidate("x")] }));
    await writeFile(join(root, "data", "works.csv"), 'work_id,title\n"W00001,broken\n');
    await assert.rejects(prepareReviews({ root }), /Unclosed quoted CSV field/);
    assert.equal(await readFile(outputPath, "utf8"), "original");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("O: failed atomic save preserves output and removes its temporary file", async () => {
  const { root } = await fixture();
  try {
    const path = join(root, "staging", "song-reviews.json");
    await writeFile(path, "previous");
    await assert.rejects(saveSongReviews(path, { schema_version: 1, reviews: [] }, { renameFile: async () => { throw new Error("rename failed"); } }), /rename failed/);
    assert.equal(await readFile(path, "utf8"), "previous");
    assert.deepEqual((await readdir(join(root, "staging"))).filter((name) => name.includes(".tmp")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("current repository canonical and candidate inputs can produce reviews without writing", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const data = await loadReviewCanonical(root);
  const candidates = validateCandidates(JSON.parse(await readFile(join(root, "staging", "song-candidates.json"), "utf8")));
  const reviews = buildSongReviews(candidates, data);
  assert.equal(reviews.schema_version, 1);
  assert.equal(reviews.reviews.length, candidates.length);
});

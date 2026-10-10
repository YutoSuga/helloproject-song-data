import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeed, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { isInstrumental, parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { candidateId, makeCandidate, mergeCandidates } from "../src/collector/merge-candidates.js";
import { loadTitleIndex, matchExisting } from "../src/collector/match-existing.js";
import { collectCandidates } from "../src/collector/collect.js";

const fixture = (name) => readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
const config = artists.rosychronicle;
const release = { url: "https://helloproject.com/rosychronicle/release/7611/", type: "CDシングル" };
const streaming = { url: "https://helloproject.com/rosychronicle/release/7645/", type: "配信" };

test("list selects audio releases and excludes photobooks", async () => {
  const html = await fixture("release-list.html");
  const releases = parseReleaseList(html, config);
  assert.deepEqual(releases.map((x) => x.type), ["CDシングル", "配信"]);
  assert.throws(() => parseReleaseList(html.replace("写真集", "未分類"), config), /Unknown release types/);
});
test("official year feed supplies additional releases for the configured artist", async () => {
  const feed = parseReleaseFeed(await fixture("release-list.html"), config);
  assert.equal(feed.versionDir, "fixture-version");
  assert.deepEqual(feed.years, [2025, 2026]);
  const releases = parseReleaseFeedYear(JSON.parse(await fixture("release-feed-2025.json")), config);
  assert.deepEqual(releases.map((x) => x.url), ["https://helloproject.com/rosychronicle/release/7459/"]);
});
test("detail parses audio media, credits and product number, excluding BD and Instrumental", async () => {
  const detail = parseReleaseDetail(await fixture("release-detail.html"), release, config);
  assert.equal(detail.tracks.length, 1);
  assert.equal(detail.counts.audioTracks, 2);
  assert.equal(detail.counts.instrumentalExcluded, 1);
  assert.equal(detail.counts.videoExcluded, 1);
  assert.equal(detail.tracks[0].productNumber, "EPCE-7987");
  assert.deepEqual(detail.tracks[0].credits.lyrics.names, ["星部ショウ"]);
  assert.deepEqual(detail.tracks[0].credits.composition.names, ["星部ショウ"]);
  assert.deepEqual(detail.tracks[0].credits.arrangement.names, ["大久保薫"]);
  assert.deepEqual(detail.tracks[0].credits.performer.names, ["ロージークロニクル"]);
  assert.equal(isInstrumental("The Instrumental Story"), false);
  assert.equal(isInstrumental("曲 (Instrumental)"), true);
});
test("streaming media parses as audio", async () => {
  const detail = parseReleaseDetail(await fixture("streaming-detail.html"), streaming, config);
  assert.equal(detail.tracks[0].mediaType, "STREAMING");
  assert.equal(detail.tracks[0].title, "なんとかなるでしょ");
});
test("stable candidate ID, rediscovery and administrative fields", async () => {
  const detail = parseReleaseDetail(await fixture("release-detail.html"), release, config);
  const track = detail.tracks[0];
  const first = makeCandidate(config, release, detail, track, matchExisting(track.title, new Map()), "2026-01-01T00:00:00.000Z");
  assert.equal(first.candidate_id, candidateId(config, release.url, track));
  const corrected = { ...track, title: "Misery～愛の天秤～" };
  const next = makeCandidate(config, release, detail, corrected, first.match, "2026-01-08T00:00:00.000Z");
  assert.equal(next.candidate_id, first.candidate_id);
  const pending = mergeCandidates([first], [next], next.last_seen_at);
  assert.equal(pending.added, 0);
  assert.equal(pending.rediscovered, 1);
  assert.equal(pending.candidates[0].detected_at, first.detected_at);
  assert.equal(pending.candidates[0].last_seen_at, next.last_seen_at);
  assert.equal(pending.candidates[0].title, corrected.title);
  for (const status of ["hold", "rejected", "confirmed"]) {
    const old = { ...first, status, notes: "管理者メモ" };
    const result = mergeCandidates([old], [next], next.last_seen_at);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].status, status);
    assert.equal(result.candidates[0].notes, "管理者メモ");
  }
});
test("source position distinguishes editions and tracks, including streaming without a product number", async () => {
  const detail = parseReleaseDetail(await fixture("streaming-detail.html"), streaming, config);
  const track = detail.tracks[0];
  const id = candidateId(config, streaming.url, track);
  assert.equal(id, candidateId(config, streaming.url, { ...track, title: "表記修正" }));
  assert.notEqual(id, candidateId(config, streaming.url, { ...track, editionName: "別の盤" }));
  assert.notEqual(id, candidateId(config, streaming.url, { ...track, trackNumber: 2 }));
  assert.notEqual(id, candidateId(config, streaming.url, { ...track, discIndex: 1 }));
  const noNumber = { ...track, productNumber: null };
  assert.equal(candidateId(config, streaming.url, noNumber),
    candidateId(config, streaming.url, { ...noNumber, title: "表記修正" }));
});
test("legacy title-based IDs migrate without losing review fields or related candidates", async () => {
  const detail = parseReleaseDetail(await fixture("release-detail.html"), release, config);
  const track = detail.tracks[0];
  const next = makeCandidate(config, release, detail, track, matchExisting(track.title, new Map()), "2026-01-08T00:00:00.000Z");
  const legacyIdentity = [config.slug, release.url, track.mediaType,
    track.productNumber, String(track.discIndex), String(track.trackNumber), track.title.normalize("NFC")];
  const legacyId = `sc_${createHash("sha256").update(JSON.stringify(legacyIdentity)).digest("hex").slice(0, 24)}`;
  const old = { ...next, candidate_id: legacyId, status: "hold", notes: "要確認",
    detected_at: "2026-01-01T00:00:00.000Z" };
  const merged = mergeCandidates([old], [{ ...next, title: "表記修正" }], next.last_seen_at);
  assert.equal(merged.added, 0);
  assert.equal(merged.rediscovered, 1);
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.candidates[0].candidate_id, next.candidate_id);
  assert.equal(merged.candidates[0].status, "hold");
  assert.equal(merged.candidates[0].notes, "要確認");
  assert.equal(merged.candidates[0].detected_at, old.detected_at);
  const renamedLegacyIdentity = [...legacyIdentity.slice(0, -1), "別表記"];
  const renamedLegacy = { ...old, title: "別表記", candidate_id:
    `sc_${createHash("sha256").update(JSON.stringify(renamedLegacyIdentity)).digest("hex").slice(0, 24)}` };
  assert.throws(() => mergeCandidates([old, renamedLegacy], [], next.last_seen_at), /Duplicate source position/);
  const related = mergeCandidates([], [next, { ...next, candidate_id: candidateId(config, release.url,
    { ...track, editionName: "別の盤" }), edition: "別の盤" }], next.last_seen_at);
  assert.deepEqual(related.candidates.map((c) => c.related_candidates.length), [1, 1]);
});
test("a related unit keeps its official artist name without inheriting the group ID", async () => {
  const detail = parseReleaseDetail(await fixture("streaming-detail.html"), streaming, config);
  const candidate = makeCandidate(
    { ...config, artistId: "G99999" }, streaming,
    { ...detail, artist: "ConChu!" }, detail.tracks[0],
    matchExisting(detail.tracks[0].title, new Map()), "2026-01-01T00:00:00.000Z"
  );
  assert.equal(candidate.artist_name, "ConChu!");
  assert.equal(candidate.artist_id, null);
  assert.equal(candidate.artist_slug, null);
  assert.equal(candidate.source_artist_slug, "rosychronicle");
});
test("canonical title match remains reference-only", async () => {
  const index = await loadTitleIndex(fileURLToPath(new URL("../", import.meta.url)));
  const match = matchExisting("微炭酸", index);
  assert.equal(match.state, "exact_title_match");
  assert.ok(match.song_ids.length);
  assert.ok(match.work_ids.length);
  assert.equal(match.confirmed_song_id, null);
  assert.equal(match.confirmed_work_id, null);
});
test("detail failure never overwrites existing staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "hp-collector-"));
  const outputPath = join(root, "staging", "song-candidates.json");
  const original = '{"schema_version":1,"candidates":[]}\n';
  try {
    await mkdir(join(root, "staging"));
    await mkdir(join(root, "data"));
    await writeFile(outputPath, original);
    await writeFile(join(root, "data", "songs.csv"), "song_id,work_id,title\n");
    await writeFile(join(root, "data", "works.csv"), "work_id,title\n");
    const list = await fixture("release-list.html");
    const fetchImpl = async (url) => ({
      ok: !String(url).includes("/7645/"), status: 500,
      text: async () => String(url).includes("?pc=1") ? list : await fixture("release-detail.html"),
      json: async () => ({ type: "release", items: [] })
    });
    await assert.rejects(collectCandidates({ root, fetchImpl, outputPath }), /Collection aborted/);
    assert.equal(await readFile(outputPath, "utf8"), original);
    const parseFailure = async (url) => ({
      ok: true, status: 200,
      text: async () => String(url).includes("?pc=1") ? list
        : String(url).includes("/7645/") ? "<html><body>changed</body></html>"
        : await fixture("release-detail.html"),
      json: async () => ({ type: "release", items: [] })
    });
    await assert.rejects(collectCandidates({ root, fetchImpl: parseFailure, outputPath }), /Collection aborted/);
    assert.equal(await readFile(outputPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

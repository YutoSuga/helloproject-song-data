import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { artists } from "../src/collector/artists.js";
import { parseCollectorArgs, selectArtists } from "../src/collector/cli.js";
import { collectArtist, collectCandidates, saveStaging } from "../src/collector/collect.js";
import { makeCandidate, mergeCandidates } from "../src/collector/merge-candidates.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { parseReleaseFeed, parseReleaseList } from "../src/collector/parse-release-list.js";
import { matchExisting } from "../src/collector/match-existing.js";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const now = "2026-10-11T00:00:00.000Z";
const nextTime = "2026-10-12T00:00:00.000Z";

async function mockSources({ failSlug, failKind = "http", unitSlug, unitName, beforeFetch } = {}) {
  const [list, audio, streaming] = await Promise.all([
    fixture("release-list.html"), fixture("release-detail.html"), fixture("streaming-detail.html")
  ]);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    await beforeFetch?.();
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) {
      return { ok: true, json: async () => ({ type: "release", items: [] }) };
    }
    const config = artists[source.pathname.split("/")[1]];
    assert.ok(config, `Unexpected fixture URL: ${url}`);
    if (source.search) {
      if (config.slug === failSlug && failKind === "list") return { ok: true, text: async () => "<html>changed</html>" };
      const html = list.replaceAll("rosychronicle", config.slug).replaceAll("676", String(config.officialGroupId));
      return { ok: true, text: async () => html };
    }
    if (config.slug === failSlug && source.pathname.includes("/7645/")) {
      return failKind === "http" ? { ok: false, status: 500 }
        : { ok: true, text: async () => "<html>changed</html>" };
    }
    const name = config.slug === unitSlug ? unitName : config.artistName;
    return { ok: true, text: async () => (source.pathname.includes("/7645/") ? streaming : audio)
      .replaceAll("ロージークロニクル", name) };
  };
  return { fetchImpl, calls };
}

async function reviewedCandidate() {
  const config = artists.rosychronicle;
  const release = { url: "https://helloproject.com/rosychronicle/release/9000/", type: "CDシングル" };
  const detail = parseReleaseDetail(await fixture("release-detail.html"), release, config);
  return { ...makeCandidate(config, release, detail, detail.tracks[0], matchExisting(detail.tracks[0].title, new Map()), now),
    status: "hold", notes: "管理者メモ", reviewed_by: "admin", related_candidates: [] };
}

async function sandbox(t, candidates = []) {
  const root = await mkdtemp(join(tmpdir(), "hp-multi-collector-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "staging"));
  await writeFile(join(root, "data", "songs.csv"), "song_id,work_id,title\nS00001,W00001,Misery ～愛の天秤～\n");
  await writeFile(join(root, "data", "works.csv"), "work_id,title\nW00001,Misery ～愛の天秤～\n");
  const outputPath = join(root, "staging", "song-candidates.json");
  const original = JSON.stringify({ schema_version: 1, updated_at: now, administrator_note: "keep", candidates }) + "\n";
  await writeFile(outputPath, original);
  return { root, outputPath, original };
}

test("A/B: no CLI args select every configured artist; --artist selects just one", () => {
  assert.deepEqual(Object.keys(artists), ["morningmusume", "angerme", "juicejuice", "tsubakifactory", "beyooooonds", "ochanorma", "rosychronicle"]);
  assert.deepEqual(selectArtists(parseCollectorArgs([]).artistSlug), Object.values(artists));
  assert.deepEqual(selectArtists(parseCollectorArgs(["--artist", "rosychronicle"]).artistSlug), [artists.rosychronicle]);
});

test("C: malformed CLI args fail safely with nonzero exit and JSON error", () => {
  for (const args of [["--artist"], ["--artist", "unknown"], ["--unknown"], ["rosychronicle"],
    ["--artist", "--unknown"], ["--artist", "rosychronicle", "--artist", "rosychronicle"],
    ["--artist", "constructor"], ["--artist=rosychronicle"]]) {
    assert.throws(() => parseCollectorArgs(args));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/collect-candidates.js", import.meta.url)), ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    const log = JSON.parse(result.stderr);
    assert.equal(log.event, "collection_summary");
    assert.equal(log.saved, false);
    assert.equal(log.total.errors, 1);
  }
});

test("D: all artists succeed, then existing plus all observations are saved once", async (t) => {
  const old = await reviewedCandidate();
  const context = await sandbox(t, [old]);
  const sources = await mockSources({ beforeFetch: async () => assert.equal(await readFile(context.outputPath, "utf8"), context.original) });
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...sources, now, save: async (path, data) => {
    saves += 1;
    assert.equal(sources.calls.filter((url) => /\/(7611|7645)\//.test(url)).length, 14);
    await saveStaging(path, data);
  } });
  assert.equal(saves, 1);
  assert.equal(summary.mode, "all");
  assert.equal(summary.saved, true);
  assert.equal(summary.artists.length, 7);
  assert.equal(summary.total.new_candidates, 14);
  assert.equal(summary.total.releases, 14);
  assert.equal(summary.total.detail_success, 14);
  assert.equal(summary.total.errors, 0);
  for (const item of summary.artists) {
    assert.equal(item.new_candidates, 2);
    assert.equal(item.rediscovered_candidates, 0);
    assert.equal(item.tracks_detected, 3);
    assert.equal(item.instrumental_excluded, 1);
    assert.equal(item.video_excluded, 1);
    assert.equal(item.possible_matches, 1);
    assert.equal(item.detail_failed, 0);
  }
  // The same official year feed is fetched once per transaction.
  assert.equal(sources.calls.filter((url) => url.includes("/json/")).length, 2);
  const data = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(data.candidates.length, 15);
  assert.equal(data.administrator_note, "keep");
  const retained = data.candidates.find((c) => c.candidate_id === old.candidate_id);
  assert.deepEqual({ ...retained, related_candidates: [] }, old);
  assert.equal(retained.related_candidates.length, 1);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("E: a later artist HTTP, parse or list failure leaves staging byte-for-byte unchanged", async (t) => {
  for (const failKind of ["http", "parse", "list"]) {
    const context = await sandbox(t, [await reviewedCandidate()]);
    const sources = await mockSources({ failSlug: "juicejuice", failKind });
    let saves = 0;
    await assert.rejects(collectCandidates({ ...context, ...sources, now, save: async () => { saves += 1; } }), (error) => {
      assert.equal(error.summary.saved, false);
      assert.equal(error.summary.mode, "all");
      assert.equal(error.summary.artists.length, 3);
      assert.equal(error.summary.artists[0].detail_success, 2);
      assert.equal(error.summary.artists[1].detail_success, 2);
      assert.equal(error.summary.artists[2].artist_slug, "juicejuice");
      assert.ok(error.summary.total.errors > 0);
      assert.equal(error.summary.total.new_candidates, 0);
      return true;
    });
    assert.equal(saves, 0);
    assert.equal(await readFile(context.outputPath, "utf8"), context.original);
    assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
  }
});

test("F/G: single-artist runs keep other artists and preserve review fields on rediscovery", async (t) => {
  const context = await sandbox(t);
  await collectCandidates({ ...context, ...await mockSources(), artistSlug: "juicejuice", now });
  const first = JSON.parse(await readFile(context.outputPath, "utf8"));
  first.candidates[0].status = "confirmed";
  first.candidates[0].notes = "確定済み";
  first.candidates[0].reviewed_by = "admin";
  first.candidates[0].match.confirmed_song_id = "S00001";
  first.candidates[0].match.confirmed_work_id = "W00001";
  first.candidates[0].match.review_note = "keep nested field";
  await writeFile(context.outputPath, JSON.stringify(first));
  const result = await collectCandidates({ ...context, ...await mockSources(), artistSlug: "rosychronicle", now });
  assert.equal(result.mode, "single");
  assert.equal(result.artists.length, 1);
  const second = JSON.parse(await readFile(context.outputPath, "utf8"));
  for (const candidate of first.candidates) assert.deepEqual(second.candidates.find((c) => c.candidate_id === candidate.candidate_id), candidate);
  const again = await collectCandidates({ ...context, ...await mockSources(), now: nextTime });
  const third = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(third.candidates.length, 14);
  assert.equal(again.total.new_candidates, 10);
  assert.equal(again.total.rediscovered_candidates, 4);
  const review = third.candidates.find((c) => c.candidate_id === first.candidates[0].candidate_id);
  for (const key of ["status", "notes", "detected_at", "reviewed_by"]) assert.equal(review[key], first.candidates[0][key]);
  assert.equal(review.last_seen_at, nextTime);
  assert.equal(review.match.confirmed_song_id, "S00001");
  assert.equal(review.match.confirmed_work_id, "W00001");
  assert.equal(review.match.review_note, "keep nested field");
  const fourth = await collectCandidates({ ...context, ...await mockSources(), now: nextTime });
  assert.equal(fourth.total.new_candidates, 0);
  assert.equal(fourth.total.rediscovered_candidates, 14);
});

test("H: related units and old names never inherit source artist identity", async (t) => {
  for (const [unitSlug, unitName] of [["rosychronicle", "ConChu!"], ["juicejuice", "NEXT YOU"],
    ["angerme", "スマイレージ"], ["morningmusume", "モーニング娘。'14"]]) {
    const context = await sandbox(t);
    const summary = await collectCandidates({ ...context, ...await mockSources({ unitSlug, unitName }), artistSlug: unitSlug, now });
    assert.equal(summary.total.new_candidates, 2);
    for (const c of JSON.parse(await readFile(context.outputPath, "utf8")).candidates) {
      assert.equal(c.artist_name, unitName);
      assert.equal(c.artist_id, null);
      assert.equal(c.artist_slug, null);
      assert.equal(c.source_artist_slug, unitSlug);
    }
  }
});

test("current staging candidates retain IDs and review fields", async () => {
  const data = JSON.parse(await readFile(new URL("../staging/song-candidates.json", import.meta.url), "utf8"));
  assert.ok(data.candidates.length > 0);
  const result = mergeCandidates(data.candidates, data.candidates, nextTime);
  assert.equal(result.added, 0);
  assert.equal(result.candidates.length, data.candidates.length);
  for (const [index, candidate] of result.candidates.entries()) {
    for (const key of ["candidate_id", "status", "notes", "detected_at"]) assert.deepEqual(candidate[key], data.candidates[index][key]);
  }
});

test("official metadata without latest cards supplies all advertised years; BD is excluded", async () => {
  const list = await fixture("release-list.html");
  const empty = list.replace(/<main>[\s\S]*?<\/main>/, "<main></main>");
  const config = { ...artists.rosychronicle, firstReleaseYear: undefined };
  assert.deepEqual(parseReleaseList(empty, config), []);
  assert.deepEqual(parseReleaseFeed(empty.replace('2025', '1998'), config).years, [1998, 2026]);
  assert.throws(() => parseReleaseList("<html></html>", config), /metadata missing/);
  assert.throws(() => parseReleaseFeed(empty.replace('676', '999'), config), /metadata changed/);
  assert.throws(() => parseReleaseFeed(empty.replace('2025', 'oops'), config), /years changed/);
  assert.equal(parseReleaseList(list.replace("写真集", "BD"), config).length, 2);
  const result = await collectArtist({ config, titleIndex: new Map(), now, fetchImpl: async (url) => ({
    ok: true,
    text: async () => String(url).includes("?pc=1") ? empty : await fixture("release-detail.html"),
    json: async () => ({ type: "release", items: [{ id: 7611, artistsSearch: [676], categoryLabel: "CDシングル", title: "fixture", link: "/release/7611/" }] })
  }) });
  assert.equal(result.observed.length, 1);
  assert.equal(result.summary.releases, 1);
});

test("invalid artist and unsupported staging fail before any source fetch or save", async (t) => {
  const context = await sandbox(t);
  const fetchImpl = async () => assert.fail("must not fetch");
  const save = async () => assert.fail("must not save");
  await assert.rejects(collectCandidates({ ...context, artistSlug: "unknown", fetchImpl, save }), /Unknown artist/);
  await writeFile(context.outputPath, '{"schema_version":2,"candidates":[]}');
  await assert.rejects(collectCandidates({ ...context, fetchImpl, save }), /Unsupported staging schema/);
  assert.equal(await readFile(context.outputPath, "utf8"), '{"schema_version":2,"candidates":[]}');
});

test("exclusive temp collision leaves existing staging and temp file unchanged", async (t) => {
  const context = await sandbox(t);
  const temp = `${context.outputPath}.${process.pid}.tmp`;
  await writeFile(temp, "another invocation");
  await assert.rejects(saveStaging(context.outputPath, { schema_version: 1, candidates: [] }), { code: "EEXIST" });
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.equal(await readFile(temp, "utf8"), "another invocation");
});

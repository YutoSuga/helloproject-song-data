import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/official-empty-audio-release.json", import.meta.url), "utf8"));
const playableEvidence = JSON.parse(await readFile(new URL("./fixtures/distribution-single-release.json", import.meta.url), "utf8"));
const emptyItems = evidence.feed.flatMap(({ items }) => items);
const playable = playableEvidence.feed[0].items.find((item) => item.id === 5552);
const details = new Map([...evidence.details, ...playableEvidence.details.filter((item) => item.id === 5552)]
  .map((detail) => [detail.id, detail]));
const config = artists.morningmusume;
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const release = (detail) => ({ url: detail.url, type: detail.type });

function listHtml(group, cards = []) {
  const props = { versionDir: [0, "official-empty-fixture"], years: [1, evidence.feed.map(({ year }) => [0, String(year)])],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const markup = cards.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${markup}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}

test("all three official details have a recognizable empty STREAMING TrackList and zero candidates", () => {
  assert.deepEqual(emptyItems.map((item) => item.id).sort(), [5369, 5448, 5567]);
  const expected = new Map([
    [5448, { type: "配信シングル", date: "2017-11-03", product: "UFDL-1366", artist: "モーニング娘。20th" }],
    [5369, { type: "配信", date: "2017-07-28", product: "UFDL-1356",
      artist: "船木結(アンジュルム/カントリー・ガールズ）、横山玲奈(モーニング娘。'17)" }],
    [5567, { type: "配信シングル", date: "2018-01-28", product: "UFDL-1389", artist: "モーニング娘。20th" }]
  ]);
  for (const item of emptyItems) {
    const detail = details.get(item.id);
    const info = expected.get(item.id);
    assert.equal(item.categoryLabel, info.type);
    assert.equal(item.date, info.date);
    assert.equal(item.catalogNo, info.product);
    assert.deepEqual(detail.media, ["STREAMING"]);
    assert.equal(detail.trackCount, 0);
    assert.equal(detail.emptyLabel, "収録内容未定");
    for (const fragment of ["ReleaseEdition", "TrackList", "TrackList__inner", "ReleaseEdition__headline",
      "TrackList__content--empty", info.product, "収録内容未定"]) assert.ok(detail.html.includes(fragment));
    assert.ok(!detail.html.includes("TrackListItem"));
    const parsed = parseReleaseDetail(detail.html, release(detail), config);
    assert.equal(parsed.date, info.date);
    assert.equal(parsed.artist, info.artist);
    assert.equal(parsed.type, info.type);
    assert.equal(parsed.officialEmptyAudioRelease, true);
    assert.equal(parsed.counts.audioTracks, 0);
    assert.deepEqual(parsed.tracks, []);
  }
});

test("missing, changed or malformed empty structures are parser errors", () => {
  const detail = details.get(5448);
  const original = detail.html;
  const mutations = [
    original.replace("収録内容未定", "準備中"),
    original.replace("TrackList__content--empty TrackList__content--empty--singleDisc", "TrackList__content"),
    original.replace('class="TrackList"', 'class="UnrecognizedList"'),
    original.replace('class="TrackList__inner"', 'class="UnrecognizedInner"'),
    original.replace('class="ReleaseEdition__headline"', 'class="UnrecognizedHeadline"')
  ];
  for (const html of mutations) {
    assert.notEqual(html, original);
    assert.throws(() => parseReleaseDetail(html, release(detail), config));
  }
  assert.throws(() => parseReleaseDetail(original.replace(">STREAMING</div>", ">UNKNOWN_MEDIA</div>"), release(detail), config),
    /Unknown media section UNKNOWN_MEDIA/);
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-official-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "staging"));
  await writeFile(join(root, "data", "songs.csv"), "song_id,work_id,title\n");
  await writeFile(join(root, "data", "works.csv"), "work_id,title\n");
  const outputPath = join(root, "staging", "song-candidates.json");
  const original = '{"schema_version":1,"administrator_note":"keep","candidates":[]}\n';
  await writeFile(outputPath, original);
  return { root, outputPath, original };
}

function sources({ includePlayable = false, laterUnknown = false, unknownMedia = false, brokenTrackList = false,
  httpFailure = false } = {}) {
  const selected = includePlayable ? [...emptyItems, playable] : emptyItems;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) {
      const year = Number(source.pathname.match(/\/(\d{4})_releases\.json$/)?.[1]);
      return { ok: true, json: async () => ({ type: "release",
        items: selected.filter((item) => Number(item.date.slice(0, 4)) === year) }) };
    }
    const group = artists[source.pathname.split("/")[1]];
    assert.ok(group, `Unexpected fixture source: ${url}`);
    if (source.search) {
      const cards = group.slug === "morningmusume" ? selected : laterUnknown && group.slug === "angerme"
        ? [{ ...playable, id: 999999, link: "/release/999999/", categoryLabel: "UNKNOWN_RELEASE" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    const id = Number(source.pathname.split("/")[3]);
    assert.ok(details.has(id), `Unexpected detail source: ${url}`);
    if (httpFailure && id === 5369) return { ok: false, status: 503 };
    let html = details.get(id).html;
    if (id === 5369 && unknownMedia) html = html.replace(">STREAMING</div>", ">UNKNOWN_MEDIA</div>");
    if (id === 5369 && brokenTrackList) html = html.replace('class="TrackList__inner"', 'class="BrokenTrackList"');
    return { ok: true, text: async () => html };
  };
  return { fetchImpl, calls };
}

test("three official empty releases finish with zero candidates and explicit summary URLs", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...sources(), artistSlug: "morningmusume",
    save: async (file, data) => { saves += 1; await saveStaging(file, data); } });
  assert.equal(summary.saved, true);
  assert.equal(saves, 1);
  assert.equal(summary.total.releases, 3);
  assert.equal(summary.total.detail_success, 3);
  assert.equal(summary.total.detail_failed, 0);
  assert.equal(summary.total.empty_audio_releases, 3);
  assert.equal(summary.artists[0].empty_audio_releases, 3);
  assert.deepEqual(summary.total.empty_audio_release_urls.sort(), evidence.details.map((detail) => detail.url).sort());
  assert.deepEqual(summary.artists[0].empty_audio_release_urls.sort(), evidence.details.map((detail) => detail.url).sort());
  assert.equal(summary.total.new_candidates, 0);
  assert.equal(summary.total.tracks_detected, 0);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.administrator_note, "keep");
  assert.deepEqual(saved.candidates, []);
  assert.ok(!Object.hasOwn(saved, "empty_audio_releases"));
});

test("official empty releases do not prevent a real audio candidate from being collected", async (t) => {
  const context = await sandbox(t);
  const summary = await collectCandidates({ ...context, ...sources({ includePlayable: true }), artistSlug: "morningmusume" });
  assert.equal(summary.total.detail_success, 4);
  assert.equal(summary.total.detail_failed, 0);
  assert.equal(summary.total.empty_audio_releases, 3);
  assert.equal(summary.total.new_candidates, 1);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.candidates[0].title, "花が咲く 太陽浴びて");
  for (const item of emptyItems) assert.ok(!saved.candidates.some((candidate) => candidate.source_url.endsWith(item.link)));
});

test("unknown media, damaged TrackList and HTTP failure still abort without saving", async (t) => {
  for (const [option, pattern] of [
    [{ unknownMedia: true }, /Unknown media section UNKNOWN_MEDIA/],
    [{ brokenTrackList: true }, /No media sections/],
    [{ httpFailure: true }, /HTTP 503/]
  ]) {
    const context = await sandbox(t);
    let saves = 0;
    await assert.rejects(collectCandidates({ ...context, ...sources(option), artistSlug: "morningmusume",
      save: async () => { saves += 1; } }), pattern);
    assert.equal(saves, 0);
    assert.equal(await readFile(context.outputPath, "utf8"), context.original);
    assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
  }
});

test("a later artist error aborts the transaction after three official empty successes", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ includePlayable: true, laterUnknown: true }),
    save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: UNKNOWN_RELEASE/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 4);
    assert.equal(error.summary.artists[0].detail_failed, 0);
    assert.equal(error.summary.artists[0].empty_audio_releases, 3);
    assert.equal(error.summary.total.empty_audio_releases, 3);
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

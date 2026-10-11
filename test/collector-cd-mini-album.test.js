import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/cd-mini-album-release.json", import.meta.url), "utf8"));
const config = artists.morningmusume;
const items = evidence.feed.flatMap((part) => part.items);
const details = new Map(evidence.details.map((detail) => [detail.id, detail]));
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const release = (id) => ({ url: details.get(id).url, type: details.get(id).type });
function listHtml(group, cards = []) {
  const props = { versionDir: [0, "mini-album-fixture"], years: [1, evidence.feed.map(({ year }) => [0, String(year)])],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const markup = cards.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${markup}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}

test("official list and feed select CDミニアルバム with its raw release type", () => {
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.categoryLabel === "CDミニアルバム" && item.category.includes("album")));
  const expected = items.map((item) => `https://helloproject.com/morningmusume${item.link}`).sort();
  const listed = parseReleaseList(listHtml(config, items), config);
  const fed = evidence.feed.flatMap(({ items: yearItems }) => parseReleaseFeedYear({ type: "release", items: yearItems }, config));
  for (const releases of [listed, fed]) {
    assert.deepEqual(releases.map((item) => item.url).sort(), expected);
    assert.ok(releases.every((item) => item.type === "CDミニアルバム"));
  }
});

test("official detail excerpts contain CD audio, DVD video, source product numbers, songs and credits", () => {
  for (const item of items) {
    const example = details.get(item.id);
    const parsed = parseReleaseDetail(example.html, release(item.id), config);
    assert.equal(parsed.type, "CDミニアルバム");
    assert.equal(parsed.date, item.date);
    assert.deepEqual(example.media, ["CD", "DVD", "CD"]);
    assert.equal(parsed.counts.audioTracks, 2);
    assert.equal(parsed.counts.videoExcluded, 1);
    assert.equal(parsed.tracks.length, 2);
    assert.ok(parsed.tracks.every((track) => track.mediaType === "CD"));
    assert.deepEqual(parsed.tracks.map((track) => track.productNumber),
      item.id === 633 ? ["EPCE-5443", "EPCE-5445"] : ["EPCE-7387", "EPCE-7389"]);
    assert.ok(parsed.tracks.every((track) => track.title && track.credits.lyrics.names.length &&
      track.credits.composition.names.length && track.credits.arrangement.names.length &&
      track.credits.performer.names.length));
  }
  assert.equal(parseReleaseDetail(details.get(633).html, release(633), config).tracks[0].title, "歩いてる");
  const commemorative = parseReleaseDetail(details.get(5514).html, release(5514), config);
  assert.equal(commemorative.artist, "モーニング娘。20th");
  assert.equal(commemorative.tracks[0].title, "モーニングコーヒー(20th Anniversary Ver.)");
});

test("unknown release type still stops in list and feed", () => {
  const unknown = { ...items[0], id: 999999, link: "/release/999999/", categoryLabel: "CDミニアルバム新規" };
  assert.throws(() => parseReleaseList(listHtml(config, [...items, unknown]), config), /Unknown release types require review: CDミニアルバム新規/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items: [...items, unknown] }, config), /Unknown release types require review: CDミニアルバム新規/);
});

test("the release name cannot authorize an unknown detail media", () => {
  const example = details.get(633);
  assert.throws(() => parseReleaseDetail(example.html.replace('>CD</div>', '>UNVERIFIED_MEDIA</div>'), release(633), config), /Unknown media section UNVERIFIED_MEDIA/);
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-cd-mini-album-"));
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
function sources({ laterUnknown = false, unknownMedia = false, beforeFetch } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    await beforeFetch?.();
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) {
      const year = Number(source.pathname.match(/\/(\d{4})_releases\.json$/)?.[1]);
      return { ok: true, json: async () => ({ type: "release", items: evidence.feed.find((part) => part.year === year)?.items ?? [] }) };
    }
    const group = artists[source.pathname.split("/")[1]];
    assert.ok(group, `Unexpected fixture source: ${url}`);
    if (source.search) {
      const cards = group.slug === "morningmusume" ? items : laterUnknown && group.slug === "angerme"
        ? [{ ...items[0], link: "/release/999999/", categoryLabel: "UNVERIFIED_RELEASE" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    const id = Number(source.pathname.split("/")[3]);
    assert.ok(details.has(id), `Unexpected detail source: ${url}`);
    const html = details.get(id).html;
    return { ok: true, text: async () => unknownMedia && id === 633
      ? html.replace('>CD</div>', '>UNVERIFIED_MEDIA</div>') : html };
  };
  return { fetchImpl, calls };
}

test("collector saves only official CD tracks once and preserves raw types and source identity", async (t) => {
  const context = await sandbox(t);
  const source = sources({ beforeFetch: async () => assert.equal(await readFile(context.outputPath, "utf8"), context.original) });
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...source, artistSlug: "morningmusume", save: async (file, data) => {
    saves += 1;
    await saveStaging(file, data);
  } });
  assert.equal(saves, 1);
  assert.equal(summary.saved, true);
  assert.equal(summary.total.releases, 2);
  assert.equal(summary.total.new_candidates, 4);
  assert.equal(summary.total.video_excluded, 2);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.administrator_note, "keep");
  assert.equal(saved.candidates.length, 4);
  assert.ok(saved.candidates.every((item) => item.release_type === "CDミニアルバム" && item.media_type === "CD"));
  assert.ok(saved.candidates.some((item) => item.product_number === "EPCE-5443"));
  const anniversary = saved.candidates.filter((item) => item.artist_name === "モーニング娘。20th");
  assert.equal(anniversary.length, 2);
  assert.ok(anniversary.every((item) => item.artist_id === null && item.artist_slug === null && item.source_artist_slug === "morningmusume"));
});

test("a later artist error leaves all earlier CD mini-album observations unsaved", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ laterUnknown: true }), save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: UNVERIFIED_RELEASE/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 2);
    assert.equal(error.summary.artists[1].artist_slug, "angerme");
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("unknown detail media aborts collection before staging changes", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ unknownMedia: true }), artistSlug: "morningmusume", save: async () => { saves += 1; } }), /Unknown media section UNVERIFIED_MEDIA/);
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/bd-single-release.json", import.meta.url), "utf8"));
const config = artists.morningmusume;
const items = evidence.feed.flatMap(({ items: yearItems }) => yearItems);
const audioItem = items.find((item) => item.id === 6631);
const videoItem = items.find((item) => item.id === 6719);
const details = new Map(evidence.details.map((detail) => [detail.id, detail]));
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const release = (id) => ({ url: details.get(id).url, type: details.get(id).type });

function listHtml(group, cards = []) {
  const props = { versionDir: [0, "bd-single-fixture"], years: [1, evidence.feed.map(({ year }) => [0, String(year)])],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const markup = cards.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${markup}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}

test("official BDシングル feed category is video and list/feed exclude it", () => {
  assert.equal(videoItem.categoryLabel, "BDシングル");
  assert.deepEqual(videoItem.category, ["video"]);
  assert.equal(videoItem.date, "2022-04-13");
  assert.equal(videoItem.catalogNo, "UFXW-1026");
  assert.deepEqual(parseReleaseList(listHtml(config, [videoItem]), config), []);
  assert.deepEqual(parseReleaseFeedYear({ type: "release", items: [videoItem] }, config), []);
  for (const selected of [parseReleaseList(listHtml(config, items), config),
    evidence.feed.flatMap(({ items: yearItems }) => parseReleaseFeedYear({ type: "release", items: yearItems }, config))]) {
    assert.deepEqual(selected.map((item) => item.url), [details.get(6631).url]);
  }
});

test("official BD detail is video despite song names and credits", () => {
  const detail = details.get(6719);
  assert.equal(detail.type, "BDシングル");
  assert.deepEqual(detail.media, ["BD"]);
  assert.deepEqual(detail.originalTrackCounts, [4]);
  assert.match(detail.html, /UFXW-1026/);
  for (const fragment of ["ビートの惑星", "(Music Video)", "(Dance Shot Ver.)", "メイキング映像"]) {
    assert.ok(detail.html.includes(fragment));
  }
  for (const credit of ["作詞：", "作曲：", "出演："]) assert.ok(detail.html.includes(credit));
  assert.ok(!detail.html.includes("編曲："));
  assert.ok(!detail.html.includes("歌："));
  assert.throws(() => parseReleaseDetail(detail.html, release(6719), config), /No audio tracks/);
});

test("an official audio single keeps CD tracks and excludes its BD section", () => {
  assert.equal(audioItem.categoryLabel, "CDシングル");
  const detail = details.get(6631);
  assert.deepEqual(detail.media, ["CD", "BD"]);
  assert.deepEqual(detail.originalTrackCounts, [6, 3]);
  const parsed = parseReleaseDetail(detail.html, release(6631), config);
  assert.equal(parsed.counts.audioTracks, 1);
  assert.equal(parsed.counts.videoExcluded, 1);
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].title, "Teenage Solution");
  assert.equal(parsed.tracks[0].mediaType, "CD");
  assert.equal(parsed.tracks[0].productNumber, "EPCE-7649");
});

test("unknown release type and detail media still stop", () => {
  const unknown = { ...videoItem, id: 999999, link: "/release/999999/", categoryLabel: "UNKNOWN_VIDEO_FORMAT" };
  assert.throws(() => parseReleaseList(listHtml(config, [videoItem, unknown]), config), /Unknown release types require review: UNKNOWN_VIDEO_FORMAT/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items: [videoItem, unknown] }, config),
    /Unknown release types require review: UNKNOWN_VIDEO_FORMAT/);
  assert.throws(() => parseReleaseDetail(details.get(6631).html.replace(">BD</div>", ">UNKNOWN_MEDIA</div>"), release(6631), config),
    /Unknown media section UNKNOWN_MEDIA/);
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-bd-single-"));
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

function sources({ laterUnknown = false, unknownMedia = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) {
      const year = Number(source.pathname.match(/\/(\d{4})_releases\.json$/)?.[1]);
      return { ok: true, json: async () => ({ type: "release", items: evidence.feed.find((part) => part.year === year)?.items ?? [] }) };
    }
    const group = artists[source.pathname.split("/")[1]];
    assert.ok(group, `Unexpected fixture source: ${url}`);
    if (source.search) {
      const cards = group.slug === "morningmusume" ? items : laterUnknown && group.slug === "angerme"
        ? [{ ...audioItem, id: 999999, link: "/release/999999/", categoryLabel: "UNKNOWN_VIDEO_FORMAT" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    const id = Number(source.pathname.split("/")[3]);
    assert.ok(details.has(id), `Unexpected detail source: ${url}`);
    const html = details.get(id).html;
    return { ok: true, text: async () => unknownMedia && id === 6631
      ? html.replace(">BD</div>", ">UNKNOWN_MEDIA</div>") : html };
  };
  return { fetchImpl, calls };
}

test("collector skips BDシングル before detail fetch and saves only CD candidate", async (t) => {
  const context = await sandbox(t);
  const source = sources();
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...source, artistSlug: "morningmusume",
    save: async (file, data) => { saves += 1; await saveStaging(file, data); } });
  assert.equal(summary.saved, true);
  assert.equal(saves, 1);
  assert.equal(summary.total.releases, 1);
  assert.equal(summary.total.video_excluded, 1);
  assert.equal(summary.total.new_candidates, 1);
  assert.ok(!source.calls.includes(details.get(6719).url));
  assert.ok(source.calls.includes(details.get(6631).url));
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.administrator_note, "keep");
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.candidates[0].media_type, "CD");
  assert.equal(saved.candidates[0].release_type, "CDシングル");
  assert.ok(!saved.candidates.some((item) => item.source_url === details.get(6719).url));
});

test("a later artist failure leaves earlier audio observation and video exclusion unsaved", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ laterUnknown: true }),
    save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: UNKNOWN_VIDEO_FORMAT/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 1);
    assert.equal(error.summary.artists[1].artist_slug, "angerme");
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("unknown media aborts collection before staging changes", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ unknownMedia: true }), artistSlug: "morningmusume",
    save: async () => { saves += 1; } }), /Unknown media section UNKNOWN_MEDIA/);
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

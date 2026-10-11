import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/distribution-single-release.json", import.meta.url), "utf8"));
const config = artists.morningmusume;
const items = evidence.feed[0].items;
const details = new Map(evidence.details.map((detail) => [detail.id, detail]));
const playable = items.find((item) => item.id === 5552);
const empty = items.find((item) => item.id === 5567);
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const release = (id) => ({ url: details.get(id).url, type: details.get(id).type });

function listHtml(group, cards = []) {
  const props = { versionDir: [0, "distribution-single-fixture"], years: [1, [[0, "2018"]]],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const markup = cards.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${markup}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}

test("official list and feed select raw 配信シングル with single/distribution category", () => {
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.categoryLabel === "配信シングル" &&
    item.category.includes("single") && item.category.includes("distribution")));
  const expected = items.map((item) => `https://helloproject.com/morningmusume${item.link}`).sort();
  for (const selected of [parseReleaseList(listHtml(config, items), config),
    parseReleaseFeedYear({ type: "release", items }, config)]) {
    assert.deepEqual(selected.map((item) => item.url).sort(), expected);
    assert.ok(selected.every((item) => item.type === "配信シングル"));
  }
});

test("official detail has STREAMING audio tracks, exact product number and four credits", () => {
  const parsed = parseReleaseDetail(details.get(5552).html, release(5552), config);
  assert.equal(parsed.type, "配信シングル");
  assert.equal(parsed.date, playable.date);
  assert.equal(parsed.artist, "モーニング娘。'18");
  assert.deepEqual(details.get(5552).media, ["STREAMING"]);
  assert.equal(parsed.counts.audioTracks, 2);
  assert.equal(parsed.counts.instrumentalExcluded, 1);
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].title, "花が咲く 太陽浴びて");
  assert.equal(parsed.tracks[0].mediaType, "STREAMING");
  assert.equal(parsed.tracks[0].productNumber, "UFDL-1390");
  assert.deepEqual(Object.fromEntries(Object.entries(parsed.tracks[0].credits).map(([key, credit]) => [key, credit.names[0]])),
    { lyrics: "つんく", composition: "つんく", arrangement: "平田祥一郎", performer: "モーニング娘。'18" });
});

test("missing detail product number remains null without borrowing the feed catalog number", () => {
  const html = details.get(5552).html.replace(/<div class="[^"]*font-figtree[^"]*">UFDL-1390<\/div>/, "");
  assert.notEqual(html, details.get(5552).html);
  const parsed = parseReleaseDetail(html, release(5552), config);
  assert.equal(playable.catalogNo, "UFDL-1390");
  assert.equal(parsed.tracks[0].productNumber, null);
});

test("unknown release type and detail media still stop", () => {
  const unknown = { ...playable, id: 999999, link: "/release/999999/", categoryLabel: "UNVERIFIED_RELEASE" };
  assert.throws(() => parseReleaseList(listHtml(config, [...items, unknown]), config), /Unknown release types require review: UNVERIFIED_RELEASE/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items: [...items, unknown] }, config),
    /Unknown release types require review: UNVERIFIED_RELEASE/);
  assert.throws(() => parseReleaseDetail(details.get(5552).html.replace(">STREAMING</div>", ">UNVERIFIED_MEDIA</div>"), release(5552), config),
    /Unknown media section UNVERIFIED_MEDIA/);
});

test("official 5567 has a verified empty STREAMING TrackList and zero candidates", () => {
  assert.equal(empty.catalogNo, "UFDL-1389");
  assert.deepEqual(details.get(5567).media, ["STREAMING"]);
  assert.equal(details.get(5567).trackCount, 0);
  assert.match(details.get(5567).html, /収録内容未定/);
  const parsed = parseReleaseDetail(details.get(5567).html, release(5567), config);
  assert.equal(parsed.officialEmptyAudioRelease, true);
  assert.deepEqual(parsed.tracks, []);
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-distribution-single-"));
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

function sources({ includeEmpty = false, laterUnknown = false, unknownMedia = false } = {}) {
  const fetchImpl = async (url) => {
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) {
      const selected = includeEmpty ? items : [playable];
      return { ok: true, json: async () => ({ type: "release", items: selected }) };
    }
    const group = artists[source.pathname.split("/")[1]];
    assert.ok(group, `Unexpected fixture source: ${url}`);
    if (source.search) {
      const cards = group.slug === "morningmusume" ? includeEmpty ? items : [playable]
        : laterUnknown && group.slug === "angerme"
          ? [{ ...playable, link: "/release/999999/", categoryLabel: "UNVERIFIED_RELEASE" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    const id = Number(source.pathname.split("/")[3]);
    assert.ok(details.has(id), `Unexpected detail source: ${url}`);
    const html = details.get(id).html;
    return { ok: true, text: async () => unknownMedia && id === 5552
      ? html.replace(">STREAMING</div>", ">UNVERIFIED_MEDIA</div>") : html };
  };
  return { fetchImpl };
}

test("verified playable example saves once with official labels and product number", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...sources(), artistSlug: "morningmusume",
    save: async (file, data) => { saves += 1; await saveStaging(file, data); } });
  assert.equal(summary.saved, true);
  assert.equal(saves, 1);
  assert.equal(summary.total.new_candidates, 1);
  assert.equal(summary.total.instrumental_excluded, 1);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.administrator_note, "keep");
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.candidates[0].release_type, "配信シングル");
  assert.equal(saved.candidates[0].media_type, "STREAMING");
  assert.equal(saved.candidates[0].product_number, "UFDL-1390");
  assert.equal(saved.candidates[0].artist_name, "モーニング娘。'18");
});

test("later artist error leaves the earlier streaming observation unsaved", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ laterUnknown: true }),
    save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: UNVERIFIED_RELEASE/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 1);
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("5567 is counted as official empty while the listed song is collected", async (t) => {
  const context = await sandbox(t);
  const summary = await collectCandidates({ ...context, ...sources({ includeEmpty: true }), artistSlug: "morningmusume" });
  assert.equal(summary.total.detail_success, 2);
  assert.equal(summary.total.detail_failed, 0);
  assert.equal(summary.total.empty_audio_releases, 1);
  assert.deepEqual(summary.total.empty_audio_release_urls, [details.get(5567).url]);
  assert.equal(summary.total.new_candidates, 1);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.candidates[0].title, "花が咲く 太陽浴びて");
});

test("unknown media still leaves staging unchanged", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ unknownMedia: true }), artistSlug: "morningmusume",
    save: async () => { saves += 1; } }), /Unknown media section UNVERIFIED_MEDIA/);
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

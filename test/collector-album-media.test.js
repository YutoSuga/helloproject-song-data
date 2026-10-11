import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/album-media-release.json", import.meta.url), "utf8"));
const config = artists.morningmusume;
const items = evidence.feed.flatMap((year) => year.items);
const details = new Map(evidence.details.map((detail) => [detail.id, detail]));
const release = (id) => ({ url: details.get(id).url, type: details.get(id).type });
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function listHtml(group, cards = []) {
  const props = { versionDir: [0, "album-fixture"], years: [1, evidence.feed.map(({ year }) => [0, String(year)])],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const markup = cards.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${markup}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}

test("official feed and list classify アナログアルバム and MDアルバム as audio", () => {
  assert.equal(items.filter((item) => item.categoryLabel === "アナログアルバム").length, 3);
  assert.equal(items.filter((item) => item.categoryLabel === "MDアルバム").length, 1);
  assert.ok(items.every((item) => item.category.includes("album")));
  const expected = items.map((item) => `https://helloproject.com/morningmusume${item.link}`).sort();
  const fromList = parseReleaseList(listHtml(config, items), config);
  const fromFeed = evidence.feed.flatMap(({ items: yearly }) => parseReleaseFeedYear({ type: "release", items: yearly }, config));
  for (const releases of [fromList, fromFeed]) {
    assert.deepEqual(releases.map((item) => item.url).sort(), expected);
    assert.deepEqual(releases.map((item) => item.type).sort(), items.map((item) => item.categoryLabel).sort());
  }
});

test("official detail excerpts retain both raw release labels, exact media, tracks and credits", () => {
  for (const item of items) {
    const excerpt = details.get(item.id);
    const parsed = parseReleaseDetail(excerpt.html, release(item.id), config);
    assert.equal(parsed.type, item.categoryLabel);
    assert.equal(parsed.date, item.date);
    assert.equal(parsed.tracks.length, excerpt.media.length); // First official track per media section in fixture.
    assert.ok(parsed.tracks.every((track) => track.mediaType === (item.categoryLabel === "MDアルバム" ? "MD" : "ANALOG")));
    assert.ok(parsed.tracks.every((track) => track.title && track.credits.lyrics.names.length &&
      track.credits.composition.names.length && track.credits.arrangement.names.length &&
      track.credits.performer.names.length));
    assert.equal(parsed.tracks[0].productNumber, item.catalogNo.split(",")[0]);
    if (parsed.tracks.length === 2) assert.equal(parsed.tracks[1].productNumber, null);
  }
  assert.equal(parseReleaseDetail(details.get(1055).html, release(1055), config).tracks[0].title, "LOVEマシーン");
  assert.equal(parseReleaseDetail(details.get(1137).html, release(1137), config).tracks[0].title, "LOVEマシーン");
});

test("unknown release type still stops in list and feed", () => {
  const unknown = { ...items[0], id: 999999, link: "/release/999999/", categoryLabel: "UNKNOWN_ALBUM" };
  assert.throws(() => parseReleaseList(listHtml(config, [...items, unknown]), config), /Unknown release types require review: UNKNOWN_ALBUM/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items: [...items, unknown] }, config), /Unknown release types require review: UNKNOWN_ALBUM/);
});

test("unverified detail media still stops for either release type", () => {
  for (const id of [1055, 1137]) {
    const excerpt = details.get(id);
    const media = id === 1137 ? "MD" : "ANALOG";
    assert.throws(() => parseReleaseDetail(excerpt.html.replace(`>${media}</div>`, '>UNVERIFIED</div>'), release(id), config), /Unknown media section UNVERIFIED/);
  }
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-album-media-"));
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
        ? [{ ...items[0], link: "/release/999999/", categoryLabel: "UNKNOWN_ALBUM" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    const id = Number(source.pathname.split("/")[3]);
    assert.ok(details.has(id), `Unexpected detail URL: ${url}`);
    const html = details.get(id).html;
    return { ok: true, text: async () => unknownMedia && id === 1137
      ? html.replace('>MD</div>', '>UNVERIFIED</div>') : html };
  };
  return { fetchImpl, calls };
}

test("both album types save once with raw fields and retain reviewed candidates on rerun", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  const summary = await collectCandidates({ ...context, ...sources(), artistSlug: "morningmusume", save: async (file, data) => {
    saves += 1;
    assert.equal(await readFile(file, "utf8"), context.original);
    await saveStaging(file, data);
  } });
  assert.equal(saves, 1);
  assert.equal(summary.saved, true);
  assert.equal(summary.total.releases, 4);
  assert.equal(summary.total.new_candidates, 7);
  const data = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(data.administrator_note, "keep");
  assert.equal(data.candidates.length, 7);
  assert.equal(data.candidates.filter((c) => c.release_type === "MDアルバム" && c.media_type === "MD").length, 1);
  assert.equal(data.candidates.filter((c) => c.release_type === "アナログアルバム" && c.media_type === "ANALOG").length, 6);
  assert.ok(data.candidates.some((c) => c.product_number === "EPYE-5089"));
  assert.ok(data.candidates.some((c) => c.product_number === "UFWT-9009"));
  data.candidates[0].status = "hold";
  data.candidates[0].notes = "確認済み";
  await writeFile(context.outputPath, JSON.stringify(data));
  const again = await collectCandidates({ ...context, ...sources(), artistSlug: "morningmusume" });
  assert.equal(again.total.new_candidates, 0);
  assert.equal(again.total.rediscovered_candidates, 7);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  for (const key of ["candidate_id", "status", "notes", "detected_at"]) assert.equal(saved.candidates[0][key], data.candidates[0][key]);
});

test("failure in a later artist leaves all earlier album observations unsaved", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ laterUnknown: true }), save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: UNKNOWN_ALBUM/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 4);
    assert.equal(error.summary.artists[1].artist_slug, "angerme");
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("unverified MD detail media aborts before staging is changed", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ unknownMedia: true }), artistSlug: "morningmusume", save: async () => { saves += 1; } }), /Unknown media section UNVERIFIED/);
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

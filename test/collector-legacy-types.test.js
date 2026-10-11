import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/legacy-release-types.json", import.meta.url), "utf8"));
const config = artists.morningmusume;
const unknown = "FUTURE_MEDIA";
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function listHtml(config, items) {
  const props = { versionDir: [0, "legacy-fixture"], years: [1, [[0, "1998"], [0, "1999"], [0, "2000"]]],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, config.officialGroupId]]] }], groupSlug: [0, config.slug] };
  const cards = items.map((item) => `<a class="ReleasePanel" href="/${config.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${cards}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}
const detailFor = (id) => fixture.details.find((detail) => detail.id === id);
const releaseFor = (id) => ({ url: detailFor(id).url, type: detailFor(id).type });

test("legacy official list and feed select CDMD and exclude VHS", () => {
  const expected = [1134, 1135, 1136].map((id) => detailFor(id).url).sort();
  for (const releases of [parseReleaseList(listHtml(config, fixture.feed.items), config), parseReleaseFeedYear(fixture.feed, config)]) {
    assert.deepEqual(releases.map((release) => release.url).sort(), expected);
    assert.deepEqual(releases.map((release) => release.type), ["CDMD", "CDMD", "CDMD"]);
  }
  const videoItems = fixture.feed.items.filter((item) => item.categoryLabel === "VHS");
  assert.ok(videoItems.every((item) => item.category.includes("video")));
  assert.deepEqual(parseReleaseFeedYear({ type: "release", items: videoItems }, config), []);
  assert.deepEqual(parseReleaseList(listHtml(config, videoItems), config), []);
});

test("three official CDMD excerpts expose CD audio tracks and preserve raw type and product numbers", () => {
  for (const id of [1134, 1135, 1136]) {
    const example = detailFor(id);
    const item = fixture.feed.items.find((item) => item.id === id);
    const detail = parseReleaseDetail(example.html, releaseFor(id), config);
    assert.equal(detail.type, "CDMD");
    assert.equal(detail.date, item.date);
    assert.equal(detail.tracks.length, 1); // Fixture retains only the first official track.
    assert.equal(detail.tracks[0].mediaType, "CD");
    assert.equal(detail.tracks[0].productNumber, item.catalogNo);
    assert.deepEqual(detail.tracks[0].credits.lyrics.names, ["つんく"]);
    assert.deepEqual(detail.tracks[0].credits.performer.names, ["モーニング娘。"]);
  }
});

test("VHS detail sections are video even when they have track titles and credits", () => {
  for (const id of [1057, 1059]) {
    const video = detailFor(id);
    assert.deepEqual(video.media, ["VHS"]);
    assert.throws(() => parseReleaseDetail(video.html, releaseFor(id), config), /No audio tracks/);
    const html = video.html.slice(video.html.indexOf('<div class="ReleaseEdition '), video.html.indexOf("</body>"));
    const audio = detailFor(1134);
    const mixed = parseReleaseDetail(audio.html.replace("</body>", html + "</body>"), releaseFor(1134), config);
    assert.equal(mixed.tracks.length, 1);
    assert.equal(mixed.tracks[0].mediaType, "CD");
    assert.equal(mixed.counts.videoExcluded, 1);
  }
});

test("unknown release type and unverified CDMD media still stop safely", () => {
  const items = [...fixture.feed.items, { ...fixture.feed.items[0], id: 999999, link: "/release/999999/", categoryLabel: unknown }];
  assert.throws(() => parseReleaseList(listHtml(config, items), config), /Unknown release types require review: FUTURE_MEDIA/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items }, config), /Unknown release types require review: FUTURE_MEDIA/);
  const example = detailFor(1134);
  assert.throws(() => parseReleaseDetail(example.html.replace('>CD</div>', '>UNVERIFIED_MEDIA</div>'), releaseFor(1134), config), /Unknown media section UNVERIFIED_MEDIA/);
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-legacy-types-"));
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
function sources({ laterUnknown = false, badDetail = false } = {}) {
  const calls = [];
  const feed = { ...fixture.feed, items: [...fixture.feed.items] };
  if (laterUnknown) feed.items.push({ ...feed.items[0], artistsSearch: [artists.angerme.officialGroupId], categoryLabel: unknown });
  return { calls, fetchImpl: async (url) => {
    calls.push(String(url));
    const source = new URL(url);
    if (source.pathname.startsWith("/json/")) return { ok: true, json: async () => feed };
    const group = artists[source.pathname.split("/")[1]];
    assert.ok(group, `Unexpected fixture source: ${url}`);
    if (source.search) return { ok: true, text: async () => listHtml(group, group.slug === "morningmusume" ? fixture.feed.items : []) };
    const id = Number(source.pathname.split("/")[3]);
    assert.ok([1134, 1135, 1136].includes(id), "VHS must never be fetched by the collector");
    const example = detailFor(id);
    return { ok: true, text: async () => badDetail && id === 1135 ? example.html.replace('>CD</div>', '>UNVERIFIED_MEDIA</div>') : example.html };
  } };
}

test("CDMD collection saves once, never fetches VHS, and retains review metadata on rerun", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  const source = sources();
  const summary = await collectCandidates({ ...context, ...source, artistSlug: "morningmusume", save: async (outputPath, data) => {
    saves += 1;
    assert.equal(await readFile(outputPath, "utf8"), context.original);
    await saveStaging(outputPath, data);
  } });
  assert.equal(saves, 1);
  assert.equal(summary.saved, true);
  assert.equal(summary.total.new_candidates, 3);
  const data = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(data.administrator_note, "keep");
  assert.equal(data.candidates.length, 3);
  assert.ok(data.candidates.every((c) => c.release_type === "CDMD" && c.media_type === "CD"));
  data.candidates[0].status = "hold";
  data.candidates[0].notes = "media確認済み";
  await writeFile(context.outputPath, JSON.stringify(data));
  const again = await collectCandidates({ ...context, ...sources(), artistSlug: "morningmusume" });
  assert.equal(again.total.new_candidates, 0);
  assert.equal(again.total.rediscovered_candidates, 3);
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  for (const key of ["candidate_id", "status", "notes", "detected_at"]) assert.equal(saved.candidates[0][key], data.candidates[0][key]);
});

test("unknown type in a later artist aborts the whole transaction after CDMD observations", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  const source = sources({ laterUnknown: true });
  await assert.rejects(collectCandidates({ ...context, ...source, save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: FUTURE_MEDIA/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 3);
    assert.equal(error.summary.artists[1].artist_slug, "angerme");
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

test("unverified CDMD detail media aborts without changing staging", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ badDetail: true }), artistSlug: "morningmusume", save: async () => { saves += 1; } }), /Unknown media section UNVERIFIED_MEDIA/);
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

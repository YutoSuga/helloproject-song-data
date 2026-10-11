import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artists } from "../src/collector/artists.js";
import { parseReleaseList, parseReleaseFeedYear } from "../src/collector/parse-release-list.js";
import { parseReleaseDetail } from "../src/collector/parse-release-detail.js";
import { byClass, clean, firstClass, parseHtml } from "../src/collector/html.js";
import { collectCandidates, saveStaging } from "../src/collector/collect.js";

const evidence = JSON.parse(await readFile(new URL("./fixtures/single-v-release.json", import.meta.url), "utf8"));
const audioHtml = (await readFile(new URL("./fixtures/release-detail.html", import.meta.url), "utf8"))
  .replaceAll("ロージークロニクル", "モーニング娘。");
const config = artists.morningmusume;
const videos = evidence.feed.flatMap((part) => part.items);
const details = new Map(evidence.details.map((detail) => [detail.id, detail]));
const audio = { url: "https://helloproject.com/morningmusume/release/7611/", type: "CDシングル", title: "Audio fixture" };
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function listHtml(group, items = []) {
  const props = { versionDir: [0, "single-v-fixture"], years: [1, [[0, "2002"], [0, "2003"]]],
    fixedFilterProps: [0, { selectedGroupIds: [1, [[0, group.officialGroupId]]] }], groupSlug: [0, group.slug] };
  const cards = items.map((item) => `<a class="ReleasePanel" href="/${group.slug}${item.link}"><span class="StatusLabel--category">${escape(item.categoryLabel)}</span><h3 class="ReleasePanel__title">${escape(item.title)}</h3></a>`).join("");
  return `<html><body>${cards}<astro-island component-url="/_astro/Release.fixture.js" props="${escape(JSON.stringify(props))}"></astro-island></body></html>`;
}
const audioItem = { link: "/release/7611/", categoryLabel: audio.type, title: audio.title };
const videoMarkup = (id) => {
  const html = details.get(id).html;
  return html.slice(html.indexOf('<div class="ReleaseEdition '), html.indexOf("</body>"));
};

test("A/B: official feed and list classify both single-V types as video and exclude them", () => {
  assert.equal(videos.length, 4);
  for (const item of videos) {
    assert.deepEqual(item.category, ["video"]);
    const detail = details.get(item.id);
    assert.equal(detail.type, item.categoryLabel);
    assert.deepEqual(detail.media, [item.categoryLabel === "VHSシングルV" ? "VHS" : "DVD"]);
    assert.equal(item.catalogNo.startsWith(item.categoryLabel === "VHSシングルV" ? "EPVE-" : "EPBE-"), true);
    assert.match(item.date, /^200[23]-/);
  }
  assert.deepEqual(parseReleaseList(listHtml(config, videos), config), []);
  for (const part of evidence.feed) assert.deepEqual(parseReleaseFeedYear({ type: "release", items: part.items }, config), []);
});

test("D: video details contain song and credits, but pure video has no audio candidate", () => {
  for (const item of videos) {
    const detail = details.get(item.id);
    const root = parseHtml(detail.html);
    const head = firstClass(root, "ReleaseHead");
    assert.equal(clean(firstClass(head, "StatusLabel--category")), item.categoryLabel);
    assert.equal(clean(firstClass(head, "ReleaseHead__mainName")), item.title);
    assert.equal(clean(firstClass(root, "ReleaseEdition__mediaType")), item.categoryLabel === "VHSシングルV" ? "VHS" : "DVD");
    const product = byClass(root, "font-figtree").map(clean);
    assert.ok(product.includes(item.catalogNo));
    const titles = byClass(root, "TrackListItem__title").map(clean);
    assert.ok(titles.length >= 2);
    assert.match(titles[0], item.id === 1069 || item.id === 300 ? /Do it! Now/ : /シャボン玉/);
    assert.match(titles.at(-1), /メイキング映像/);
    const notes = clean(firstClass(root, "TrackListItem__notes"));
    for (const key of ["作詞", "作曲", "編曲"]) assert.ok(notes.includes(key));
    assert.ok(notes.includes(item.categoryLabel === "VHSシングルV" ? "歌：" : "出演："));
    assert.throws(() => parseReleaseDetail(detail.html, { url: detail.url, type: detail.type }, config), /No audio tracks/);
  }
});

test("G: DVD and VHS media sections in an audio release are excluded while CD remains", () => {
  for (const id of [1069, 300]) {
    const parsed = parseReleaseDetail(audioHtml.replace("</body>", videoMarkup(id) + "</body>"), audio, config);
    assert.equal(parsed.tracks.length, 1);
    assert.equal(parsed.tracks[0].mediaType, "CD");
    assert.equal(parsed.counts.audioTracks, 2);
    assert.equal(parsed.counts.videoExcluded, 3); // Existing BD item plus two single-V items.
  }
});

test("E/F: unregistered release types and detail media still stop", () => {
  const unknown = { ...videos[0], id: 999999, link: "/release/999999/", categoryLabel: "VHSシングルZ" };
  assert.throws(() => parseReleaseList(listHtml(config, [...videos, unknown]), config), /Unknown release types require review: VHSシングルZ/);
  assert.throws(() => parseReleaseFeedYear({ type: "release", items: [...videos, unknown] }, config), /Unknown release types require review: VHSシングルZ/);
  for (const [id, media] of [[1069, "VHS"], [300, "DVD"]]) {
    const changed = videoMarkup(id).replace(`>${media}</div>`, '>UNVERIFIED_VIDEO</div>');
    assert.throws(() => parseReleaseDetail(audioHtml.replace("</body>", changed + "</body>"), audio, config), /Unknown media section UNVERIFIED_VIDEO/);
  }
});

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hp-single-v-"));
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
function sources({ laterUnknown = false, beforeFetch } = {}) {
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
      const cards = group.slug === "morningmusume" ? [audioItem, ...videos] : laterUnknown && group.slug === "angerme"
        ? [{ ...videos[0], link: "/release/999999/", categoryLabel: "VHSシングルZ" }] : [];
      return { ok: true, text: async () => listHtml(group, cards) };
    }
    assert.equal(source.pathname, "/morningmusume/release/7611/", "Video detail must never be fetched");
    return { ok: true, text: async () => audioHtml };
  };
  return { fetchImpl, calls };
}

test("C/G: collector skips both video details and saves only the audio candidate", async (t) => {
  const context = await sandbox(t);
  const source = sources({ beforeFetch: async () => assert.equal(await readFile(context.outputPath, "utf8"), context.original) });
  let saves = 0;
  const result = await collectCandidates({ ...context, ...source, artistSlug: "morningmusume", save: async (file, data) => {
    saves += 1;
    await saveStaging(file, data);
  } });
  assert.equal(saves, 1);
  assert.equal(result.saved, true);
  assert.equal(result.total.releases, 1);
  assert.equal(result.total.detail_success, 1);
  assert.equal(result.total.new_candidates, 1);
  assert.deepEqual(source.calls.filter((url) => url.includes("/release/7611/")), [audio.url]);
  assert.ok(source.calls.every((url) => !videos.some((item) => url.endsWith(item.link))));
  const saved = JSON.parse(await readFile(context.outputPath, "utf8"));
  assert.equal(saved.administrator_note, "keep");
  assert.equal(saved.candidates.length, 1);
  assert.equal(saved.candidates[0].media_type, "CD");
});

test("H: a later artist failure leaves staging byte-for-byte unchanged", async (t) => {
  const context = await sandbox(t);
  let saves = 0;
  await assert.rejects(collectCandidates({ ...context, ...sources({ laterUnknown: true }), save: async () => { saves += 1; } }), (error) => {
    assert.match(error.message, /Unknown release types require review: VHSシングルZ/);
    assert.equal(error.summary.saved, false);
    assert.equal(error.summary.artists[0].detail_success, 1);
    assert.equal(error.summary.artists[1].artist_slug, "angerme");
    return true;
  });
  assert.equal(saves, 0);
  assert.equal(await readFile(context.outputPath, "utf8"), context.original);
  assert.deepEqual(await readdir(join(context.root, "staging")), ["song-candidates.json"]);
});

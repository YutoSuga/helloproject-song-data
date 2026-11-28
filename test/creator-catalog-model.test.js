import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterCreatorWorks, findCreators, getCreatorDetail, listParams, readCreatorRankings, readListState
} from "../site/creator-catalog-model.js";

test("search matches normalized name substrings, and same names keep separate IDs in order", () => {
  const entries = [
    { creator_name: "Ａｂｃ", creator_id: "C00002" },
    { creator_name: "Abc", creator_id: "C00001" },
    { creator_name: "Def", creator_id: "C00003" }
  ];
  assert.deepEqual(findCreators(entries, "ＢＣ ").map(e => e.creator_id), ["C00001", "C00002"]);
  assert.equal(findCreators(entries, "").length, entries.length);
  assert.deepEqual(findCreators(entries, "C00001"), []);
});

test("detail reuses published ranks and work evidence, sorts missing dates last and retains overlapping roles", () => {
  const works = [
    { work_id: "W4", title: "Missing date", roles: ["future_role"] },
    { work_id: "W3", title: "Later", roles: ["arrangement"] },
    { work_id: "W2", title: "Same date", roles: ["composition"] },
    { work_id: "W1", title: "Same date", roles: ["english_lyrics", "lyrics"], song_ids: ["S1", "S2"] }
  ];
  const creator = { creator_id: "C1", creator_name: "Creator", rank: 2, work_count: works.length, works };
  const categories = Object.fromEntries(["all", "lyrics", "composition", "lyrics_composition", "arrangement"].map(
    label => [label, { label, entries: label === "all" ? [creator] : [] }]));
  const catalog = { works: [
    { work_id: "W2", first_release_date: "2000-01-01" },
    { work_id: "W1", first_release_date: "2000-01-01" },
    { work_id: "W3", first_release_date: "2000-01-02" },
    { work_id: "W4", first_release_date: null }
  ] };
  const detail = getCreatorDetail({ categories }, catalog, "C1");
  assert.equal(detail.total, 4);
  assert.deepEqual(detail.rows[0], { label: "all", rank: 2, workCount: 4 });
  assert.deepEqual(detail.rows[3], { label: "lyrics_composition", rank: null, workCount: 0 });
  assert.deepEqual(detail.works.map(w => w.work_id), ["W1", "W2", "W3", "W4"]);
  assert.deepEqual(filterCreatorWorks(detail.works, "lyrics")[0].roles, ["english_lyrics", "lyrics"]);
  assert.deepEqual(filterCreatorWorks(detail.works, "other").map(w => w.work_id), ["W1", "W4"]);
  assert.deepEqual(filterCreatorWorks(detail.works, "other")[0].song_ids, ["S1", "S2"]);
  assert.equal(getCreatorDetail({ categories }, catalog, "C2"), null);
});

test("ranking reader rejects the wrong artist and duplicate work rows", async () => {
  const data = JSON.parse(await readFile(new URL("../site/data/rankings/G00001.json", import.meta.url)));
  assert.equal(readCreatorRankings(data, "G00001"), data);
  assert.throws(() => readCreatorRankings(data, "G99999"), /Invalid ranking artist/);
  const entry = data.categories.all.entries[0];
  entry.works.push(entry.works[0]);
  entry.work_count++;
  assert.throws(() => readCreatorRankings(data, "G00001"), /Invalid ranking entry/);
});

test("list state round trips untrusted search text and falls back for unsupported tab or category", () => {
  const state = { view: "ranking", category: "arrangement", q: " Ａ&= " };
  assert.deepEqual(readListState(listParams(state)), state);
  assert.deepEqual(readListState(new URLSearchParams("view=invalid&category=invalid")),
    { view: "search", category: "all", q: "" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildCreatorRoleIndex, ROLE_LABELS } from "../site/creator-roles.js";
import { analyzeCreatorPairs } from "../site/pair-analysis.js";

function fixture() {
  const work = (role, song) => ({ work_id: "W1", title: "Work", roles: [role, role], song_ids: [song] });
  return Object.fromEntries(Object.keys(ROLE_LABELS).map((role, i) => [role, { entries: [
    { creator_id: "A", works: [work(role, `S${i}`)] },
    { creator_id: "B", works: [{ ...work(role, "S9"), work_id: "W2" }] }
  ] }]));
}

test("role union spans recordings, deduplicates and isolates creator/work IDs", () => {
  const categories = fixture();
  categories.lyrics_or_composition = { entries: [{ creator_id: "wrong" }] };
  const before = structuredClone(categories);
  const index = buildCreatorRoleIndex(categories);
  assert.deepEqual([...index.get("A").get("W1")], ["lyrics", "composition", "arrangement"]);
  assert.equal(index.get("A").get("W1").size, 3);
  assert.equal(index.get("A").has("W2"), false);
  assert.equal(index.get("B").has("W1"), false);
  assert.equal(index.has("wrong"), false);
  assert.deepEqual(categories, before);
});

test("malformed or specialized role evidence fails rather than showing misleading badges", () => {
  for (const field of ["creator_id", "work_id", "roles", "song_ids"]) {
    const invalid = field === "roles" ? [null, [], ["english_lyrics"], ["brass_arrangement"], ["composition"], "lyrics"]
      : field === "song_ids" ? [null, [], [""], [3], "S1"] : [null, "", 3, " "];
    for (const value of invalid) {
      const data = fixture();
      const entry = data.lyrics.entries[0];
      (field === "creator_id" ? entry : entry.works[0])[field] = value;
      assert.throws(() => buildCreatorRoleIndex(data), /Invalid role/);
    }
  }
  const duplicate = fixture();
  duplicate.lyrics.entries.push(duplicate.lyrics.entries[0]);
  assert.throws(() => buildCreatorRoleIndex(duplicate), /Invalid role creator/);
});

test("canonical examples retain same-song self pairs and repeated-recording role unions", async () => {
  const data = JSON.parse(await readFile(new URL("../site/data/rankings/G00001.json", import.meta.url)));
  const index = buildCreatorRoleIndex(data.categories);
  assert.deepEqual([...index.get("C00003").get("W00002")], ["lyrics", "composition"]);
  assert(index.get("C00028").get("W00028").has("composition"));
  const self = analyzeCreatorPairs(data.lyrics_composition_pairs.entries, "C00003", true, true).entries;
  assert(self.some(e => e.works.some(w => w.work_id === "W00002" && w.song_ids.includes("J00002"))));
  const a = analyzeCreatorPairs(data.lyrics_composition_pairs.entries, "C00001", true, true).entries;
  assert(!a.some(e => e.works.some(w => w.work_id === "W00001")));
  assert.equal(data.summary.primary_song_count, 117);
  assert.equal(data.summary.target_work_count, 90);
});

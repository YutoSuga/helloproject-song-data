import assert from "node:assert/strict";
import test from "node:test";
import { loadCanonicalData } from "../src/canonical.js";
import { aggregateCreatorRankings } from "../src/rankings.js";

test("current canonical Juice=Juice data aggregates by work", async () => {
  const data = await loadCanonicalData();
  const result = aggregateCreatorRankings(data, "G00001");
  assert.equal(result.summary.primary_song_count, 120);
  assert.equal(result.summary.target_work_count, 90);
  assert.deepEqual(Object.keys(result.categories), [
    "lyrics",
    "composition",
    "lyrics_composition",
    "lyrics_or_composition",
    "arrangement"
  ]);
  assert.ok(result.categories.lyrics_or_composition.entries.length > 0);
  for (const category of Object.values(result.categories)) {
    for (const entry of category.entries) assert.equal(entry.work_count, entry.works.length);
  }
});

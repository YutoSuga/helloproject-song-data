import assert from "node:assert/strict";
import test from "node:test";
import { loadCanonicalData } from "../src/canonical.js";
import { aggregateCreatorRankings } from "../src/rankings.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("current canonical Juice=Juice data aggregates by work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hp-ranking-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL("../data", import.meta.url)), join(root, "data"), { recursive: true });
  const data = await loadCanonicalData(root);
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

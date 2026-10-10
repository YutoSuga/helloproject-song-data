import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCreatorRankings } from "../src/rankings.js";
import { analyzeCreatorPairs } from "../site/pair-analysis.js";

function fixture() {
  const creators = "ABCDEFGXYZ".split("").map((id) => ({ creator_id: id, name: `Creator ${id}` }));
  const works = Array.from({ length: 8 }, (_, index) => ({ work_id: `W${index + 1}`, title: `Work ${index + 1}` }));
  const songs = [1, 1, 2, 3, 4, 5, 6, 6, 7, 8].map((work, index) => ({ song_id: `S${index + 1}`, work_id: `W${work}` }));
  const songArtists = songs.map((song, index) => ({
    song_id: song.song_id,
    artist_id: index === 5 ? "G2" : "G1",
    role: index === 4 ? "featured" : "primary"
  }));
  songArtists.push({ song_id: "S1", artist_id: "G2", role: "primary" });
  const credits = [
    ["S1", "A", "lyrics"], ["S1", "B", "lyrics"],
    ["S1", "C", "composition"], ["S1", "D", "composition"],
    ["S1", "X", "arrangement"], ["S1", "Y", "brass_arrangement"], ["S1", "Z", "english_lyrics"],
    ["S2", "A", "lyrics"], ["S2", "C", "composition"], ["S2", "E", "composition"],
    ["S3", "A", "lyrics"], ["S3", "A", "composition"],
    ["S4", "B", "lyrics"], ["S4", "C", "composition"],
    ["S5", "E", "lyrics"], ["S5", "F", "composition"],
    ["S6", "E", "lyrics"], ["S6", "F", "composition"],
    ["S7", "G", "lyrics"], ["S8", "F", "composition"],
    ["S9", "A", "lyrics"], ["S9", "C", "composition"],
    ["S10", "B", "lyrics"], ["S10", "D", "composition"]
  ];
  return {
    artists: [{ artist_id: "G1", name: "Group 1" }, { artist_id: "G2", name: "Group 2" }],
    creators, works, songs, songArtists,
    songCreators: credits.map(([song_id, creator_id, role]) => ({ song_id, creator_id, role }))
  };
}

function pair(entries, lyricist, composer) {
  return entries.find((entry) => entry.lyricist_creator_id === lyricist && entry.composer_creator_id === composer);
}

test("pairs use same-song Cartesian product, work deduplication and scoped roles", () => {
  const result = aggregateCreatorRankings(fixture(), "G1");
  const entries = result.lyrics_composition_pairs.entries;
  assert.equal(result.summary.primary_song_count, 8);
  assert.equal(result.lyrics_composition_pairs.label, "作詞者 × 作曲者");
  for (const [lyricist, composer] of [["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"]]) {
    assert.ok(pair(entries, lyricist, composer), `${lyricist} × ${composer} from S1`);
  }
  assert.deepEqual(pair(entries, "A", "C").works, [
    { work_id: "W1", title: "Work 1", song_ids: ["S1", "S2"] },
    { work_id: "W7", title: "Work 7", song_ids: ["S9"] }
  ], "one work per pair, with both valid versions retained as evidence");
  assert.deepEqual(pair(entries, "A", "E").works.map(({ work_id, song_ids }) => [work_id, song_ids]), [["W1", ["S2"]]], "a different version pair also counts");
  assert.equal(pair(entries, "A", "A").work_count, 1, "self pair remains");
  assert.ok(!pair(entries, "G", "F"), "lyrics and composition from separate songs of W6 never cross join");
  assert.ok(!pair(entries, "B", "E"), "credits from separate versions of W1 never cross join");
  assert.ok(!entries.some((entry) => ["E", "F", "X", "Y", "Z"].includes(entry.lyricist_creator_id)
    || ["F", "X", "Y", "Z"].includes(entry.composer_creator_id)), "featured-only and non-target roles are excluded");
  assert.deepEqual(entries.slice(0, 3).map(({ lyricist_creator_id, composer_creator_id, work_count, rank }) =>
    [lyricist_creator_id, composer_creator_id, work_count, rank]),
  [["A", "C", 2, 1], ["B", "C", 2, 1], ["B", "D", 2, 1]], "competition ranks and pair-ID tie order are stable");
  assert.deepEqual(entries.filter((entry) => entry.lyricist_creator_id === "A" && entry.work_count === 1)
    .map((entry) => entry.composer_creator_id), ["A", "D", "E"], "composer ID breaks ties after lyricist ID");
  assert.ok(result.categories.lyrics.entries.length > 0, "ordinary categories remain available");
});

test("creator views work in both directions and self count comes from the same pair", () => {
  const entries = aggregateCreatorRankings(fixture(), "G1").lyrics_composition_pairs.entries;
  assert.deepEqual(analyzeCreatorPairs(entries, "B", "lyricist").entries.map(({ composer_creator_id, work_count, rank }) =>
    [composer_creator_id, work_count, rank]), [["C", 2, 1], ["D", 2, 1]]);
  assert.deepEqual(analyzeCreatorPairs(entries, "C", "composer").entries.map(({ lyricist_creator_id, work_count, rank }) =>
    [lyricist_creator_id, work_count, rank]), [["A", 2, 1], ["B", 2, 1]]);
  assert.deepEqual(analyzeCreatorPairs(entries, "A", "lyricist").entries.filter(({ composer_creator_id }) => composer_creator_id === "A")
    .map(({ composer_creator_id, work_count, rank }) => [composer_creator_id, work_count, rank]), [["A", 1, 2]]);
  assert.equal(analyzeCreatorPairs(entries, "A", "composer").self_work_count, pair(entries, "A", "A").work_count);
  assert.equal(analyzeCreatorPairs(entries, "B", "lyricist").self_work_count, 0);
});

test("artistId is a parameter, including multiple primary but excluding other artists' songs", () => {
  const entries = aggregateCreatorRankings(fixture(), "G2").lyrics_composition_pairs.entries;
  assert.equal(pair(entries, "A", "C").work_count, 1, "multiple primary S1 is included");
  assert.equal(pair(entries, "E", "F").work_count, 1, "G2-only primary S6 is included");
  assert.ok(!pair(entries, "A", "E"), "G1-only primary S2 is excluded");
  assert.ok(!pair(entries, "A", "A"), "G1-only primary S3 is excluded");
});

test("creator view uses competition ranks 1, 2, 2, 4", () => {
  const entries = [5, 3, 3, 2].map((work_count, index) => ({
    lyricist_creator_id: "A", composer_creator_id: `P${index}`, work_count
  }));
  assert.deepEqual(analyzeCreatorPairs(entries, "A", "lyricist").entries.map(({ rank }) => rank), [1, 2, 2, 4]);
});

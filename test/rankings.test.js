import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/csv.js";
import { aggregateCreatorRankings } from "../src/rankings.js";

function fixture() {
  const creators = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ creator_id: id, name: `Creator ${id}` }));
  const works = [1, 2, 3, 4, 5].map((id) => ({ work_id: `W${id}`, title: `Work ${id}` }));
  const songs = [
    { song_id: "S1", work_id: "W1" }, { song_id: "S2", work_id: "W1" },
    { song_id: "S3", work_id: "W2" }, { song_id: "S4", work_id: "W3" },
    { song_id: "S5", work_id: "W4" }, { song_id: "S6", work_id: "W5" }
  ];
  const songArtists = [
    { song_id: "S1", artist_id: "G1", role: "primary" },
    { song_id: "S1", artist_id: "G2", role: "primary" },
    { song_id: "S2", artist_id: "G1", role: "primary" },
    { song_id: "S3", artist_id: "G1", role: "primary" },
    { song_id: "S4", artist_id: "G1", role: "primary" },
    { song_id: "S5", artist_id: "G1", role: "featured" },
    { song_id: "S6", artist_id: "G2", role: "primary" }
  ];
  const songCreators = [
    { song_id: "S1", creator_id: "A", role: "lyrics" },
    { song_id: "S1", creator_id: "A", role: "composition" },
    { song_id: "S1", creator_id: "B", role: "lyrics" },
    { song_id: "S1", creator_id: "B", role: "english_lyrics" },
    { song_id: "S1", creator_id: "C", role: "arrangement" },
    { song_id: "S1", creator_id: "E", role: "brass_arrangement" },
    { song_id: "S2", creator_id: "A", role: "lyrics" },
    { song_id: "S2", creator_id: "A", role: "composition" },
    { song_id: "S2", creator_id: "D", role: "arrangement" },
    { song_id: "S3", creator_id: "A", role: "lyrics" },
    { song_id: "S3", creator_id: "B", role: "composition" },
    { song_id: "S3", creator_id: "F", role: "composition" },
    { song_id: "S4", creator_id: "B", role: "lyrics" },
    { song_id: "S4", creator_id: "B", role: "composition" },
    { song_id: "S4", creator_id: "G", role: "lyrics" },
    { song_id: "S5", creator_id: "E", role: "lyrics" },
    { song_id: "S6", creator_id: "E", role: "lyrics" }
  ];
  return { artists: [{ artist_id: "G1", name: "Group 1" }, { artist_id: "G2", name: "Group 2" }], creators, works, songs, songArtists, songCreators };
}

test("CSV parser supports quoted commas, newlines, and doubled quotes", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,y","line 1\nline ""2"""\r\n'), [["a", "b"], ["x,y", 'line 1\nline "2"']]);
});

test("work aggregation covers primary filters, joint credits, roles, and version differences", () => {
  const result = aggregateCreatorRankings(fixture(), "G1");
  assert.equal(result.summary.primary_song_count, 4, "multiple-primary is included");
  assert.equal(result.summary.target_work_count, 3);
  const lyrics = result.categories.lyrics.entries;
  assert.deepEqual(lyrics.map(({ creator_id, work_count }) => [creator_id, work_count]), [["A", 2], ["B", 2], ["G", 1]]);
  assert.deepEqual(lyrics.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 1], ["G", 3]], "ties share a competition rank and use creator_id ordering");
  assert.equal(lyrics.find((item) => item.creator_id === "A").works[0].song_ids.length, 2, "same creator/work across two songs counts once");
  assert.ok(!lyrics.some((item) => item.creator_id === "E"), "featured-only and another artist's song are excluded");
  assert.deepEqual(result.categories.composition.entries.map((item) => item.creator_id), ["B", "A", "F"]);
  assert.ok(result.categories.lyrics.entries.some((item) => item.creator_id === "G"), "lyrics-only creator is included");
  assert.ok(result.categories.composition.entries.some((item) => item.creator_id === "F"), "composition-only creator is included");
  assert.deepEqual(result.categories.arrangement.entries.map((item) => item.creator_id), ["C", "D"], "different version arrangers each count once; brass role is excluded");
  assert.deepEqual(result.categories.lyrics_composition.entries.map(({ creator_id, work_count }) => [creator_id, work_count]), [["A", 1], ["B", 1]]);
  assert.equal(result.categories.lyrics_composition.label, "作詞 & 作曲");
});

test("lyrics+composition never combines roles found only on different songs", () => {
  const data = fixture();
  data.songCreators.push({ song_id: "S1", creator_id: "C", role: "lyrics" });
  data.songCreators.push({ song_id: "S2", creator_id: "C", role: "composition" });
  const result = aggregateCreatorRankings(data, "G1");
  assert.ok(!result.categories.lyrics_composition.entries.some((item) => item.creator_id === "C"));
  assert.deepEqual(result.categories.all.entries.find((item) => item.creator_id === "C").works, [
    { work_id: "W1", title: "Work 1", song_ids: ["S1", "S2"], roles: ["arrangement", "composition", "lyrics"] }
  ]);
});

test("competition ranking and creator-id tie order are stable", () => {
  const data = fixture();
  data.works.push({ work_id: "W6", title: "Work 6" }, { work_id: "W7", title: "Work 7" });
  data.songs.push({ song_id: "S7", work_id: "W6" }, { song_id: "S8", work_id: "W7" });
  data.songArtists.push({ song_id: "S7", artist_id: "G1", role: "primary" }, { song_id: "S8", artist_id: "G1", role: "primary" });
  data.songCreators.push({ song_id: "S7", creator_id: "A", role: "lyrics" }, { song_id: "S8", creator_id: "D", role: "lyrics" });
  const entries = aggregateCreatorRankings(data, "G1").categories.lyrics.entries;
  assert.deepEqual(entries.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 2], ["D", 3], ["G", 3]]);

  // Explicit 5/3/3/2 shape specified by the ranking contract.
  const counts = [5, 3, 3, 2];
  const ranked = counts.map((count, index) => ({ count, rank: index === 0 || count !== counts[index - 1] ? index + 1 : 0 }));
  ranked.forEach((item, index) => { if (item.rank === 0) item.rank = ranked[index - 1].rank; });
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 2, 4]);
});

test("core produces competition ranks 1, 2, 2, 4 for counts 5, 3, 3, 2", () => {
  const data = { artists: [{ artist_id: "G1", name: "Group" }], creators: [], works: [], songs: [], songArtists: [], songCreators: [] };
  [["A", 5], ["B", 3], ["C", 3], ["D", 2]].forEach(([creatorId, count]) => {
    data.creators.push({ creator_id: creatorId, name: creatorId });
    for (let index = 0; index < count; index += 1) {
      const suffix = `${creatorId}${index}`;
      data.works.push({ work_id: `W${suffix}`, title: suffix });
      data.songs.push({ song_id: `S${suffix}`, work_id: `W${suffix}` });
      data.songArtists.push({ song_id: `S${suffix}`, artist_id: "G1", role: "primary" });
      data.songCreators.push({ song_id: `S${suffix}`, creator_id: creatorId, role: "lyrics" });
    }
  });
  const { categories } = aggregateCreatorRankings(data, "G1");
  for (const category of [categories.lyrics, categories.all]) {
    assert.deepEqual(category.entries.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 2], ["C", 2], ["D", 4]]);
  }
});

test("all counts every credited work once and retains only the creator's eligible evidence", () => {
  const data = fixture();
  data.creators.push({ creator_id: "H", name: "Creator G" });
  data.works[1].title = "Work 1";
  data.songCreators.push({ song_id: "S3", creator_id: "H", role: "english_lyrics" });
  const { entries } = aggregateCreatorRankings(data, "G1").categories.all;
  assert.deepEqual(entries.map(({ creator_id, work_count, rank }) => [creator_id, work_count, rank]), [
    ["B", 3, 1], ["A", 2, 2], ["C", 1, 3], ["D", 1, 3], ["E", 1, 3], ["F", 1, 3], ["G", 1, 3], ["H", 1, 3]
  ]);
  const expectedWorks = {
    A: [["W1", ["S1", "S2"], ["composition", "lyrics"]], ["W2", ["S3"], ["lyrics"]]],
    B: [["W1", ["S1"], ["english_lyrics", "lyrics"]], ["W2", ["S3"], ["composition"]],
      ["W3", ["S4"], ["composition", "lyrics"]]],
    C: [["W1", ["S1"], ["arrangement"]]],
    D: [["W1", ["S2"], ["arrangement"]]],
    E: [["W1", ["S1"], ["brass_arrangement"]]],
    F: [["W2", ["S3"], ["composition"]]],
    G: [["W3", ["S4"], ["lyrics"]]],
    H: [["W2", ["S3"], ["english_lyrics"]]]
  };
  for (const entry of entries) {
    assert.equal(entry.artist_id, "G1");
    assert.equal(entry.category, "all");
    assert.deepEqual(entry.works.map(({ work_id, song_ids, roles }) => [work_id, song_ids, roles]),
      expectedWorks[entry.creator_id]);
  }
  assert.deepEqual(entries.find(entry => entry.creator_id === "A").works.map(work => work.title), ["Work 1", "Work 1"]);
  assert.deepEqual(entries.slice(-2).map(entry => entry.creator_name), ["Creator G", "Creator G"]);
});

test("all returns an empty ranking for an artist without primary songs", () => {
  const data = fixture();
  data.artists.push({ artist_id: "G3", name: "Group 3" });
  assert.deepEqual(aggregateCreatorRankings(data, "G3").categories.all, { label: "すべて", entries: [] });
});

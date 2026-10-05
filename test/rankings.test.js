import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/csv.js";
import { aggregateCreatorRankings } from "../src/rankings.js";

function fixture() {
  const creators = ["A", "B", "C", "D", "E"].map((id) => ({ creator_id: id, name: `Creator ${id}` }));
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
    { song_id: "S4", creator_id: "B", role: "lyrics" },
    { song_id: "S4", creator_id: "B", role: "composition" },
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
  assert.deepEqual(lyrics.map(({ creator_id, work_count }) => [creator_id, work_count]), [["A", 2], ["B", 2]]);
  assert.deepEqual(lyrics.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 1]], "ties share a competition rank and use creator_id ordering");
  assert.equal(lyrics.find((item) => item.creator_id === "A").works[0].song_ids.length, 2, "same creator/work across two songs counts once");
  assert.ok(!lyrics.some((item) => item.creator_id === "E"), "featured-only and another artist's song are excluded");
  assert.deepEqual(result.categories.composition.entries.map((item) => item.creator_id), ["B", "A"]);
  assert.deepEqual(result.categories.arrangement.entries.map((item) => item.creator_id), ["C", "D"], "different version arrangers each count once; brass role is excluded");
  assert.deepEqual(result.categories.lyrics_composition.entries.map(({ creator_id, work_count }) => [creator_id, work_count]), [["A", 1], ["B", 1]]);
});

test("lyrics+composition never combines roles found only on different songs", () => {
  const data = fixture();
  data.songCreators.push({ song_id: "S1", creator_id: "C", role: "lyrics" });
  data.songCreators.push({ song_id: "S2", creator_id: "C", role: "composition" });
  assert.ok(!aggregateCreatorRankings(data, "G1").categories.lyrics_composition.entries.some((item) => item.creator_id === "C"));
});

test("competition ranking and creator-id tie order are stable", () => {
  const data = fixture();
  data.works.push({ work_id: "W6", title: "Work 6" }, { work_id: "W7", title: "Work 7" });
  data.songs.push({ song_id: "S7", work_id: "W6" }, { song_id: "S8", work_id: "W7" });
  data.songArtists.push({ song_id: "S7", artist_id: "G1", role: "primary" }, { song_id: "S8", artist_id: "G1", role: "primary" });
  data.songCreators.push({ song_id: "S7", creator_id: "A", role: "lyrics" }, { song_id: "S8", creator_id: "D", role: "lyrics" });
  const entries = aggregateCreatorRankings(data, "G1").categories.lyrics.entries;
  assert.deepEqual(entries.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 2], ["D", 3]]);

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
  assert.deepEqual(aggregateCreatorRankings(data, "G1").categories.lyrics.entries.map(({ creator_id, rank }) => [creator_id, rank]), [["A", 1], ["B", 2], ["C", 2], ["D", 4]]);
});

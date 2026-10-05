import { resolve } from "node:path";
import { loadCanonicalData } from "../src/canonical.js";
import { aggregateCreatorRankings, CATEGORY_DEFINITIONS } from "../src/rankings.js";

const root = resolve(import.meta.dirname, "..");
const data = await loadCanonicalData(root);
const artistId = process.argv[2] ?? "G00001";
const ranking = aggregateCreatorRankings(data, artistId);
const songById = new Map(data.songs.map((row) => [row.song_id, row]));
const workById = new Map(data.works.map((row) => [row.work_id, row]));
const creatorById = new Map(data.creators.map((row) => [row.creator_id, row]));
const artistById = new Map(data.artists.map((row) => [row.artist_id, row]));
const primary = data.songArtists.filter((row) => row.artist_id === artistId && row.role === "primary");
const targetSongIds = new Set(primary.map((row) => row.song_id));
const targetCredits = data.songCreators.filter((row) => targetSongIds.has(row.song_id));
const targetWorkIds = new Set([...targetSongIds].map((id) => songById.get(id)?.work_id));

const primaryCounts = new Map();
for (const row of data.songArtists.filter((item) => item.role === "primary")) {
  primaryCounts.set(row.song_id, (primaryCounts.get(row.song_id) ?? 0) + 1);
}
const multiplePrimary = primary.filter((row) => primaryCounts.get(row.song_id) > 1).length;
const featuredOnly = data.songArtists.filter((row) => row.artist_id === artistId && row.role === "featured" && !targetSongIds.has(row.song_id)).length;

const differences = {};
for (const role of ["lyrics", "composition", "arrangement"]) {
  const credits = targetCredits.filter((row) => row.role === role);
  const workKeys = new Set(credits.map((row) => `${row.creator_id}\0${songById.get(row.song_id).work_id}`));
  const examples = [];
  const grouped = new Map();
  for (const credit of credits) {
    const song = songById.get(credit.song_id);
    const key = `${credit.creator_id}\0${song.work_id}`;
    const ids = grouped.get(key) ?? [];
    ids.push(song.song_id);
    grouped.set(key, ids);
  }
  for (const [key, songIds] of grouped) {
    if (songIds.length < 2) continue;
    const [creatorId, workId] = key.split("\0");
    examples.push({ creator_id: creatorId, creator_name: creatorById.get(creatorId)?.name, work_id: workId, title: workById.get(workId)?.title, song_ids: songIds.sort() });
  }
  differences[role] = { song_pairs: credits.length, work_pairs: workKeys.size, difference: credits.length - workKeys.size, examples: examples.slice(0, 5) };
}

const perSongRoles = new Map();
for (const credit of targetCredits) {
  const key = `${credit.song_id}\0${credit.creator_id}`;
  const roles = perSongRoles.get(key) ?? new Set();
  roles.add(credit.role);
  perSongRoles.set(key, roles);
}
const sameSongBoth = [...perSongRoles].filter(([, roles]) => roles.has("lyrics") && roles.has("composition"));
const workCreatorRoles = new Map();
for (const credit of targetCredits) {
  const song = songById.get(credit.song_id);
  const key = `${song.work_id}\0${credit.creator_id}`;
  const roles = workCreatorRoles.get(key) ?? new Set();
  roles.add(credit.role);
  workCreatorRoles.set(key, roles);
}
const countedBoth = new Set(sameSongBoth.map(([key]) => {
  const [songId, creatorId] = key.split("\0");
  return `${songById.get(songId).work_id}\0${creatorId}`;
}));
const crossVersionOnly = [...workCreatorRoles].filter(([key, roles]) => roles.has("lyrics") && roles.has("composition") && !countedBoth.has(key));

const anomalyDetails = [];
const duplicate = (rows, key, label) => {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) anomalyDetails.push(`${label}: ${value.replaceAll("\0", "/")}`);
    seen.add(value);
  }
};
duplicate(data.songArtists, (r) => `${r.song_id}\0${r.artist_id}\0${r.role}`, "duplicate song_artist");
duplicate(data.songCreators, (r) => `${r.song_id}\0${r.creator_id}\0${r.role}`, "duplicate song_creator");
for (const row of data.songArtists) {
  if (!songById.has(row.song_id)) anomalyDetails.push(`missing song: song_artists/${row.song_id}`);
  if (!artistById.has(row.artist_id)) anomalyDetails.push(`missing artist: song_artists/${row.artist_id}`);
  if (!["primary", "featured"].includes(row.role)) anomalyDetails.push(`unexpected artist role: ${row.role}`);
}
for (const row of data.songCreators) {
  if (!songById.has(row.song_id)) anomalyDetails.push(`missing song: song_creators/${row.song_id}`);
  if (!creatorById.has(row.creator_id)) anomalyDetails.push(`missing creator: ${row.creator_id}`);
  if (!["lyrics", "english_lyrics", "composition", "arrangement", "brass_arrangement"].includes(row.role)) anomalyDetails.push(`unexpected creator role: ${row.role}`);
}
for (const row of data.songs) if (!workById.has(row.work_id)) anomalyDetails.push(`missing work: ${row.song_id}/${row.work_id}`);

const versionSummary = {};
for (const version of ["new_vocal", "re_recording", "other"]) {
  const songs = [...targetSongIds].map((id) => songById.get(id)).filter((song) => song.version_type === version);
  const duplicatePairs = Object.values(differences).flatMap((item) => item.examples).filter((item) => item.song_ids.some((id) => songs.some((song) => song.song_id === id)));
  versionSummary[version] = { target_songs: songs.length, duplicate_creator_work_examples: duplicatePairs.slice(0, 3) };
}

const report = {
  artist: ranking.artist,
  primary_target_songs: targetSongIds.size,
  target_works: targetWorkIds.size,
  featured_only_excluded: featuredOnly,
  multiple_primary_included: multiplePrimary,
  categories: Object.fromEntries(CATEGORY_DEFINITIONS.map(({ id }) => {
    const entries = ranking.categories[id].entries;
    return [id, { creator_count: entries.length, creator_work_pairs: entries.reduce((sum, item) => sum + item.work_count, 0), top: entries.filter((item) => item.rank <= 3).map(({ rank, creator_id, creator_name, work_count }) => ({ rank, creator_id, creator_name, work_count })) }];
  })),
  song_vs_work: differences,
  versions: versionSummary,
  specialized_roles_excluded: {
    english_lyrics: targetCredits.filter((row) => row.role === "english_lyrics").length,
    brass_arrangement: targetCredits.filter((row) => row.role === "brass_arrangement").length
  },
  lyrics_composition_same_song_cases: sameSongBoth.length,
  cross_version_only_lyrics_composition: crossVersionOnly.map(([key]) => {
    const [workId, creatorId] = key.split("\0");
    return { work_id: workId, creator_id: creatorId };
  }),
  anomaly_count: anomalyDetails.length,
  anomalies: anomalyDetails
};

console.log(JSON.stringify(report, null, 2));
if (anomalyDetails.length > 0 || crossVersionOnly.length > 0) process.exitCode = 1;

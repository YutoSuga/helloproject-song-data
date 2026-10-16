import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseCsv, readCsv } from "./csv.js";
import { withCanonicalRead } from "./fn004-repository.js";
import { CANONICAL_TABLES, ID_PATTERNS as idPatterns } from "./canonical-schema.js";

// Preserve FN-003's legacy subset validation while sharing canonical metadata.
const tables = CANONICAL_TABLES.map((table) => table.name);
const keys = Object.fromEntries(CANONICAL_TABLES.map((table) => [table.name, table.primaryKey]));
const foreignKeys = Object.fromEntries(CANONICAL_TABLES.map((table) => [table.name,
  Object.fromEntries(table.columns.filter((column) => column.target && column.target !== table.name)
    .map((column) => [column.name, column.target]))]));
const enums = Object.fromEntries(CANONICAL_TABLES.map((table) => [table.name,
  Object.fromEntries(table.columns.filter((column) => column.type === "enum").map((column) => [column.name, column.values]))]));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalized = (value) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
const dateValid = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const append = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const find = (map, key) => map.get(key) ?? [];
const distinct = (rows, id) => [...new Map(rows.map((row) => [row[id], row])).values()].sort((a, b) => a[id].localeCompare(b[id]));

export async function loadReviewCanonical(root, { gate } = {}) {
  return withCanonicalRead({ root, gate, fn: (resolvedRoot) => readReviewCanonical(resolvedRoot) });
}

async function readReviewCanonical(root) {
  const dir = join(root, "data"), names = await readdir(dir);
  for (const name of tables) if (!names.includes(name + ".csv")) throw new Error("Missing canonical CSV: " + name);
  for (const name of tables) {
    const header = parseCsv(await readFile(join(dir, name + ".csv"), "utf8"))[0] ?? [];
    const required = [...keys[name], ...(name === "works" || name === "songs" ? ["title"] : []), ...(name === "artists" || name === "creators" ? ["name"] : [])];
    if (required.some((field) => !header.includes(field)) || new Set(header).size !== header.length) throw new Error("Canonical invalid header: " + name);
  }
  const reads = await Promise.allSettled(tables.map(async (name) => [name, await readCsv(join(dir, name + ".csv"))]));
  const failure = reads.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  const data = Object.fromEntries(reads.map((result) => result.value));
  const ids = {};
  for (const name of tables) {
    const seen = new Set();
    for (const row of data[name]) {
      if (keys[name].some((key) => !row[key])) throw new Error("Canonical empty key: " + name);
      const key = JSON.stringify(keys[name].map((field) => row[field]));
      if (seen.has(key)) throw new Error("Canonical duplicate key: " + name + " " + key);
      seen.add(key);
    }
    if (keys[name].length === 1) ids[name] = new Set(data[name].map((row) => row[keys[name][0]]));
  }
  for (const [name, fields] of Object.entries(foreignKeys)) for (const row of data[name]) {
    for (const [field, target] of Object.entries(fields)) if (row[field] && !ids[target].has(row[field])) throw new Error("Canonical invalid FK: " + name + "." + field);
  }
  for (const name of tables) for (const row of data[name]) {
    if (idPatterns[name] && !idPatterns[name].test(row[keys[name][0]])) throw new Error("Canonical invalid ID: " + name);
    for (const [field, allowed] of Object.entries(enums[name] ?? {})) if (row[field] !== undefined && !allowed.includes(row[field])) throw new Error("Canonical invalid enum: " + name + "." + field);
    for (const [field, value] of Object.entries(row)) if (field.endsWith("_date") && value && !dateValid(value)) throw new Error("Canonical invalid date: " + name + "." + field);
  }
  const videoIntervals = new Set(data.video_songs.map((row) => JSON.stringify([row.video_id, row.song_id, row.start_seconds])));
  for (const row of data.video_song_performers) if (!videoIntervals.has(JSON.stringify([row.video_id, row.song_id, row.start_seconds]))) throw new Error("Canonical invalid video_song_performers interval FK");
  return data;
}

export function validateCandidates(data) {
  if (!object(data) || data.schema_version !== 1 || !Array.isArray(data.candidates)) throw new Error("Invalid song-candidates schema");
  const seen = new Set();
  for (const candidate of data.candidates) {
    if (!object(candidate) || typeof candidate.candidate_id !== "string" || !candidate.candidate_id) throw new Error("Invalid candidate_id");
    if (seen.has(candidate.candidate_id)) throw new Error("Duplicate candidate_id: " + candidate.candidate_id);
    seen.add(candidate.candidate_id);
  }
  return data.candidates;
}

export function validateReviewResults(data) {
  if (!object(data) || data.schema_version !== 1 || !Array.isArray(data.results)) throw new Error("Invalid review-results schema");
  const results = new Map();
  for (const result of data.results) {
    if (!object(result) || typeof result.candidate_id !== "string" || !result.candidate_id || !["hold", "confirmed", "rejected", "applied"].includes(result.status) || (result.notes !== undefined && typeof result.notes !== "string") || (result.decision !== undefined && !object(result.decision)) || (result.reviewed_at !== undefined && typeof result.reviewed_at !== "string")) throw new Error("Invalid review-result entry");
    if (results.has(result.candidate_id)) throw new Error("Duplicate review-result: " + result.candidate_id);
    results.set(result.candidate_id, result);
  }
  return results;
}

function editionLetter(value) {
  const match = typeof value === "string" && value.normalize("NFKC").match(/(?:盤|版)([A-Z])(?:[】\]）)]|$)/i);
  return match ? match[1].toUpperCase() : null;
}
function sourceUrlValid(value) {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}
export function compareCandidates(a, b) {
  const ad = dateValid(a.release_date) ? a.release_date : "9999-99-99";
  const bd = dateValid(b.release_date) ? b.release_date : "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  for (const field of ["product_number", "source_release_url", "source_url", "candidate_id"]) {
    const av = String(a[field] ?? ""), bv = String(b[field] ?? "");
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}
function editionFamily(value) {
  if (!editionLetter(value)) return null;
  return value.normalize("NFKC").replace(/([A-Z])(?=[】\]）)]|$)/i, "");
}
export function sortCandidates(candidates) {
  const byDate = new Map();
  for (const candidate of candidates) append(byDate, dateValid(candidate.release_date) ? candidate.release_date : "9999-99-99", candidate);
  const sorted = [];
  for (const date of [...byDate.keys()].sort()) {
    const groups = new Map();
    for (const candidate of byDate.get(date)) {
      const family = editionFamily(candidate.edition);
      const key = family ? "family:" + family : "single:" + candidate.candidate_id;
      append(groups, key, candidate);
    }
    const orderedGroups = [...groups.values()].sort((a, b) => compareCandidates([...a].sort(compareCandidates)[0], [...b].sort(compareCandidates)[0]));
    for (const group of orderedGroups) {
      group.sort((a, b) => {
        const al = editionLetter(a.edition), bl = editionLetter(b.edition);
        if (al && bl && al !== bl) return al < bl ? -1 : 1;
        return compareCandidates(a, b);
      });
      sorted.push(...group);
    }
  }
  return sorted;
}

function makeIndexes(data) {
  const index = Object.fromEntries(["works", "songs", "artists", "creators", "normalWorks", "normalSongs", "normalArtists", "normalCreators", "songsByWork"].map((name) => [name, new Map()]));
  for (const work of data.works) { append(index.works, work.title, work); append(index.normalWorks, normalized(work.title), work); }
  for (const song of data.songs) { append(index.songs, song.title, song); append(index.normalSongs, normalized(song.title), song); append(index.songsByWork, song.work_id, song); }
  for (const artist of data.artists) { append(index.artists, artist.name, artist); append(index.normalArtists, normalized(artist.name), artist); }
  const creators = new Map(data.creators.map((row) => [row.creator_id, row]));
  for (const creator of data.creators) { append(index.creators, creator.name, creator); append(index.normalCreators, normalized(creator.name), creator); }
  for (const credit of data.song_creators) if (credit.credit_name !== creators.get(credit.creator_id).name) {
    const creator = creators.get(credit.creator_id);
    append(index.creators, credit.credit_name, creator);
    append(index.normalCreators, normalized(credit.credit_name), creator);
  }
  return index;
}
function match(exactIndex, normalIndex, value, id) {
  const exact = distinct(find(exactIndex, value), id);
  const approximate = distinct(find(normalIndex, normalized(value)).filter((row) => !exact.some((item) => item[id] === row[id])), id);
  return { exact, normalized: approximate };
}
const workView = (row) => ({ work_id: row.work_id, title: row.title });
const songView = (row) => ({ song_id: row.song_id, work_id: row.work_id, title: row.title, version_name: row.version_name, version_type: row.version_type, release_date: row.release_date });
const artistView = (row) => ({ artist_id: row.artist_id, name: row.name, type: row.type });
const creatorView = (row) => ({ creator_id: row.creator_id, name: row.name });
const view = (found, convert) => ({ exact: found.exact.map(convert), normalized: found.normalized.map(convert) });

export function buildSongReviews(candidates, canonical, previous = new Map()) {
  const index = makeIndexes(canonical), provisional = new Map(), reviews = [];
  for (const candidate of sortCandidates(candidates)) {
    const blocked = [];
    if (typeof candidate.title !== "string" || !candidate.title) blocked.push("missing_title");
    if (!dateValid(candidate.release_date)) blocked.push("invalid_release_date");
    if (!sourceUrlValid(candidate.source_url)) blocked.push("invalid_source_url");
    if (typeof candidate.artist_name !== "string" || !candidate.artist_name) blocked.push("missing_artist_name");
    const source = Object.fromEntries(["artist_id", "artist_slug", "source_artist_slug", "artist_name", "title", "release_title", "release_date", "release_type", "source_url", "source_release_url", "track_number", "media_type", "edition", "disc_index", "product_number", "credits", "related_candidates", "status", "notes"].map((field) => [field, candidate[field] ?? null]));
    const sourceFacts = Object.fromEntries(Object.entries(source).filter(([field]) => !["artist_id", "artist_slug", "related_candidates", "status", "notes"].includes(field)));
    const review = { candidate_id: candidate.candidate_id, source, release_order: { global_position: reviews.length + 1, release_date: candidate.release_date ?? null, edition_tie_break: editionLetter(candidate.edition), work_candidate_position: null, earliest_candidate: null, older_canonical_song: null, original_candidate: false }, canonical_matches: { works: { exact: [], normalized: [] }, songs: { exact: [], normalized: [] }, artist: { exact: [], normalized: [] }, creators: [] }, provisional_work: null, same_work_candidates: [], same_song_candidates: [], resolved: { candidate_id: candidate.candidate_id, source: blocked.length ? {} : sourceFacts }, human_required: ["work_choice", "song_choice", "version_type", "audio_identity", "title_identity", "related_unit_identity", "artist_role", "performer", "creator_identity_if_ambiguous", "song_release_date"], blocked, warnings: [], previous_review_result: previous.get(candidate.candidate_id) ?? null };
    reviews.push(review);
    if (blocked.length) continue;
    const works = match(index.works, index.normalWorks, candidate.title, "work_id");
    const songs = match(index.songs, index.normalSongs, candidate.title, "song_id");
    const artists = match(index.artists, index.normalArtists, candidate.artist_name, "artist_id");
    review.canonical_matches.works = view(works, workView);
    review.canonical_matches.songs = view(songs, songView);
    review.canonical_matches.artist = view(artists, artistView);
    if (artists.exact.length === 1) review.resolved.artist_id = artists.exact[0].artist_id;
    if (works.exact.length > 1 || songs.exact.length > 1 || artists.exact.length > 1) review.warnings.push("ambiguous_exact_match");
    if (object(candidate.credits)) for (const [role, credit] of Object.entries(candidate.credits)) {
      if (role === "performer" || !object(credit)) continue;
      for (const name of Array.isArray(credit.names) ? credit.names : []) {
        if (typeof name !== "string" || !name) continue;
        const found = match(index.creators, index.normalCreators, name, "creator_id");
        const entry = { role, name, raw: credit.raw ?? null, ...view(found, creatorView) };
        if (found.exact.length === 1) entry.resolved_creator_id = found.exact[0].creator_id;
        if (found.exact.length > 1) review.warnings.push("ambiguous_creator");
        review.canonical_matches.creators.push(entry);
      }
    }
    if (works.exact.length === 1) review._group = "canonical:" + works.exact[0].work_id;
    else if (!works.exact.length && songs.exact.length && new Set(songs.exact.map((row) => row.work_id)).size === 1) review._group = "canonical:" + songs.exact[0].work_id;
    else if (!works.exact.length && !works.normalized.length && !songs.exact.length && !songs.normalized.length) {
      const key = normalized(candidate.title);
      if (!provisional.has(key)) provisional.set(key, { provisional_work_id: "pw_" + createHash("sha256").update(candidate.candidate_id).digest("hex").slice(0, 24), anchor_candidate_id: candidate.candidate_id, title: candidate.title });
      review.provisional_work = { ...provisional.get(key), candidate_ids: [] };
      review._group = provisional.get(key).provisional_work_id;
    }
  }
  const groups = new Map();
  for (const review of reviews) if (review._group) append(groups, review._group, review);
  for (const [group, members] of groups) {
    const existingSongs = group.startsWith("canonical:") ? find(index.songsByWork, group.slice(10)) : [];
    members.forEach((review, position) => {
      review.release_order.work_candidate_position = position + 1;
      review.release_order.earliest_candidate = position === 0;
      review.release_order.original_candidate = position === 0;
      review.release_order.older_canonical_song = existingSongs.some((song) => dateValid(song.release_date) && song.release_date < review.release_order.release_date);
      review.same_work_candidates = members.filter((item) => item !== review).map((item) => item.candidate_id);
      review.same_song_candidates = members.filter((item) => item !== review && normalized(item.source.title) === normalized(review.source.title)).map((item) => item.candidate_id);
      if (review.provisional_work) review.provisional_work.candidate_ids = members.map((item) => item.candidate_id);
    });
  }
  for (const review of reviews) delete review._group;
  return { schema_version: 1, reviews };
}

export async function saveSongReviews(outputPath, data, { renameFile = rename } = {}) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = outputPath + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await renameFile(temp, outputPath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function prepareReviews({ root = process.cwd(), outputPath = join(root, "staging", "song-reviews.json"), save = saveSongReviews } = {}) {
  const candidates = validateCandidates(JSON.parse(await readFile(join(root, "staging", "song-candidates.json"), "utf8")));
  const canonical = await loadReviewCanonical(root);
  let previous;
  try { previous = validateReviewResults(JSON.parse(await readFile(join(root, "staging", "review-results.json"), "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; previous = new Map(); }
  const result = buildSongReviews(candidates, canonical, previous);
  await save(outputPath, result);
  return result;
}

import assert from 'node:assert/strict';
import { readCsv } from '../../src/csv.js';
import { join } from 'node:path';

// Independent oracle: raw canonical relations and Song→Work only. No generated
// JSON, production reader, catalog builder or aggregation function is used.
export async function canonicalCounts(root, artistId = 'G00001') {
  const relations = await readCsv(join(root, 'data/song_artists.csv'));
  const songs = await readCsv(join(root, 'data/songs.csv'));
  const primary = new Set();
  const registered = new Set();
  for (const row of relations) {
    if (row.artist_id !== artistId) continue;
    if (row.role === 'primary') primary.add(row.song_id);
    if (['primary', 'featured'].includes(row.role)) registered.add(row.song_id);
  }
  const works = new Set();
  for (const id of registered) assert(songs.some(song => song.song_id === id), `Missing song ${id}`);
  for (const song of songs) if (primary.has(song.song_id)) works.add(song.work_id);
  return { primary, registered, summary: {
    primary_song_count: primary.size, target_work_count: works.size
  } };
}

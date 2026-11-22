import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSongTables } from '../src/song-catalog.js';
import { readCoverage, readPolicy, readUpdates } from '../site/about-data-model.js';

try {
  const root = resolve(import.meta.dirname, '..');
  const dir = resolve(root, 'site/data/about');
  const read = async file => JSON.parse(await readFile(resolve(dir, file), 'utf8'));
  const [tables, coverage, policy, updates] = await Promise.all([
    loadSongTables(root), read('coverage.json'), read('policy.json'), read('updates.json')
  ]);
  const songIds = new Set(tables.songs.map(song => song.song_id));
  const primarySongs = new Map(tables.artists.map(artist => [artist.artist_id, new Set()]));
  for (const { artist_id, song_id, role } of tables.song_artists) {
    if (role === 'primary' && songIds.has(song_id)) primarySongs.get(artist_id)?.add(song_id);
  }
  const artists = tables.artists.map(({ artist_id, name }) => ({
    artist_id, name, registered_audio_count: primarySongs.get(artist_id).size
  }));
  readCoverage(coverage, artists);
  readPolicy(policy);
  readUpdates(updates);
  await writeFile(resolve(dir, 'artists.json'), `${JSON.stringify(artists, null, 2)}\n`);
  console.log('About data validated and artist names and audio counts generated from canonical CSV');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

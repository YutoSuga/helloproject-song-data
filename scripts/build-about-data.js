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
  const artists = tables.artists.map(({ artist_id, name }) => ({ artist_id, name }));
  readCoverage(coverage, artists);
  readPolicy(policy);
  readUpdates(updates);
  await writeFile(resolve(dir, 'artists.json'), `${JSON.stringify(artists, null, 2)}\n`);
  console.log('About data validated and artist names projected from canonical CSV');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

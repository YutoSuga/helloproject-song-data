import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateSongCatalog, loadSongTables } from '../src/song-catalog.js';

const root = resolve(import.meta.dirname, '..');
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !/^G[0-9]{5}$/.test(args[0]))) throw new Error('Usage: npm run songs:generate -- [G00001]');
  const data = generateSongCatalog(await loadSongTables(root), args[0]);
  const directory = join(root, 'site/data/songs');
  await mkdir(directory, { recursive: true });
  const output = join(directory, `${data.artist.artist_id}.json`), temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  console.log(`Generated ${output}: ${data.works.length} works / ${data.works.reduce((n,w) => n + w.songs.length, 0)} songs`);
} catch (error) { console.error(error.message); process.exitCode = 1; }

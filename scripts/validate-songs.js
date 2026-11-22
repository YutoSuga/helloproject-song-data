import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateSongCatalog, loadSongTables } from '../src/song-catalog.js';
import { readSongCatalog } from '../site/song-catalog-model.js';
import { validateSongCatalog } from '../src/song-catalog-contract.js';
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !/^G[0-9]{5}$/.test(args[0]))) throw new Error('Usage: npm run songs:validate -- [G00001]');
  const root = resolve(import.meta.dirname, '..'), artistId = args[0] ?? 'G00001';
  const expected = generateSongCatalog(await loadSongTables(root), artistId);
  const path = resolve(root, `site/data/songs/${artistId}.json`);
  const text = await readFile(path, 'utf8');
  const actual = JSON.parse(text);
  validateSongCatalog(actual);
  readSongCatalog(actual, artistId);
  if (text !== `${JSON.stringify(expected, null, 2)}\n`) throw new Error(`${path}: committed JSON differs from canonical generation; run songs:generate`);
  console.log(`${path}: contract and canonical contents valid`);
} catch (error) { console.error(error.message); process.exitCode = 1; }

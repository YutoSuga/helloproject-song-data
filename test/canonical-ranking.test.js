import { canonicalCounts } from './helpers/canonical-counts.js';
import { fileURLToPath as rootPath } from 'node:url';
import assert from "node:assert/strict";
import test from "node:test";
import { loadCanonicalData } from "../src/canonical.js";
import { aggregateCreatorRankings } from "../src/rankings.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("current canonical Juice=Juice data aggregates by work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hp-ranking-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL("../data", import.meta.url)), join(root, "data"), { recursive: true });
  const data = await loadCanonicalData(root);
  const result = aggregateCreatorRankings(data, "G00001");
  assert.deepEqual(result.summary, (await canonicalCounts(rootPath(new URL("..", import.meta.url)))).summary);
  assert.deepEqual(Object.keys(result.categories), [
    "all",
    "lyrics",
    "composition",
    "lyrics_composition",
    "arrangement"
  ]);
  assert.ok(result.categories.all.entries.length > 0);
  for (const category of Object.values(result.categories)) {
    for (const entry of category.entries) assert.equal(entry.work_count, entry.works.length);
  }
});

test('CSV count oracle follows new works, recordings and featured credits and detects bad output', async (t) => {
  const { readCsv } = await import('../src/csv.js');
  const { readFile, writeFile } = await import('node:fs/promises');
  const { loadSongTables, generateSongCatalog } = await import('../src/song-catalog.js');
  const { promisify } = await import('node:util');
  const execFile = promisify((await import('node:child_process')).execFile);
  const root = await mkdtemp(join(tmpdir(), 'hp-count-growth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = rootPath(new URL('..', import.meta.url));
  for (const dir of ['data', 'src', 'scripts', 'site']) {
    await cp(join(source, dir), join(root, dir), { recursive: true });
  }
  await cp(join(source, 'package.json'), join(root, 'package.json'));
  const baseline = await canonicalCounts(root);
  const songs = await readCsv(join(root, 'data/songs.csv'));
  const works = await readCsv(join(root, 'data/works.csv'));
  const relations = await readCsv(join(root, 'data/song_artists.csv'));
  const primary = songs.find(song => baseline.primary.has(song.song_id));
  const other = relations.find(row => row.role === 'primary' && row.artist_id !== 'G00001');
  const next = (rows, field, prefix) => prefix + String(Math.max(0, ...rows
    .map(row => row[field]).filter(id => id.startsWith(prefix)).map(id => Number(id.slice(1)))) + 1).padStart(5, '0');
  const workId = next(works, 'work_id', 'W');
  async function append(table, row) {
    const path = join(root, 'data', `${table}.csv`);
    const header = (await readFile(path, 'utf8')).split('\n')[0].split(',');
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    await writeFile(path, (await readFile(path, 'utf8')) + header.map(key => quote(row[key])).join(',') + '\n');
  }
  await append('works', { ...works[0], work_id: workId, title: 'Isolated count test' });
  const added = [];
  for (const [work, featured] of [[workId, false], [primary.work_id, false], [workId, true]]) {
    const songId = next(songs, 'song_id', 'J');
    const song = { ...primary, song_id: songId, work_id: work, title: 'Isolated recording' };
    songs.push(song);
    await append('songs', song);
    await append('song_artists', { ...relations[0], song_id: songId,
      artist_id: featured ? other.artist_id : 'G00001', role: 'primary' });
    if (featured) await append('song_artists', { ...relations[0], song_id: songId, role: 'featured', credit_order: '2' });
    added.push(songId);
  }
  // Production reader validates all 14 copied tables; originals are never edited.
  const result = aggregateCreatorRankings(await loadCanonicalData(root), 'G00001');
  const expected = await canonicalCounts(root);
  assert.equal(expected.primary.size - baseline.primary.size, 2);
  assert.equal(expected.summary.target_work_count - baseline.summary.target_work_count, 1);
  assert.equal(expected.registered.size - baseline.registered.size, 3);
  assert.deepEqual(result.summary, expected.summary);
  const catalog = generateSongCatalog(await loadSongTables(root), 'G00001');
  const ids = new Set(catalog.works.flatMap(work => work.songs.map(song => song.song_id)));
  assert.deepEqual(ids, expected.primary);
  assert(!ids.has(added[2]));
  await execFile(process.execPath, [join(root, 'scripts/build-about-data.js')]);
  const artists = JSON.parse(await readFile(join(root, 'site/data/about/artists.json'), 'utf8'));
  assert.equal(artists.find(row => row.artist_id === 'G00001').registered_audio_count, expected.registered.size);
  // Negative controls: missed recording, featured inclusion, and counting songs as works.
  for (const summary of [
    { ...result.summary, primary_song_count: result.summary.primary_song_count - 1 },
    { ...result.summary, primary_song_count: result.summary.primary_song_count + 1 },
    { ...result.summary, target_work_count: result.summary.target_work_count + 1 }
  ]) assert.throws(() => assert.deepEqual(summary, expected.summary), assert.AssertionError);
  const omitted = new Set(ids); omitted.delete(added[0]);
  assert.throws(() => assert.deepEqual(omitted, expected.primary), assert.AssertionError);
  assert.throws(() => assert.equal(expected.registered.size - 1, artists.find(row => row.artist_id === 'G00001').registered_audio_count), assert.AssertionError);
});

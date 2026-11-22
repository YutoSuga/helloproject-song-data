import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readCoverage, readPolicy, readUpdates } from '../site/about-data-model.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/about-data.json', import.meta.url), 'utf8'));
const today = '2025-03-07';

test('updates sort by newest date and preserve order within each date', () => {
  const { updates } = fixture;
  assert.deepEqual(readUpdates(updates, today), [updates[1], updates[2], updates[3], updates[0]]);
  assert.equal(updates[0].description, '古い更新');
  assert.deepEqual(readUpdates([], today), []);
});

test('updates reject missing fields, invalid calendar dates and future publications', () => {
  const updates = fixture.updates;
  for (const date of [null, '2025-02-29', '2025-2-20', '2025-04-31', '0000-01-01', '2025-03-08']) {
    assert.throws(() => readUpdates([{ ...updates[0], date }], today), /invalid entry/);
  }
  assert.throws(() => readUpdates([{ date: today }], today), /invalid entry/);
  assert.throws(() => readUpdates([{ date: today, description: ' ' }], today), /invalid entry/);
  assert.throws(() => readUpdates({ updates }, today), /expected an array/);
});

test('coverage joins names by canonical ID, keeps manual dates and supports unknown and unlisted artists', () => {
  const { coverage, artists } = fixture;
  const rows = readCoverage(coverage, artists, today);
  assert.deepEqual(rows.map(row => row.name), ['アーティストA', 'アーティストC', 'アーティストB']);
  assert.equal(rows[0].covered_from, '2013-04-03');
  assert.equal(rows[0].registered_audio_count, 123);
  assert.equal(rows[0].covered_through, '2024-02-29');
  assert.equal(rows[0].reflected_at, '2025-03-01');
  assert.equal(rows[0].note, '別名義の収録曲も掲載。');
  assert.equal(rows[1].status, 'unlisted');
  assert.equal(rows[2].covered_from, null);
  assert.equal(rows[2].covered_through, null);
  assert.equal(rows[2].registered_audio_count, 0);
  const partial = { artists: [{ ...coverage.artists[0], covered_through: null }] };
  assert.equal(readCoverage(partial, artists, today)[0].covered_from, '2013-04-03');
  assert.equal(rows[2].reflected_at, null);
  assert.deepEqual(readCoverage({ artists: [] }, artists, today), []);
});

test('coverage rejects invalid references, duplicates, status and date combinations', () => {
  const { coverage, artists } = fixture;
  const [entry] = coverage.artists;
  const readEntry = row => readCoverage({ artists: [row] }, artists, today);
  assert.throws(() => readEntry({ ...entry, artist_id: 'G99903' }), /artist ID/);
  assert.throws(() => readEntry({ ...entry, artist_id: 'G901' }), /artist ID/);
  assert.throws(() => readEntry({ ...entry, reflected_at: undefined }), /status or dates/);
  const { covered_from: omitted, ...missingStart } = entry;
  assert.throws(() => readEntry(missingStart), /invalid or duplicate artist ID/);
  assert.throws(() => readEntry({ ...entry, covered_from: '2013-4-03' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, covered_from: '2024-03-01' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, covered_from: '2025-03-08', covered_through: null }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, covered_through: '2023-02-29' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, reflected_at: '2025-03-08' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, status: 'unlisted' }), /status or dates/);
  assert.throws(() => readCoverage({ ...coverage, artists: [entry, entry] }, artists, today), /duplicate artist ID/);
  assert.throws(() => readCoverage(coverage, [artists[0], artists[0]], today), /duplicate ID/);
  assert.throws(() => readEntry({ ...entry, note: ' ' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, status: 'unlisted', covered_through: null, reflected_at: null }), /status or dates/);
  for (const registered_audio_count of [-1, 0.5, '120']) {
    assert.throws(() => readCoverage(coverage, [{ ...artists[0], registered_audio_count }, artists[1]], today), /invalid artist/);
  }
  for (const names of [['アーティストA'], ['新規', '新規'], [' ']]) {
    assert.throws(() => readCoverage({ artists: names.map(name => ({ name })) }, artists, today), /pending artist name/);
  }
});

test('committed public JSON passes the rendering contracts', async () => {
  const json = async file => JSON.parse(await readFile(new URL(`../site/data/about/${file}.json`, import.meta.url), 'utf8'));
  readUpdates(await json('updates'));
  const coverage = readCoverage(await json('coverage'), await json('artists'));
  const home = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const roster = [...home.matchAll(/<span class="dot" aria-hidden="true">\s*<\/span>\s*<span>([^<]+)<\/span>/g)];
  assert.equal(roster.length, 8);
  assert.deepEqual(coverage.map(row => row.name), roster.map(match => match[1]));
  const juice = coverage.find(row => row.artist_id === 'G00001');
  assert.match(juice.note, /NEXT YOU.*Next is you!.*大人の事情/);
  const catalog = JSON.parse(await readFile(new URL('../site/data/songs/G00001.json', import.meta.url), 'utf8'));
  assert.equal(juice.registered_audio_count, catalog.works.flatMap(work => work.songs).length);
  readPolicy(await json('policy'));
  assert.throws(() => readPolicy({ sections: [], coverage_note: '説明' }), /invalid structure/);
});

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
  assert.deepEqual(rows.map(row => row.name), ['アーティストA', 'アーティストB', 'アーティストC']);
  assert.equal(rows[0].covered_through, '2024-02-29');
  assert.equal(rows[0].reflected_at, '2025-03-01');
  assert.equal(rows[1].covered_through, null);
  assert.equal(rows[1].reflected_at, null);
  assert.equal(rows[2].status, 'unlisted');
  assert.deepEqual(readCoverage({ artists: [], pending_artists: [] }, artists, today), []);
});

test('coverage rejects invalid references, duplicates, status and date combinations', () => {
  const { coverage, artists } = fixture;
  const [entry] = coverage.artists;
  const readEntry = row => readCoverage({ artists: [row], pending_artists: [] }, artists, today);
  assert.throws(() => readEntry({ ...entry, artist_id: 'G99903' }), /artist ID/);
  assert.throws(() => readEntry({ ...entry, artist_id: 'G901' }), /artist ID/);
  assert.throws(() => readEntry({ ...entry, reflected_at: undefined }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, covered_through: '2023-02-29' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, reflected_at: '2025-03-08' }), /status or dates/);
  assert.throws(() => readEntry({ ...entry, status: 'unlisted' }), /status or dates/);
  assert.throws(() => readCoverage({ ...coverage, artists: [entry, entry] }, artists, today), /duplicate artist ID/);
  assert.throws(() => readCoverage(coverage, [artists[0], artists[0]], today), /duplicate ID/);
  for (const pending_artists of [['アーティストA'], ['新規', '新規'], [' ']]) {
    assert.throws(() => readCoverage({ ...coverage, pending_artists }, artists, today), /pending artist name/);
  }
});

test('committed public JSON passes the rendering contracts', async () => {
  const json = async file => JSON.parse(await readFile(new URL(`../site/data/about/${file}.json`, import.meta.url), 'utf8'));
  readUpdates(await json('updates'));
  readCoverage(await json('coverage'), await json('artists'));
  readPolicy(await json('policy'));
  assert.throws(() => readPolicy({ sections: [], coverage_note: '説明' }), /invalid structure/);
});

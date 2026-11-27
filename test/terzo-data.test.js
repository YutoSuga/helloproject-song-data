import assert from 'node:assert/strict';
import test from 'node:test';
import { readCsv } from '../src/csv.js';
import { CANONICAL_SCHEMA } from '../src/canonical-schema.js';
import { validateCanonicalTables } from '../src/canonical-validator.js';

const tables = Object.fromEntries(await Promise.all(
  Object.entries(CANONICAL_SCHEMA).map(async ([name, schema]) =>
    [name, await readCsv(new URL(`../${schema.path}`, import.meta.url))])
));

test('terzo editions contain exactly 24 tracks and retain the 2018 Goal recording', () => {
  assert.deepEqual(validateCanonicalTables(tables), { ok: true, diagnostics: [] });
  for (const rows of Object.values(tables)) {
    assert.equal(rows.some(row => /^J0002[567]$/.test(row.song_id)), false);
  }

  for (const [id, catalog] of [
    ['L00001', 'HKCN-50712'], ['L00002', 'HKCN-50715'], ['L00003', 'HKCN-50718'],
  ]) {
    assert.equal(tables.releases.find(row => row.release_id === id).catalog_number, catalog);
    const tracks = tables.release_tracks.filter(row => row.release_id === id);
    const positions = [16, 8].flatMap((count, disc) =>
      Array.from({ length: count }, (_, track) => `${disc + 1}/${track + 1}`));
    assert.deepEqual(tracks.map(row => `${row.disc_number}/${row.track_number}`), positions);
  }
  assert.deepEqual(tables.release_tracks.filter(row => row.song_id === 'J00028')
    .map(row => `${row.release_id}/${row.disc_number}/${row.track_number}`),
    ['L00103/2/7', 'L00104/2/7']);

  for (const id of ['L00115', 'L00116']) {
    assert.deepEqual(tables.release_tracks.filter(row => row.release_id === id).map(row => row.song_id),
      Array.from({ length: 14 }, (_, n) => `J${String(93 + n).padStart(5, '0')}`));
  }
});

test('terzo recording dates and individually credited performers are retained', () => {
  for (let n = 17; n <= 24; n++) {
    assert.equal(tables.songs.find(row => row.song_id === `J000${n}`).release_date, '2022-04-20');
  }
  assert.equal(tables.songs.find(row => row.song_id === 'J00028').release_date, '2018-08-01');

  for (const [id, members] of [
    ['J00020', [3, 4, 6, 5]],
    ['J00023', [7, 8, 12, 13, 14]],
    ['J00024', [2, 10, 1, 3, 6, 4, 7, 8, 5, 12, 13, 14]],
  ]) {
    assert.deepEqual(tables.song_performers.filter(row => row.song_id === id)
      .map(row => [row.member_id, row.performer_order]),
      members.map((member, index) => [`P${String(member).padStart(5, '0')}`, String(index + 1)]));
  }
});

test('terzo credits use the official names and order within each role', () => {
  const credits = (id, role) => tables.song_creators
    .filter(row => row.song_id === id && row.role === role)
    .sort((a, b) => Number(a.credit_order) - Number(b.credit_order))
    .map(row => row.credit_name);
  const expectations = [
    ['J00004', '山崎あおい', '山崎あおい', '鈴木俊介'],
    ['J00006', '山崎あおい', '山崎あおい', '鈴木俊介'],
    ['J00008', '山崎あおい', '山崎あおい', '鈴木俊介'],
    ['J00017', '中島卓偉', '中島卓偉', '中島卓偉/宮永治郎'],
    ['J00018', '山崎あおい', 'Andreas Carlsson/Julie Yu/Erik Lidbom', 'Erik Lidbom'],
    ['J00019', '徳田光希', '徳田光希', '平田祥一郎'],
    ['J00020', 'オオヤギヒロオ/井筒日美', 'オオヤギヒロオ', '浜田ピエール裕介'],
    ['J00022', '井筒日美', 'Shusui/Andreas Ohrn/Henrik Smith', 'Henrik Smith'],
    ['J00023', 'Shusui/Zeyun/tsubomi', 'Shusui/Zeyun/tsubomi', 'Zeyun'],
  ];
  for (const [id, lyrics, composition, arrangement] of expectations) {
    for (const [role, expected] of Object.entries({ lyrics, composition, arrangement })) {
      assert.deepEqual(credits(id, role), expected.split('/'), `${id} ${role}`);
    }
  }
  assert.equal(tables.song_creators.find(row => row.credit_name === 'Andreas Ohrn').creator_id, 'C00021');
  assert(tables.song_creators.filter(row => row.credit_name === 'Zeyun').every(row => row.creator_id === 'C00033'));
  assert.deepEqual(tables.song_creators.filter(row => row.song_id === 'J00018' && row.role === 'composition')
    .map(row => [row.creator_id, row.credit_order]), [['C00089', '1'], ['C00090', '2'], ['C00076', '3']]);
  assert.equal(tables.creators.find(row => row.creator_id === 'C00089').name, 'Andreas Carlsson');
  assert.equal(tables.creators.find(row => row.creator_id === 'C00090').name, 'Julie Yu');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCreatorNames, searchCreators } from '../site/creator-name.js';

const row = (creator_id, creator_name, name_kana = null) => ({ creator_id, creator_name, name_kana });
const rows = [
  row('C1', '２音'), row('C2', '山崎あおい', 'やまざきあおい'), row('C3', 'つんく', 'つんく'),
  row('C4', 'ＫＯＵＧＡ', 'こうが'), row('C5', 'aoi日本語', 'あおい'), row('C6', '未確認'),
  row('C7', '児玉雨子', 'こだまあめこ'), row('C8', '！other'), row('C9', 'Erik Lidbom'),
  row('C10', '山崎あおい', 'やまざきあおい'), row('C11', 'こだまLatin', 'こだま')
];

test('creator display ordering separates script and uses reading, Latin alphabet and stable IDs', () => {
  const expected = ['C11', 'C7', 'C3', 'C10', 'C2', 'C6', 'C5', 'C9', 'C4', 'C8', 'C1'];
  assert.deepEqual([...rows].sort(compareCreatorNames).map(r => r.creator_id), expected);
  assert.deepEqual([...rows].reverse().sort(compareCreatorNames).map(r => r.creator_id), expected);
});

test('creator search matches declared readings and names across case, width and kana', () => {
  const ids = query => searchCreators(rows, query).map(r => r.creator_id);
  for (const term of ['山崎', 'やまざき', 'ヤマザキ', '  ﾔﾏｻﾞｷ ']) assert.deepEqual(ids(term), ['C10', 'C2']);
  for (const term of ['KOUGA', 'Kouga', 'ｋｏｕｇａ', 'こうが', 'ｺｳｶﾞ']) assert.deepEqual(ids(term), ['C4']);
  assert.deepEqual(ids('ツンク'), ['C3']);
  assert.deepEqual(ids('未確認'), ['C6']);
  assert.deepEqual(ids('C4'), []);
});

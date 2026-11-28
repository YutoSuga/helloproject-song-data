import { collaborationRecordings, groupRecordings, roleBreakdown } from '../site/collaboration-credits.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { allCollaborations, analyzeCollaborators, collaborationIndex, pairKey, selfCollaboration } from '../site/collaborators.js';
import { readState, safeFrom } from '../site/site-state.js';

const song = (song_id, ...credits) => ({
  song_id, credits: credits.map(([creator_id, role]) => ({ creator_id, role, creator_name: '同名' }))
});
const work = (work_id, ...songs) => ({ work_id, title: work_id, first_release_date: null, songs });

test('unordered collaboration deduplicates Work and preserves Song-specific directional role evidence', () => {
  const a = 'C00001', b = 'C00002', c = 'C00003';
  const works = [
    work('W1', song('S1', [a, 'lyrics'], [b, 'composition'], [b, 'arrangement']),
      song('S2', [a, 'lyrics'], [b, 'composition']), song('S3', [c, 'lyrics'])),
    work('W2', song('S4', [a, 'composition'], [b, 'lyrics'], [b, 'english_lyrics'])),
    work('W3', song('S5', [a, 'lyrics'], [b, 'lyrics']),
      song('S6', [a, 'composition'], [b, 'composition']),
      song('S7', [a, 'arrangement'], [b, 'arrangement'])),
    work('W4', song('S8', [a, 'composition'], [b, 'arrangement'])),
    work('W5', song('S9', [a, 'lyrics']), song('S10', [b, 'composition']))
  ];
  const [row] = allCollaborations(works);
  assert.deepEqual([row.first, row.second, row.work_count, row.rank], [a, b, 4, 1]);
  assert.equal(allCollaborations(works).length, 1);
  assert.equal(collaborationIndex(works).pairs.get(pairKey(b, a)).works, row.works);
  assert.equal(analyzeCollaborators(works, b).entries[0].works, row.works);
  assert.equal(analyzeCollaborators(works, a).entries[0].works, row.works);
  const recordings = collaborationRecordings(works, row.works);
  const patterns = roleBreakdown(recordings, [a, b]);
  assert.deepEqual(patterns.find(pattern => pattern.songIds.includes('S1')).credits.map(credit => credit.role),
    ['lyrics', 'composition', 'arrangement']);
  assert.deepEqual(patterns.find(pattern => pattern.songIds.includes('S2')).credits.map(credit => credit.role),
    ['lyrics', 'composition']);
  assert.deepEqual(patterns.find(pattern => pattern.songIds.includes('S4')).credits.map(credit => credit.creator_id),
    [b, a, b]);
  assert.equal(patterns.find(pattern => pattern.songIds.includes('S5')).credits.length, 2);
  assert.deepEqual(recordings[0].songs.map(item => item.song_id), ['S1', 'S2']);
  assert.equal(recordings[0].totalSongs, 3);
  assert(patterns.reduce((sum, row) => sum + row.count, 0) > row.work_count);
});

test('competition ranking includes every tied row through third place', () => {
  const works = [4, 3, 2, 2, 1].flatMap((n, i) => Array.from({ length: n }, (_, j) =>
    work(`W${i}-${j}`, song(`S${i}-${j}`, ['A', 'lyrics'], [String(i), 'lyrics']))));
  assert.deepEqual(allCollaborations(works).filter(row => row.rank <= 3).map(row => row.rank), [1, 2, 3, 3]);
  assert.deepEqual(analyzeCollaborators(works, 'A').entries.filter(row => row.rank <= 3).map(row => row.rank), [1, 2, 3, 3]);
});

test('self details reuse every published directional self Work and exact Song evidence', async () => {
  const load = file => readFile(new URL(`../site/data/${file}/G00001.json`, import.meta.url), 'utf8').then(JSON.parse);
  const [rankings, catalog] = await Promise.all([load('rankings'), load('songs')]);
  const entries = rankings.lyrics_composition_pairs.entries;
  for (const row of entries.filter(row => row.lyricist_creator_id === row.composer_creator_id)) {
    const works = selfCollaboration(entries, catalog.works, row.lyricist_creator_id);
    assert.equal(works.length, row.work_count);
    const patterns = roleBreakdown(collaborationRecordings(catalog.works, works), [row.lyricist_creator_id, row.lyricist_creator_id]);
    assert(patterns.every(pattern => pattern.credits.every(credit => credit.creator_id === row.lyricist_creator_id)));
    assert.deepEqual(patterns.flatMap(pattern => pattern.songIds).sort(), row.works.flatMap(work => work.song_ids).sort());
    for (const work of row.works) assert.deepEqual(works.find(item => item.work_id === work.work_id).song_ids, work.song_ids);
  }
});

test('pair URLs normalize creator IDs and retain the chosen mode without nesting return URLs', () => {
  const path = '/analysis/detail/';
  const query = 'artist_id=G00001&creator_id=C00002&partner_id=C00001';
  assert.deepEqual(readState(path, new URLSearchParams(query)), {
    artist_id: 'G00001', creator_id: 'C00001', partner_id: 'C00002'
  });
  assert.equal(safeFrom(path + '?' + query + '&from=%2F', 'https://hellosongdb.com'), null);
  assert.equal(readState('/analysis/', new URLSearchParams('mode=all&include_self=1')).include_self, '1');
});


test('a complete target pattern deduplicates roles and Work while full credits separate same-named third creators', () => {
  const a = ['C00001', 'lyrics'], ac = ['C00001', 'composition'];
  const b = ['C00002', 'arrangement'], bc = ['C00002', 'composition'];
  const third = ['C00003', 'english_lyrics'], other = ['C00004', 'english_lyrics'];
  const works = [work('W1', song('S1', a, ac, b, bc, third), song('S2', third, b, b, a, bc, ac),
    song('S3', a, ac, b, bc, other), song('S4', a, third))];
  const pair = collaborationIndex(works).pairs.get(pairKey(a[0], b[0]));
  const [item] = collaborationRecordings(works, pair.works);
  const result = roleBreakdown([item], [a[0], b[0]]);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 1);
  assert.equal(result[0].credits.length, 4);
  assert.deepEqual(result[0].songIds, ['S1', 'S2', 'S3']);
  assert.equal(item.totalSongs, 4);
  assert.deepEqual(groupRecordings(item.songs).map(group => group.songs.map(song => song.song_id)), [['S1', 'S2'], ['S3']]);
});

test('self patterns include all of the target’s roles and no duplicates', () => {
  const target = 'C00001';
  const item = work('W1', song('S1', [target, 'lyrics'], [target, 'composition'], [target, 'arrangement'],
    [target, 'lyrics'], ['C00002', 'english_lyrics']));
  const [pattern] = roleBreakdown([item], [target, target]);
  assert.deepEqual(pattern.credits.map(credit => credit.role), ['lyrics', 'composition', 'arrangement']);
});

test('published examples match the complete role patterns and expected totals', async () => {
  const { works } = JSON.parse(await readFile(new URL('../site/data/songs/G00001.json', import.meta.url)));
  const { pairs } = collaborationIndex(works);
  const check = (a, b, total, expected) => {
    const result = pairs.get(pairKey(a, b));
    assert.equal(result.work_count, total);
    const patterns = roleBreakdown(collaborationRecordings(works, result.works), [a, b]);
    assert.deepEqual(patterns.map(row => [row.credits.map(credit => [credit.role, credit.creator_id]), row.count]), expected);
  };
  const tsunku = [['lyrics', 'C00028'], ['composition', 'C00028']];
  check('C00028', 'C00035', 4, [
    [[...tsunku, ['arrangement', 'C00035']], 1],
    [[...tsunku, ['brass_arrangement', 'C00035']], 3]
  ]);
  check('C00009', 'C00028', 12, [[[...tsunku, ['arrangement', 'C00009']], 12]]);
  check('C00001', 'C00002', 2, [[[['lyrics', 'C00001'], ['composition', 'C00002'], ['arrangement', 'C00002']], 2]]);
});

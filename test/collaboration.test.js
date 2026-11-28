import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { allCollaborations, analyzeCollaborators, breakdown, collaborationIndex, pairKey, selfCollaboration } from '../site/collaborators.js';
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
  assert.deepEqual(row.works[0].patterns.get('lyrics:composition'), ['S1', 'S2']);
  assert(!row.works[2].patterns.has('lyrics:composition'));
  assert.deepEqual(breakdown(row.works), [
    ['lyrics:composition', 1], ['composition:lyrics', 1], ['lyrics:arrangement', 1],
    ['composition:arrangement', 1], ['lyrics:lyrics', 1], ['composition:composition', 1],
    ['arrangement:arrangement', 1], ['composition:english_lyrics', 1]
  ]);
  assert(breakdown(row.works).reduce((sum, [, count]) => sum + count, 0) > row.work_count);
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
    assert.deepEqual(breakdown(works), [['lyrics:composition', row.work_count]]);
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

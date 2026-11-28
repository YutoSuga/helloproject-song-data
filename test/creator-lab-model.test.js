import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rankVisiblePairs } from '../site/pair-analysis.js';
import { analyzeCollaborators } from '../site/collaborators.js';
import { detailRequestError, isWorkId, resolveArtist, legacyDestination, readState, safeFrom } from '../site/site-state.js';

test('published pairs are identical when enabled, and shared display rankings retain ties after exclusion', async () => {
  const data = JSON.parse(await readFile(new URL('../site/data/rankings/G00001.json', import.meta.url)));
  const entries = data.lyrics_composition_pairs.entries;
  assert.deepEqual(rankVisiblePairs(entries, { include_self: '1' }), entries);
  const ranked = rankVisiblePairs(entries);
  assert(ranked.every(row => row.lyricist_creator_id !== row.composer_creator_id));
  const fixture = [
    ['A', 'A', 10], ['A', 'B', 7], ['B', 'A', 6], ['C', 'A', 5], ['D', 'A', 5]
  ].map(([lyricist_creator_id, composer_creator_id, work_count]) => ({
    lyricist_creator_id, composer_creator_id, work_count, lyricist_name: '同名', composer_name: '同名'
  }));
  assert.deepEqual(rankVisiblePairs(fixture).map(row => row.rank), [1, 2, 3, 3]);
  assert.equal(rankVisiblePairs(fixture, { creator_id: 'A' }).length, 4);
  assert.equal(rankVisiblePairs(fixture, { creator_id: 'A', lyrics: '1' }).length, 1);
  assert.equal(rankVisiblePairs(fixture, { creator_id: 'A', composition: '1' }).length, 3);
  assert.equal(rankVisiblePairs(fixture, { creator_id: 'A', lyrics: '1', composition: '1' }).length, 0);
  assert.equal(rankVisiblePairs(fixture, { creator_id: 'A', lyrics: '1', composition: '1', include_self: '1' }).length, 1);
});

test('collaboration respects the same Song, all roles, Work distinctness and missing dates', () => {
  const credit = (creator_id, role) => ({ creator_id, creator_name: creator_id, role });
  const song = (song_id, ...credits) => ({ song_id, credits });
  const work = (work_id, first_release_date, ...songs) => ({ work_id, title: work_id, first_release_date, songs });
  const a = credit('A', 'brass_arrangement');
  const b = credit('B', 'brass_arrangement');
  const result = analyzeCollaborators([
    work('W2', null, song('S1', a, b, credit('B', 'lyrics')), song('S2', a, b), song('S3', credit('C', 'lyrics'))),
    work('W1', '2025-01-01', song('S4', a, b), song('S5')),
    work('W3', null, song('S6', a))
  ], 'A');
  assert.equal(result.assigned, 3);
  assert.deepEqual(result.entries.map(row => [row.creator_id, row.rank, row.work_count]), [['B', 1, 2]]);
  assert.deepEqual(result.entries[0].works.map(row => [row.work_id, row.song_ids]), [['W1', ['S4']], ['W2', ['S1', 'S2']]]);
});

test('artist resolution uses an explicit allowlist with URL, saved and default priority', () => {
  const artists = { G00001: 'Juice=Juice', G00002: 'fixture' };
  const resolve = (query, saved) => resolveArtist(new URLSearchParams(query), saved, artists);
  assert.deepEqual(resolve('artist_id=G00001', 'G00002'), { artist: 'G00001', invalid: false });
  assert.deepEqual(resolve('artist_id=G00003', 'G00002'), { artist: 'G00002', invalid: true });
  assert.deepEqual(resolve('artist_id=G00001&artist_id=G00001', 'G00002'), { artist: 'G00002', invalid: true });
  assert.deepEqual(resolve('', 'G00003'), { artist: 'G00001', invalid: false });
});

test('legacy paths, validated return URLs and the analysis flag use canonical query rules', () => {
  const origin = 'https://hellosongdb.com';
  assert.equal(legacyDestination('/creators/', new URLSearchParams('view=ranking&category=lyrics&artist_id=G00001')), '/ranking/?artist_id=G00001&category=lyrics');
  assert.equal(legacyDestination('/creators/', new URLSearchParams('view=pairs&include_self=1&creator_id=C00001')), '/analysis/?tab=pairs');
  assert.equal(legacyDestination('/songs/',  new URLSearchParams('q=juice&sort=old')), '/search/?tab=songs&q=juice&sort=old');
  assert.equal(safeFrom('/analysis/?tab=pairs&include_self=1&unknown=1', origin), '/analysis/?tab=pairs&include_self=1');
  assert.equal(safeFrom('/search/?tab=creators&from=%2F', origin), null);
  assert.equal(safeFrom('/songs/detail/?artist_id=G00001&work_id=W00001#song-M00001', origin),
    '/songs/detail/?artist_id=G00001&work_id=W00001#song-M00001');
  const error = query => detailRequestError(new URLSearchParams(query), 'work_id', isWorkId, '楽曲');
  assert.match(error('artist_id=G00001&work_id=invalid'), /URLを確認/);
  assert.match(error('artist_id=G00002&work_id=W00001'), /公開対象外/);
  assert.equal(error('artist_id=G00001&work_id=W00001'), '');
  for (const invalid of ['https://evil.test/', '//evil.test/', '/\\evil.test/', '/videos/', '/private/']) assert.equal(safeFrom(invalid, origin), null);
  assert.deepEqual(readState('/analysis/', new URLSearchParams('include_self=1&include_self=1')), { tab: 'pairs' });
  assert.deepEqual(readState('/analysis/', new URLSearchParams('include_self=1&tab=creator')), { tab: 'creator' });
});

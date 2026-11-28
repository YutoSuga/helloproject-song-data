import { readCreatorRankings } from './creator-catalog-model.js';
import { readSongCatalog } from './song-catalog-model.js';
import { isPublished } from './site-state.js';

export const loadError = 'データを表示できません。時間をおいて再読み込みしてください。';
export const emptyData = '表示できるデータがありません。';
export const loading = 'データを読み込んでいます。';
const cache = new Map();
const readers = { rankings: readCreatorRankings, songs: readSongCatalog };

export function loadData(kind, artist) {
  if (!isPublished(artist) || !Object.hasOwn(readers, kind)) throw new Error('Unknown data source');
  const key = `${kind}/${artist}.json`;
  if (!cache.has(key)) {
    const pending = fetch(new URL(`./data/${key}`, import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => readers[kind](data, artist))
      .catch(error => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export function readPairs(data) {
  const entries = data.lyrics_composition_pairs?.entries;
  if (!Array.isArray(entries) || entries.some(row =>
    !row || !Number.isInteger(row.rank) || !Number.isInteger(row.work_count) ||
    row.work_count < 1 || !['lyricist', 'composer'].every(role =>
      /^C\d{5}$/.test(row[`${role}_creator_id`] ?? '') && typeof row[`${role}_name`] === 'string') ||
    !Array.isArray(row.works) || row.works.length !== row.work_count || row.works.some(work =>
      !work || !/^W\d{5}$/.test(work.work_id ?? '') || typeof work.title !== 'string' ||
      !Array.isArray(work.song_ids) || !work.song_ids.length || work.song_ids.some(id => !/^J\d{5}$/.test(id))
    ))) throw new Error('Invalid pair evidence');
  return entries;
}

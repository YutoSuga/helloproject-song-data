import { compareWorkDates } from './song-catalog-model.js';

const cache = new WeakMap();
const compare = (a, b) => a.localeCompare(b, 'en');
export const pairKey = (a, b) => [a, b].sort(compare).join(':');

export function collaborationIndex(works) {
  if (cache.has(works)) return cache.get(works);
  const creators = new Map();
  const assigned = new Map();
  const pairs = new Map();
  for (const work of works) {
    for (const song of work.songs) {
      const credits = new Set();
      for (const credit of song.credits) {
        const { creator_id: id, creator_name: name } = credit;
        creators.set(id, name);
        if (!assigned.has(id)) assigned.set(id, new Set());
        assigned.get(id).add(work.work_id);
        credits.add(id);
      }
      const ids = [...credits].sort(compare);
      for (const [i, first] of ids.entries()) for (const second of ids.slice(i + 1)) {
        const key = pairKey(first, second);
        if (!pairs.has(key)) pairs.set(key, { first, second, works: new Map() });
        const evidence = pairs.get(key).works;
        if (!evidence.has(work.work_id)) evidence.set(work.work_id, {
          work_id: work.work_id, title: work.title, first_release_date: work.first_release_date,
          song_ids: []
        });
        const row = evidence.get(work.work_id);
        row.song_ids.push(song.song_id);

      }
    }
  }
  for (const pair of pairs.values()) {
    pair.works = [...pair.works.values()].sort(compareWorkDates);
    pair.work_count = pair.works.length;
  }
  const index = { creators, assigned, pairs };
  cache.set(works, index);
  return index;
}

function rank(rows, tie) {
  rows.sort((a, b) => b.work_count - a.work_count || tie(a, b));
  let rank;
  return rows.map((row, i) => {
    if (row.work_count !== rows[i - 1]?.work_count) rank = i + 1;
    return { ...row, rank };
  });
}

export function allCollaborations(works) {
  const { creators, pairs } = collaborationIndex(works);
  return rank([...pairs.values()].map(pair => ({
    ...pair, first_name: creators.get(pair.first), second_name: creators.get(pair.second)
  })), (a, b) => compare(a.first, b.first) || compare(a.second, b.second));
}

export function analyzeCollaborators(works, targetId) {
  const { creators, assigned, pairs } = collaborationIndex(works);
  const rows = [];
  for (const pair of pairs.values()) {
    if (pair.first !== targetId && pair.second !== targetId) continue;
    const creator_id = pair.first === targetId ? pair.second : pair.first;
    rows.push({ creator_id, creator_name: creators.get(creator_id), work_count: pair.work_count, works: pair.works });
  }
  return { assigned: assigned.get(targetId)?.size ?? 0, entries: rank(rows, (a, b) => compare(a.creator_id, b.creator_id)) };
}

export function selfCollaboration(entries, works, id) {
  const pair = entries.find(row => row.lyricist_creator_id === id && row.composer_creator_id === id);
  const dates = new Map(works.map(work => [work.work_id, work.first_release_date]));
  return (pair?.works ?? []).map(work => ({
    ...work, first_release_date: dates.get(work.work_id) ?? null
  })).sort(compareWorkDates);
}

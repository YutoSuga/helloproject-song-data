import { compareWorkDates } from './song-catalog-model.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';

const cache = new WeakMap();
const roles = Object.keys(ALL_ROLE_LABELS);
const compare = (a, b) => a.localeCompare(b, 'en');
export const pairKey = (a, b) => [a, b].sort(compare).join(':');

export function collaborationIndex(works) {
  if (cache.has(works)) return cache.get(works);
  const creators = new Map();
  const assigned = new Map();
  const pairs = new Map();
  for (const work of works) {
    for (const song of work.songs) {
      const credits = new Map();
      for (const credit of song.credits) {
        const { creator_id: id, creator_name: name, role } = credit;
        creators.set(id, name);
        if (!assigned.has(id)) assigned.set(id, new Set());
        assigned.get(id).add(work.work_id);
        if (!credits.has(id)) credits.set(id, new Set());
        credits.get(id).add(role);
      }
      const ids = [...credits.keys()].sort(compare);
      for (const [i, first] of ids.entries()) for (const second of ids.slice(i + 1)) {
        const key = pairKey(first, second);
        if (!pairs.has(key)) pairs.set(key, { first, second, works: new Map() });
        const evidence = pairs.get(key).works;
        if (!evidence.has(work.work_id)) evidence.set(work.work_id, {
          work_id: work.work_id, title: work.title, first_release_date: work.first_release_date,
          song_ids: [], patterns: new Map()
        });
        const row = evidence.get(work.work_id);
        row.song_ids.push(song.song_id);
        for (const a of credits.get(first)) for (const b of credits.get(second)) {
          const pattern = a + ':' + b;
          if (!row.patterns.has(pattern)) row.patterns.set(pattern, []);
          row.patterns.get(pattern).push(song.song_id);
        }
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

export function breakdown(works) {
  const counts = new Map();
  for (const work of works) for (const pattern of work.patterns.keys()) {
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  function order(pattern) {
    const [a, b] = pattern.split(':').map(role => roles.indexOf(role));
    const low = Math.min(a, b), high = Math.max(a, b);
    // Cross-role combinations precede ordinary same-role combinations.
    const group = high > 2 ? 6 : low === high ? 3 + low : low + high - 1;
    return [group, low, high, a, b];
  }
  return [...counts].sort(([a], [b]) => {
    const left = order(a), right = order(b);
    return left.reduceRight((result, value, i) => value - right[i] || result, 0);
  });
}

export function selfCollaboration(entries, works, id) {
  const pair = entries.find(row => row.lyricist_creator_id === id && row.composer_creator_id === id);
  const dates = new Map(works.map(work => [work.work_id, work.first_release_date]));
  return (pair?.works ?? []).map(work => ({
    ...work, first_release_date: dates.get(work.work_id) ?? null,
    patterns: new Map([['lyrics:composition', work.song_ids]])
  })).sort(compareWorkDates);
}

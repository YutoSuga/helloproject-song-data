import { selectSongs } from './song-catalog-model.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';

const roles = Object.keys(ALL_ROLE_LABELS);
const compareId = (a, b) => a.creator_id.localeCompare(b.creator_id, 'en');
const compareCredit = (a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || compareId(a, b);
const creditId = credit => credit.role + ':' + credit.creator_id;
const normalize = credits => [...new Map(credits.map(credit => [creditId(credit), credit])).values()].sort(compareCredit);
const keyOf = credits => credits.map(creditId).join('|');

export function collaborationRecordings(catalog, evidence) {
  const works = new Map(catalog.map(work => [work.work_id, work]));
  return evidence.map(work => {
    const published = works.get(work.work_id);
    const ids = new Set(work.song_ids);
    const songs = selectSongs(published.songs.filter(song => ids.has(song.song_id)));
    if (songs.length !== ids.size) throw new Error('Missing collaboration recording');
    return { ...work, songs, totalSongs: published.songs.length };
  });
}

export function roleBreakdown(recordings, creatorIds) {
  const targets = new Set(creatorIds);
  const patterns = new Map();
  for (const work of recordings) for (const song of work.songs) {
    const credits = normalize(song.credits.filter(credit => targets.has(credit.creator_id)));
    const key = keyOf(credits);
    if (!patterns.has(key)) patterns.set(key, { credits, workIds: new Set(), songIds: [] });
    const pattern = patterns.get(key);
    pattern.workIds.add(work.work_id);
    pattern.songIds.push(song.song_id);
  }
  return [...patterns.values()].sort(({ credits: a }, { credits: b }) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const order = compareCredit(a[i], b[i]);
      if (order) return order;
    }
    return a.length - b.length;
  }).map(({ credits, workIds, songIds }) => ({ credits, count: workIds.size, songIds }));
}

export function groupRecordings(songs) {
  const groups = new Map();
  for (const song of songs) {
    const credits = normalize(song.credits);
    const key = keyOf(credits);
    if (!groups.has(key)) groups.set(key, { credits, songs: [] });
    groups.get(key).songs.push(song);
  }
  return [...groups.values()];
}

export function creditsInRole(credits, role) {
  return credits.filter(credit => credit.role === role)
    .sort((a, b) => (a.credit_order ?? Infinity) - (b.credit_order ?? Infinity) || compareId(a, b));
}

export function creditName(credit) {
  return credit.credit_name === credit.creator_name ? credit.credit_name : `${credit.credit_name}（${credit.creator_name}）`;
}

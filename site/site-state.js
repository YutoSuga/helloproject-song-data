import { categoryIds, publishedArtistId } from './creator-catalog-model.js';

export const publishedArtists = { [publishedArtistId]: 'Juice=Juice' };
const artistKey = 'creator-lab.artist';
const fieldsByPath = {
  '/': ['artist_id'],
  '/ranking/': ['artist_id', 'category'],
  '/search/': ['artist_id', 'tab', 'q', 'sort'],
  '/analysis/': ['artist_id', 'tab', 'creator_id', 'lyrics', 'composition', 'include_self', 'lyricist_id', 'composer_id', 'partner_id'],
  '/more/': ['artist_id'],
  '/creators/detail/': ['artist_id', 'creator_id', 'role'],
  '/songs/detail/': ['artist_id', 'work_id']
};
const creatorFields = ['creator_id', 'lyricist_id', 'composer_id', 'partner_id'];
export const pathOf = url => url.pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
export const single = (params, key) => params.getAll(key).length === 1 ? params.get(key) : null;
export const isCreatorId = id => /^C\d{5}$/.test(id ?? '');
export const isSongId = id => /^[MAJTBORH]\d{5}$/.test(id ?? '');
export const isWorkId = id => /^W\d{5}$/.test(id ?? '');
export const isPublished = (id, artists = publishedArtists) => Object.hasOwn(artists, id);
export const cleanSearch = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function resolveArtist(params, saved, artists = publishedArtists) {
  const requested = single(params, 'artist_id');
  const valid = isPublished(requested, artists);
  return {
    artist: valid ? requested : isPublished(saved, artists) ? saved : publishedArtistId,
    invalid: params.has('artist_id') && !valid
  };
}

export function readState(path, params) {
  const state = {};
  for (const key of fieldsByPath[path] ?? []) {
    const value = single(params, key);
    if (value !== null) state[key] = value;
  }
  if (!isPublished(state.artist_id)) delete state.artist_id;
  if (path === '/ranking/') state.category = cleanSearch(state.category, categoryIds, 'all');
  if (path === '/search/') {
    state.tab = cleanSearch(state.tab, ['songs', 'creators'], 'songs');
    if (state.tab === 'songs') state.sort = cleanSearch(state.sort, ['new', 'old', 'title'], 'new');
    else delete state.sort;
  }
  if (path === '/analysis/') {
    state.tab = cleanSearch(state.tab, ['pairs', 'creator'], 'pairs');
    const excluded = state.tab === 'pairs' ? ['partner_id'] : ['lyrics', 'composition', 'include_self', 'lyricist_id', 'composer_id'];
    for (const key of excluded) delete state[key];
    for (const key of ['lyrics', 'composition', 'include_self']) if (state[key] !== '1') delete state[key];
  }
  if (path === '/creators/detail/') state.role = cleanSearch(state.role, ['all', 'lyrics', 'composition', 'arrangement', 'other'], 'all');
  for (const key of creatorFields) if (!isCreatorId(state[key])) delete state[key];
  if (!isWorkId(state.work_id)) delete state.work_id;
  return state;
}

export function pageUrl(path, values = {}, hash = '') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return path + (params.size ? `?${params}` : '') + hash;
}

export function legacyDestination(path, params) {
  const fromSongs = path === '/songs/';
  const view = single(params, 'view');
  const target = fromSongs || !['ranking', 'pairs'].includes(view) ? '/search/' : view === 'ranking' ? '/ranking/' : '/analysis/';
  const values = new URLSearchParams(params);
  if (target === '/search/') values.set('tab', fromSongs ? 'songs' : 'creators');
  if (target === '/analysis/') values.set('tab', 'pairs');
  return pageUrl(target, readState(target, values));
}

export function safeFrom(value, origin) {
  if (!value?.startsWith('/') || /^[/][\/\\]/.test(value)) return null;
  const url = new URL(value, origin);
  const path = pathOf(url);
  if (url.origin !== origin || !Object.hasOwn(fieldsByPath, path) || url.searchParams.has('from')) return null;
  const state = readState(path, url.searchParams);
  if (path === '/songs/detail/' && (!state.artist_id || !state.work_id)) return null;
  if (path === '/creators/detail/' && (!state.artist_id || !state.creator_id)) return null;
  const hash = path === '/songs/detail/' && url.hash.startsWith('#song-') && isSongId(url.hash.slice(6)) ? url.hash
    : path === '/more/' && /^#(about|data-policy|artist-coverage|aggregation-method|site-updates|disclaimer|contact)$/.test(url.hash) ? url.hash : '';
  return pageUrl(path, state, hash);
}

export function readSavedArtist() {
  try { return localStorage.getItem(artistKey); } catch { return null; }
}

export function saveArtist(artist) {
  try { localStorage.setItem(artistKey, artist); } catch { /* URL stays authoritative. */ }
}

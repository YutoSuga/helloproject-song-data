import { isPublished, legacyDestination, pageUrl, pathOf, readSavedArtist, readState, resolveArtist, safeFrom, saveArtist, single } from './site-state.js';

export const $ = id => document.getElementById(id);
export const path = pathOf(location);
const relative = () => location.pathname + location.search + location.hash;
const pendingKey = 'creator-lab.detail-navigation';
const storage = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* History state remains available. */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } }
};

export function element(type, text, className) {
  const node = document.createElement(type);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function link(text, href, className) {
  const node = element('a', text, className);
  node.href = href;
  return node;
}

export function status(node, message) {
  node.textContent = message;
  node.hidden = !message;
}

export function state() {
  return readState(path, new URLSearchParams(location.search));
}

function entryId() {
  return history.state?.entryId ?? crypto.randomUUID();
}

function remember(focus = document.activeElement?.dataset.restore) {
  const snapshot = { ...history.state, entryId: entryId(), x: scrollX, y: scrollY, focus };
  history.replaceState(snapshot, '');
  return snapshot;
}

export function restorePosition() {
  const saved = history.state;
  if (saved?.focus) document.querySelector(`[data-restore="${CSS.escape(saved.focus)}"]`)?.focus({ preventScroll: true });
  if (location.hash) {
    $(location.hash.slice(1))?.scrollIntoView();
  } else if (saved?.y != null) {
    scrollTo(saved.x, saved.y);
  }
}

export function update(patch, { replace = false, keepPosition = false } = {}) {
  const old = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') old.delete(key);
    else old.set(key, value);
  }
  const next = readState(path, old);
  if (old.has('from') && path.endsWith('/detail/')) {
    const from = safeFrom(single(old, 'from'), location.origin);
    if (from) next.from = from;
    else if (!patch.from) for (const key of ['view', 'category', 'q']) {
      const value = single(old, key);
      if (value) next[key] = value;
    }
  } else if (path === '/creators/detail/') {
    for (const key of ['view', 'category', 'q']) {
      const value = single(old, key);
      if (value) next[key] = value;
    }
  }
  const target = pageUrl(path, next, location.hash);
  if (target === relative()) return;
  const current = remember();
  if (replace) history.replaceState(current, '', target);
  else history.pushState(keepPosition ? { ...current, entryId: crypto.randomUUID() } : { entryId: crypto.randomUUID() }, '', target);
}

export function refreshLinks(artist) {
  document.querySelectorAll('[data-nav], [data-home], [data-artist-link]').forEach(node => {
    const url = new URL(node.href);
    if (artist) url.searchParams.set('artist_id', artist);
    else url.searchParams.delete('artist_id');
    node.href = url;
  });
}

export function setupArtist(onChange) {
  const picker = $('artist-select');
  const requested = resolveArtist(new URLSearchParams(location.search), readSavedArtist());
  status($('artist-notice'), requested.invalid ? '指定のアーティストは表示できません。公開中のアーティストを表示しています。' : '');
  update({ artist_id: requested.artist }, { replace: true });
  function sync() {
    const artist = state().artist_id ?? requested.artist;
    picker.value = artist;
    saveArtist(artist);
    refreshLinks(artist);
  }
  sync();
  picker.addEventListener('change', () => {
    if (!isPublished(picker.value)) return;
    update({ artist_id: picker.value, creator_id: null, lyricist_id: null, composer_id: null, partner_id: null, lyrics: null, composition: null });
    status($('artist-notice'), '');
    sync();
    scrollTo(0, 0);
    onChange();
  });
  window.addEventListener('popstate', () => {
    status($('artist-notice'), '');
    sync();
    onChange(true);
  });
}

export function tabs(tablist, value, select) {
  const buttons = [...tablist.querySelectorAll('[role=tab]')];
  function sync(selected) {
    for (const tab of buttons) {
      const active = tab.dataset.value === selected;
      tab.setAttribute('aria-selected', active);
      tab.tabIndex = active ? 0 : -1;
      if (active) $(tab.getAttribute('aria-controls')).setAttribute('aria-labelledby', tab.id);
    }
  }
  sync(value);
  buttons.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.value));
    tab.addEventListener('keydown', event => {
      const next = { Home: 0, End: buttons.length - 1, ArrowLeft: (index + buttons.length - 1) % buttons.length, ArrowRight: (index + 1) % buttons.length }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  });
  return sync;
}

export function detailLink(type, id, text, artist, song) {
  const target = type === 'creator' ? '/creators/detail/' : '/songs/detail/';
  const key = type === 'creator' ? 'creator_id' : 'work_id';
  const from = safeFrom(relative(), location.origin);
  const anchor = link(text, pageUrl(target, { artist_id: artist, [key]: id, from }, song ? `#song-${song}` : ''));
  anchor.dataset.detail = '';
  anchor.dataset.restore = `${type}-${id}${song ? '-' + song : ''}`;
  return anchor;
}

export function setupDetail(back, tab) {
  const params = new URLSearchParams(location.search);
  const current = state();
  const requested = single(params, 'from');
  const legacy = tab === 'creators' && !params.has('from') && params.has('view');
  const fallback = pageUrl('/search/', { artist_id: current.artist_id, tab });
  const from = safeFrom(requested, location.origin);
  back.href = from ?? (legacy ? legacyDestination('/creators/', params) : fallback);
  if (from || legacy) back.textContent = '‹ 前の画面へ戻る';
  let pending;
  try { pending = JSON.parse(storage.get(pendingKey)); } catch { /* Ignore invalid saved state. */ }
  storage.remove(pendingKey);
  if (pending?.target === relative() && pending.from === from && document.referrer &&
      safeFrom(document.referrer.startsWith(location.origin + '/') ? document.referrer.slice(location.origin.length) : '', location.origin) === from) {
    history.replaceState({ ...history.state, previous: from }, '');
  }
  back.addEventListener('click', event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && from && history.state?.previous === from) {
      event.preventDefault();
      history.back();
    }
  });
  refreshLinks(current.artist_id);
  return current;
}

if (typeof document !== 'undefined') {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('pagehide', () => remember());
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[data-detail]');
    if (!anchor) return;
    remember(anchor.dataset.restore);
    const url = new URL(anchor.href);
    storage.set(pendingKey, JSON.stringify({ target: url.pathname + url.search + url.hash, from: safeFrom(relative(), location.origin) }));
  });
  if (path === '/more/' || path === '/videos/') {
    refreshLinks(resolveArtist(new URLSearchParams(location.search), readSavedArtist()).artist);
    window.addEventListener('load', restorePosition);
  }
}

import { $, detailLink, element, path, restorePosition, setupArtist, state, status, tabs, update } from './common.js';
import { findCreators } from './creator-catalog-model.js';
import { selectWorks } from './song-catalog-model.js';
import { emptyData, loadData, loadError, loading, readPairs } from './public-data.js';
import { rankVisiblePairs } from './pair-analysis.js';
import { pairName, rankRow, topThree } from './ranking-view.js';

const message = $('data-status');
const summary = $('summary');
const query = $('query');
const sort = $('song-sort');
const retry = $('search-retry');
const isHome = path === '/';
const isSearch = path === '/search/';
const list = $('ranking') ?? $('results');
let request = 0;

function populate(list, rows, render) {
  list.replaceChildren(...(rows.length ? rows.map(render) : [element('li', emptyData)]));
}

function renderHome(data, artist) {
  const all = data.categories.all.entries;
  const { target_work_count, primary_song_count } = data.summary ?? {};
  if (![target_work_count, primary_song_count].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid totals');
  summary.replaceChildren(...[['作品数', target_work_count], ['音源数', primary_song_count], ['作家数', all.length]].map(([label, value]) => {
    const cell = element('div');
    cell.append(element('dt', label), element('dd', value.toLocaleString('ja-JP')));
    return cell;
  }));
  populate($('top-creators'), topThree(all), row =>
    rankRow(row, detailLink('creator', row.creator_id, row.creator_name, artist), all[0].work_count));
  try {
    const pairs = rankVisiblePairs(readPairs(data));
    populate($('top-pairs'), topThree(pairs), row => rankRow(row, pairName(row, artist), pairs[0].work_count));
  } catch {
    $('top-pairs').replaceChildren(element('li', loadError));
  }
  $('dashboard').hidden = false;
}

function renderRanking(data, { artist_id, category }) {
  const rows = data.categories[category].entries;
  summary.textContent = rows.length ? `${rows.length}作家 / 延べ${rows.reduce((total, row) => total + row.work_count, 0)}曲（作家ごとの曲数の合計）` : '';
  list.replaceChildren(...rows.map(row => rankRow(row, detailLink('creator', row.creator_id, row.creator_name, artist_id))));
  return rows.length ? '' : emptyData;
}

function renderSearch(data, { artist_id, tab, q, sort }) {
  const songs = tab === 'songs';
  const source = songs ? data.works : data.categories.all.entries;
  const rows = songs ? selectWorks(source, q, sort) : findCreators(source, q ?? '');
  summary.textContent = `${rows.length}${songs ? '作品' : '作家'}`;
  list.replaceChildren(...rows.map(row => {
    const item = element('li');
    if (songs) {
      item.append(detailLink('work', row.work_id, row.title, artist_id),
        element('small', `音源初出日：${row.first_release_date ?? '確認中'}`));
    } else item.append(detailLink('creator', row.creator_id, row.creator_name, artist_id));
    return item;
  }));
  return !source.length ? emptyData : !rows.length ? '検索結果は0件です。' : '';
}

const tablist = document.querySelector('[role=tablist]');
const syncTabs = tablist && tabs(tablist, state().tab ?? state().category, value => {
  const current = state();
  if (isSearch) {
    if (value === current.tab) return;
    // The URL owns the active tab. Inactive values belong only to this history entry.
    const cachedTabs = { ...history.state?.searchTabs, [current.tab]: { q: current.q, sort: current.sort } };
    update({ tab: value, q: cachedTabs[value]?.q, sort: cachedTabs[value]?.sort });
    history.replaceState({ ...history.state, searchTabs: cachedTabs }, '');
  } else update({ category: value });
  render();
});

async function render(restore = false, live = false) {
  const token = ++request;
  const current = state();
  const songs = isSearch && current.tab === 'songs';
  syncTabs?.(current.tab ?? current.category);
  if (isSearch) {
    retry.hidden = true;
    if (!live) query.value = current.q ?? '';
    $('query-label').textContent = songs ? '曲名・作家名' : '作家名';
    $('sort-field').hidden = !songs;
    sort.value = current.sort ?? 'new';
    if (!live) query.disabled = sort.disabled = true;
  }
  if (!live) {
    if (isHome) $('dashboard').hidden = true;
    else {
      list.replaceChildren();
      summary.textContent = '';
    }
    status(message, loading);
  }
  try {
    const data = await loadData(songs ? 'songs' : 'rankings', current.artist_id);
    if (token !== request) return;
    let text;
    if (isHome) renderHome(data, current.artist_id);
    else if (isSearch) {
      query.disabled = sort.disabled = false;
      text = renderSearch(data, current);
    } else text = renderRanking(data, current);
    status(message, text);
  } catch {
    if (token !== request) return;
    status(message, loadError);
    if (retry) retry.hidden = false;
  }
  if (restore) restorePosition();
}

setupArtist(render);
retry?.addEventListener('click', async () => {
  const previous = location.href;
  await render();
  if (location.href === previous && document.activeElement === document.body) {
    (retry.hidden ? query : retry).focus();
  }
});
query?.addEventListener('input', () => {
  update({ q: query.value }, { replace: true });
  render(false, true);
});
sort?.addEventListener('change', () => {
  update({ sort: sort.value }, { keepPosition: true });
  render(false, true);
});
render(true);

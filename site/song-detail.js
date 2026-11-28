import { detailRequestError, isWorkId } from './site-state.js';
import { $, detailLink, element, restorePosition, setupDetail, status } from './common.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';
import { loadData, loadError } from './public-data.js';
import { selectSongs } from './song-catalog-model.js';

const versions = { original: 'オリジナル', new_vocal: '新歌唱', re_recording: '再録', cover: 'カバー', other: 'その他' };
const current = setupDetail($('detail-back'), 'songs');
const message = $('data-status');

function creditsFor(song) {
  const list = element('dl', null, 'credit-list');
  for (const [role, label] of Object.entries(ALL_ROLE_LABELS)) {
    const credits = song.credits.filter(credit => credit.role === role)
      .sort((a, b) => (a.credit_order ?? Infinity) - (b.credit_order ?? Infinity) || a.creator_id.localeCompare(b.creator_id, 'en'));
    if (!credits.length && !['lyrics', 'composition', 'arrangement'].includes(role)) continue;
    const item = element('dd', credits.length ? null : '未確認');
    for (const credit of credits) {
      const text = credit.credit_name === credit.creator_name ? credit.credit_name : `${credit.credit_name}（${credit.creator_name}）`;
      const anchor = detailLink('creator', credit.creator_id, text, current.artist_id);
      anchor.dataset.restore += `-${song.song_id}-${role}`;
      item.append(anchor);
    }
    list.append(element('dt', label), item);
  }
  return list;
}

function render(work, artist) {
  const content = $('work-content');
  const creators = new Set(work.songs.flatMap(song => song.credits.map(credit => credit.creator_id)));
  $('work-title').textContent = work.title;
  document.title = `${work.title} | ハロプロ作家研究所`;
  const date = work.first_release_date ?? '確認中';
  const partial = work.date_incomplete && work.first_release_date ? '（一部音源の日付は未確認）' : '';
  content.append(element('p', artist), element('p', `音源初出日：${date}${partial} · ${work.songs.length}音源 · ${creators.size}作家`));
  const multiple = work.songs.length > 1;
  if (multiple) content.append(element('h2', '音源・バージョン'));
  for (const song of selectSongs(work.songs)) {
    const section = element('section', null, multiple ? 'recording' : undefined);
    section.id = `song-${song.song_id}`;
    if (multiple || song.title !== work.title) section.append(element(multiple ? 'h3' : 'h2', song.title));
    const version = [song.version_name, versions[song.version_type]].filter(Boolean).join(' · ');
    section.append(element('p', `${version} · 発売日：${song.release_date ?? '確認中'}`));
    if (!multiple) section.append(element('h2', '担当作家'));
    section.append(creditsFor(song));
    content.append(section);
  }
  content.hidden = false;
  status(message, '');
  restorePosition();
}

const requestError = detailRequestError(new URLSearchParams(location.search), 'work_id', isWorkId, '楽曲');
if (requestError) {
  status(message, requestError);
} else {
  try {
    const data = await loadData('songs', current.artist_id);
    const work = data.works.find(row => row.work_id === current.work_id);
    if (work) render(work, data.artist.name);
    else status(message, '指定された楽曲が見つかりません。');
  } catch {
    status(message, loadError);
  }
}

import { $, detailLink, element, restorePosition, setupArtist, state, status, tabs, trackHistoryPosition, update } from './common.js';
import { analyzeCollaborators, catalogCreators } from './collaborators.js';
import { mountCreatorPicker } from './creator-picker.js';
import { rankVisiblePairs } from './pair-analysis.js';
import { pairName, rankRow } from './ranking-view.js';
import { emptyData, loadData, loadError, loading, readPairs } from './public-data.js';

const dialog = $('evidence');
const results = $('results');
const summary = $('summary');
const message = $('data-status');
const flags = { lyrics: $('pair-lyrics'), composition: $('pair-composition'), include_self: $('include-self') };
const evidenceKeys = { lyricist_id: null, composer_id: null, partner_id: null };
let request = 0;
let opener;
let activeEvidence;
let openingEvidence = false;

function change(patch, keepPosition = true) {
  update(patch, { keepPosition });
  render(keepPosition);
}

const syncTabs = tabs(document.querySelector('[role=tablist]'), state().tab, tab => {
  if (tab === state().tab) return;
  change({ tab, creator_id: null, lyrics: null, composition: null, include_self: null, ...evidenceKeys }, false);
});

const syncPicker = mountCreatorPicker(creator_id => change({
  creator_id, ...(!creator_id && { lyrics: null, composition: null }), ...evidenceKeys
}));
$('pair-clear').addEventListener('click', () => change({ creator_id: null, lyrics: null, composition: null, ...evidenceKeys }));
for (const [key, control] of Object.entries(flags)) {
  control.addEventListener('change', () => change({ [key]: control.checked ? '1' : null }));
}

function evidenceId(row) {
  return row.creator_id ?? `${row.lyricist_creator_id}-${row.composer_creator_id}`;
}

dialog.addEventListener('scroll', trackHistoryPosition, { passive: true });
dialog.addEventListener('focusin', () => {
  // Opening a restored dialog sets autofocus before its saved focus is applied.
  if (!openingEvidence) trackHistoryPosition();
});

function closeEvidence() {
  activeEvidence = undefined;
  if (dialog.open) dialog.close();
}

dialog.addEventListener('close', () => {
  if (dialog.open || !activeEvidence) return;
  activeEvidence = undefined;
  update(evidenceKeys, { replace: true });
  opener?.focus({ preventScroll: true });
});

function openEvidence(row, button, current) {
  opener = button;
  activeEvidence = evidenceId(row);
  const name = row.creator_name ?? `${row.lyricist_name} × ${row.composer_name}`;
  $('evidence-summary').textContent = `${name} · ${row.work_count}曲`;
  $('evidence-works').replaceChildren(...row.works.map(work => {
    const item = element('li');
    item.append(detailLink('work', work.work_id, work.title, current.artist_id));
    const songs = element('div', null, 'evidence-songs');
    for (const [index, id] of work.song_ids.entries()) {
      songs.append(detailLink('work', work.work_id, `根拠音源 ${index + 1}`, current.artist_id, id));
    }
    item.append(songs);
    return item;
  }));
  if (!dialog.open) {
    openingEvidence = true;
    dialog.showModal();
    openingEvidence = false;
  }
}

function showRows(rows, current, pairs) {
  const buttons = new Map();
  results.replaceChildren(...rows.map(row => {
    const button = element('button', '共同制作楽曲');
    const id = evidenceId(row);
    button.type = 'button';
    button.dataset.restore = 'evidence-' + id;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      const keys = pairs ? { lyricist_id: row.lyricist_creator_id, composer_id: row.composer_creator_id }
        : { partner_id: row.creator_id };
      update(keys, { keepPosition: true });
      openEvidence(row, button, state());
    });
    buttons.set(id, button);
    const name = pairs ? pairName(row, current.artist_id) : detailLink('creator', row.creator_id, row.creator_name, current.artist_id);
    return rankRow(row, name, pairs ? undefined : rows[0].work_count, button);
  }));
  const id = pairs ? `${current.lyricist_id}-${current.composer_id}` : current.partner_id;
  if (buttons.has(id)) openEvidence(rows.find(row => evidenceId(row) === id), buttons.get(id), current);
  else {
    const previous = activeEvidence;
    closeEvidence();
    if (previous) {
      const target = buttons.get(previous) ?? document.querySelector('[role="tab"][aria-selected="true"]');
      target?.focus({ preventScroll: true });
    }
    if (current.lyricist_id || current.composer_id || current.partner_id) update(evidenceKeys, { replace: true });
  }
}

function pairRows(entries, creators, current) {
  const selected = current.creator_id;
  const rows = rankVisiblePairs(entries, current);
  if (selected) {
    const roles = current.lyrics && current.composition ? '作詞・作曲の両方'
      : current.lyrics ? '作詞' : current.composition ? '作曲' : '作詞または作曲';
    $('pair-condition').textContent = `${creators.get(selected)}が${roles}を担当した組み合わせ`;
  } else $('pair-condition').textContent = current.include_self ? 'すべての作詞・作曲ペアを表示しています。' : '異なる作家の組み合わせを表示しています。';
  summary.textContent = `${rows.length}組 / 延べ${rows.reduce((count, row) => count + row.work_count, 0)}曲`;
  showRows(rows, current, true);
  const empty = !entries.length ? emptyData : '条件に一致する組み合わせがありません。';
  status(message, rows.length ? '' : current.lyrics && current.composition && !current.include_self
    ? `${empty}「同一作家の組み合わせを含む」を選択すると対象を表示できます。` : empty);
}

async function render(restore = false, originalParams) {
  const token = ++request;
  let current = state();
  const raw = originalParams ?? new URLSearchParams(location.search);
  const pairs = current.tab === 'pairs';
  syncTabs(current.tab);
  $('analysis-heading').textContent = pairs ? '作詞 × 作曲' : '共同制作の多い作家';
  $('picker-label').textContent = pairs ? '対象作家（任意）' : '分析対象作家';
  $('pair-filters').hidden = !pairs;
  $('collaboration-note').hidden = pairs;
  for (const [key, control] of Object.entries(flags)) control.checked = Boolean(current[key]);
  status($('analysis-notice'), '');
  const kind = pairs ? 'rankings' : 'songs';
  if (results.dataset.source !== `${kind}/${current.artist_id}`) {
    closeEvidence();
    results.replaceChildren();
    summary.textContent = $('pair-condition').textContent = '';
    status(message, loading);
    syncPicker(new Map());
  }
  try {
    const data = await loadData(kind, current.artist_id);
    if (token !== request) return;
    const pairEntries = pairs ? readPairs(data) : [];
    const creators = pairs ? new Map(pairEntries.flatMap(row => [
      [row.lyricist_creator_id, row.lyricist_name], [row.composer_creator_id, row.composer_name]
    ])) : catalogCreators(data.works);
    if (raw.has('creator_id') && !creators.has(current.creator_id)) {
      update({ creator_id: null, lyrics: null, composition: null, ...evidenceKeys }, { replace: true });
      current = state();
      status($('analysis-notice'), '指定の作家が見つかりません。');
    }
    if (!current.creator_id && (current.lyrics || current.composition)) {
      update({ lyrics: null, composition: null }, { replace: true });
      current = state();
    }
    flags.lyrics.disabled = flags.composition.disabled = !current.creator_id;
    flags.lyrics.checked = Boolean(current.lyrics);
    flags.composition.checked = Boolean(current.composition);
    syncPicker(creators, current.creator_id);
    if (pairs) pairRows(pairEntries, creators, current);
    else {
      $('pair-condition').textContent = '';
      const { assigned, entries } = analyzeCollaborators(data.works, current.creator_id);
      summary.textContent = current.creator_id ? `担当作品数：${assigned}作品 · 共同制作作家数：${entries.length}作家` : '';
      status(message, !creators.size ? emptyData : !current.creator_id ? '分析する作家を選択してください。'
        : !entries.length ? '共同制作相手が見つかりません。' : '');
      showRows(entries, current, false);
    }
    results.dataset.source = `${kind}/${current.artist_id}`;
  } catch {
    if (token !== request) return;
    status(message, loadError);
    closeEvidence();
    update(evidenceKeys, { replace: true });
    results.replaceChildren();
    summary.textContent = $('pair-condition').textContent = '';
    syncPicker(new Map());
  }
  if (restore) restorePosition();
}

const initialQuery = new URLSearchParams(location.search);
setupArtist(render);
render(true, initialQuery);

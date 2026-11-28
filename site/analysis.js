import { $, restorePosition, setupArtist, state, status, tabs, update } from './common.js';
import { allCollaborations, analyzeCollaborators, collaborationIndex } from './collaborators.js';
import { mountCreatorPicker } from './creator-picker.js';
import { rankVisiblePairs } from './pair-analysis.js';
import { collaborationLink, collaboratorRow, pairRow } from './ranking-view.js';
import { emptyData, loadData, loadError, loading, readPairs } from './public-data.js';

const results = $('results');
const summary = $('summary');
const message = $('data-status');
const flags = { lyrics: $('pair-lyrics'), composition: $('pair-composition'), include_self: $('include-self') };
const evidenceKeys = { lyricist_id: null, composer_id: null, partner_id: null };
let request = 0;

function change(patch, keepPosition = true) {
  update({ ...evidenceKeys, ...patch }, { keepPosition });
  render(keepPosition);
}

const syncTabs = tabs(document.querySelector('[role=tablist]'), state().tab, tab => {
  if (tab === state().tab) return;
  change({ tab, creator_id: null, lyrics: null, composition: null, include_self: null, mode: null }, false);
});
$('pair-mode').addEventListener('click', event => {
  const mode = event.target.closest('[data-mode]')?.dataset.mode;
  if (!mode || mode === (state().mode ?? 'all')) return;
  change({ mode });
});
const syncPicker = mountCreatorPicker(creator_id => change({
  creator_id, ...(!creator_id && { lyrics: null, composition: null })
}));
$('pair-clear').addEventListener('click', () => change({ creator_id: null, lyrics: null, composition: null }));
for (const [key, control] of Object.entries(flags)) {
  control.addEventListener('change', () => change({ [key]: control.checked ? '1' : null }));
}

async function render(restore = false, originalParams) {
  const token = ++request;
  let current = state();
  const raw = originalParams ?? new URLSearchParams(location.search);
  const pairs = current.tab === 'pairs';
  const directed = pairs && current.mode === 'lyrics_composition';
  syncTabs(current.tab);
  $('pair-mode').hidden = !pairs;
  for (const button of $('pair-mode').querySelectorAll('button')) button.setAttribute('aria-pressed', button.dataset.mode === (current.mode ?? 'all'));
  $('analysis-heading').textContent = directed ? '作詞 × 作曲' : pairs ? '全担当区分の組み合わせ' : '共同制作の多い作家';
  $('picker-label').textContent = pairs ? '対象作家（任意）' : '分析対象作家';
  $('pair-creator').closest('.creator-combobox').hidden = pairs && !directed;
  $('pair-filters').hidden = !directed;
  $('collaboration-note').hidden = directed;
  status($('analysis-notice'), '');
  const kind = directed ? 'rankings' : 'songs';
  const source = `${kind}/${current.artist_id}/${current.tab}`;
  if (results.dataset.source !== source) {
    results.replaceChildren();
    summary.textContent = $('pair-condition').textContent = '';
    status(message, loading);
    syncPicker(new Map());
  }
  try {
    const data = await loadData(kind, current.artist_id);
    if (token !== request) return;
    const published = directed ? readPairs(data) : [];
    const creators = directed ? new Map(published.flatMap(row => [
      [row.lyricist_creator_id, row.lyricist_name], [row.composer_creator_id, row.composer_name]
    ])) : collaborationIndex(data.works).creators;
    if ((!pairs || directed) && raw.has('creator_id') && !creators.has(current.creator_id)) {
      update({ creator_id: null, lyrics: null, composition: null }, { replace: true });
      current = state();
      status($('analysis-notice'), '指定の作家が見つかりません。');
    }
    if (directed && !current.creator_id && (current.lyrics || current.composition)) {
      update({ lyrics: null, composition: null }, { replace: true });
      current = state();
    }
    for (const [key, control] of Object.entries(flags)) control.checked = Boolean(current[key]);
    flags.lyrics.disabled = flags.composition.disabled = !current.creator_id;
    syncPicker(pairs && !directed ? new Map() : creators, current.creator_id);
    if (pairs) {
      const entries = directed ? rankVisiblePairs(published, current) : allCollaborations(data.works);
      const roles = current.lyrics && current.composition ? '作詞・作曲の両方'
        : current.lyrics ? '作詞' : current.composition ? '作曲' : '作詞または作曲';
      $('pair-condition').textContent = !directed ? '' : current.creator_id
        ? `${creators.get(current.creator_id)}が${roles}を担当した組み合わせ`
        : current.include_self ? 'すべての作詞・作曲ペアを表示しています。' : '異なる作家の組み合わせを表示しています。';
      summary.textContent = `${entries.length}組 / 延べ${entries.reduce((count, row) => count + row.work_count, 0)}曲`;
      status(message, entries.length ? '' : directed && published.length
        ? '条件に一致する組み合わせがありません。' + (current.lyrics && current.composition && !current.include_self
          ? '「同一作家の組み合わせを含む」を選択すると対象を表示できます。' : '') : emptyData);
      results.replaceChildren(...entries.map(row => pairRow(row, current.artist_id)));
      if (directed && entries.some(row => row.lyricist_creator_id === current.lyricist_id && row.composer_creator_id === current.composer_id)) {
        location.replace(collaborationLink(current.lyricist_id, current.composer_id, current.artist_id, '').href);
        return;
      }
    } else {
      $('pair-condition').textContent = '';
      const { assigned, entries } = analyzeCollaborators(data.works, current.creator_id);
      summary.textContent = current.creator_id ? `担当作品数：${assigned}作品 · 共同制作作家数：${entries.length}作家` : '';
      status(message, !creators.size ? emptyData : !current.creator_id ? '分析する作家を選択してください。'
        : !entries.length ? '共同制作相手が見つかりません。' : '');
      results.replaceChildren(...entries.map(row => collaboratorRow(row, current.creator_id, current.artist_id, entries[0].work_count)));
      if (entries.some(row => row.creator_id === current.partner_id)) {
        location.replace(collaborationLink(current.creator_id, current.partner_id, current.artist_id, '').href);
        return;
      }
    }
    if (Object.keys(evidenceKeys).some(key => raw.has(key))) update(evidenceKeys, { replace: true });
    results.dataset.source = source;
  } catch {
    if (token !== request) return;
    status(message, loadError);
    results.replaceChildren();
    summary.textContent = $('pair-condition').textContent = '';
    syncPicker(new Map());
  }
  if (restore) restorePosition();
}

const initialQuery = new URLSearchParams(location.search);
setupArtist(render);
render(true, initialQuery);

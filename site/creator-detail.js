import { filterCreatorWorks, getCreatorDetail } from './creator-catalog-model.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';
import { $, detailLink, restorePosition, setupDetail, state, status, update } from './common.js';
import { loadData, loadError } from './public-data.js';
import { pageUrl } from './site-state.js';

const find = $;
const current = setupDetail(find('creator-back'), 'creators');
const { creator_id: creatorId, artist_id: artistId } = current;

function renderDetail(detail, artistName) {
  find("creator-heading").textContent = detail.name;
  document.title = `${detail.name} | ハロプロ作家研究所`;
  find("creator-overview").textContent = `${artistName}・総担当 ${detail.total}曲`;

  find('creator-analyze').href = pageUrl('/analysis/', { artist_id: artistId, tab: 'creator', creator_id: creatorId });
  const rankTable = find("creator-ranks");
  for (const { label, rank, workCount } of detail.rows) {
    const row = rankTable.insertRow();
    const category = document.createElement("th");
    category.scope = "row";
    category.textContent = label;
    row.append(category);
    row.insertCell().textContent = rank === null ? "ー" : `${rank}位`;
    row.insertCell().textContent = `${workCount}曲`;
  }

  const filters = [...document.querySelectorAll(".creator-work-filters button")];
  const workList = find("creator-work-list");
  function showWorks(role) {
    for (const button of filters) {
      button.setAttribute("aria-pressed", String(button.dataset.role === role));
    }
    const works = filterCreatorWorks(detail.works, role);
    find("creator-work-status").textContent = works.length
      ? `${works.length}曲` : "該当する担当楽曲がありません。";
    workList.replaceChildren(...works.map(work => {
      const item = document.createElement("li");
      const title = detailLink("work", work.work_id, work.title, artistId);
      const badges = document.createElement("span");
      badges.className = "role-badges";
      const orderedRoles = [
        ...Object.keys(ALL_ROLE_LABELS).filter(value => work.roles.includes(value)),
        ...work.roles.filter(value => !Object.hasOwn(ALL_ROLE_LABELS, value))
      ];
      for (const value of new Set(orderedRoles)) {
        const badge = document.createElement("span");
        badge.className = "role-badge";
        badge.textContent = Object.hasOwn(ALL_ROLE_LABELS, value) ? ALL_ROLE_LABELS[value] : value;
        badges.append(badge);
      }
      item.append(title, badges);
      return item;
    }));
  }
  filters.forEach(button => button.addEventListener('click', () => {
    update({ role: button.dataset.role }, { keepPosition: true });
    showWorks(state().role);
  }));
  window.addEventListener('popstate', () => {
    showWorks(state().role);
    restorePosition();
  });
  showWorks(current.role);
  find("creator-status").hidden = true;
  find("creator-content").hidden = false;
}

const message = find('creator-status');
if (!creatorId || !artistId) {
  status(message, '指定された作家またはアーティストを表示できません。');
} else {
  try {
    const [rankings, songs] = await Promise.all([loadData('rankings', artistId), loadData('songs', artistId)]);
    const detail = getCreatorDetail(rankings, songs, creatorId);
    if (detail) {
      const workIds = new Set(songs.works.map(work => work.work_id));
      if (detail.works.some(work => !workIds.has(work.work_id))) throw new Error('Missing catalog evidence');
      renderDetail(detail, rankings.artist.name);
      restorePosition();
    } else status(message, '指定された作家の担当楽曲が見つかりません。');
  } catch {
    status(message, loadError);
  }
}

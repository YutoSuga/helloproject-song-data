import {
  filterCreatorWorks, getCreatorDetail, listParams, publishedArtistId, readCreatorRankings, readListState
} from "./creator-catalog-model.js";
import { ALL_ROLE_LABELS } from "./creator-roles.js";
import { readSongCatalog } from "./song-catalog-model.js";

const find = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const returnUrl = new URL("./creators/", import.meta.url);
returnUrl.search = listParams(readListState(params)).toString();
find("creator-back").href = returnUrl;

const creatorId = params.get("creator_id");
const artistId = params.get("artist_id");

async function loadData(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Creator detail data: ${response.status}`);
  return response.json();
}

function renderDetail(detail, artistName) {
  find("creator-heading").textContent = detail.name;
  document.title = `${detail.name} | Hello! Project Song Database`;
  find("creator-overview").textContent = `${artistName}・総担当 ${detail.total}曲`;

  const rankTable = find("creator-ranks");
  for (const { label, rank, workCount } of detail.rows) {
    const row = rankTable.insertRow();
    const category = document.createElement("th");
    category.scope = "row";
    category.textContent = label;
    row.append(category);
    row.insertCell().textContent = rank === null ? "順位なし" : `${rank}位`;
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
      const title = document.createElement("span");
      title.textContent = work.title;
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
  filters.forEach(button => button.addEventListener("click", () => showWorks(button.dataset.role)));
  showWorks("all");
  find("creator-status").hidden = true;
  find("creator-content").hidden = false;
}

const status = find("creator-status");
if (!/^C\d{5}$/.test(creatorId ?? "") || artistId !== publishedArtistId) {
  status.textContent = "指定された作家またはアーティストを表示できません。";
} else {
  try {
    const [rankingData, songData] = await Promise.all([
      loadData(`./data/rankings/${artistId}.json`),
      loadData(`./data/songs/${artistId}.json`)
    ]);
    const rankings = readCreatorRankings(rankingData, artistId);
    const detail = getCreatorDetail(rankings, readSongCatalog(songData, artistId), creatorId);
    if (detail) {
      renderDetail(detail, rankings.artist.name);
    } else {
      status.textContent = "指定された作家の担当楽曲が見つかりません。";
    }
  } catch {
    status.textContent = "データを表示できません。時間をおいて再読み込みしてください。";
  }
}

import { buildCreatorRoleIndex, ROLE_LABELS } from "./creator-roles.js";
import { compareWorkDates } from "./song-catalog-model.js";

export const categoryIds = ["all", "lyrics", "composition", "lyrics_composition", "arrangement"];
export const publishedArtistId = "G00001";


export function readCreatorRankings(data, artistId) {
  if (data?.artist?.artist_id !== artistId || typeof data.artist.name !== "string") {
    throw new Error("Invalid ranking artist");
  }
  // Only validate the public reader contract. CSV validation stays in the build.
  for (const id of categoryIds) {
    const category = data.categories?.[id];
    if (typeof category?.label !== "string" || !Array.isArray(category.entries)) throw new Error("Invalid ranking category");
    const seenCreators = new Set();
    for (const entry of category.entries) {
      if (!entry || typeof entry.creator_name !== "string" || typeof entry.creator_id !== "string" || !entry.creator_id.trim() ||
          (entry.name_kana != null && typeof entry.name_kana !== "string") ||
          !Number.isInteger(entry.rank) || !Array.isArray(entry.works) || entry.work_count !== entry.works.length ||
          seenCreators.has(entry.creator_id) || new Set(entry.works.map(work => work?.work_id)).size !== entry.works.length ||
          entry.works.some(work => !work || typeof work.title !== "string" || typeof work.work_id !== "string" || !work.work_id.trim())) throw new Error("Invalid ranking entry");
      seenCreators.add(entry.creator_id);
    }
  }
  const roleIndex = buildCreatorRoleIndex(data.categories);
  for (const id of categoryIds) {
    for (const entry of data.categories[id].entries) {
      if (id === "all") {
        if (entry.works.some(work => !Array.isArray(work.roles) || !work.roles.length ||
            work.roles.some(role => typeof role !== "string" || !role.trim() || role === "all") ||
            !Array.isArray(work.song_ids) || !work.song_ids.length ||
            work.song_ids.some(songId => typeof songId !== "string" || !songId.trim()))) {
          throw new Error("Invalid all-role evidence");
        }
        continue;
      }
      if (entry.works.some(work => !roleIndex.get(entry.creator_id)?.has(work.work_id))) {
        throw new Error("Missing creator role evidence");
      }
    }
  }
  return data;
}

export function readListState(params) {
  const view = params.get("view");
  const category = params.get("category");
  return {
    view: ["ranking", "pairs"].includes(view) ? view : "search",
    category: categoryIds.includes(category) ? category : "all",
    q: params.get("q") ?? ""
  };
}

export function listParams({ view, category, q }) {
  const params = new URLSearchParams();
  if (view !== "search") params.set("view", view);
  if (category !== "all") params.set("category", category);
  if (q) params.set("q", q);
  return params;
}

export { searchCreators as findCreators } from "./creator-name.js";

export function getCreatorDetail(rankings, catalog, creatorId) {
  const creator = rankings.categories.all.entries.find(entry => entry.creator_id === creatorId);
  if (!creator) return null;
  const dates = new Map(catalog.works.map(work => [work.work_id, work.first_release_date]));
  const works = creator.works.map(work => ({
    ...work,
    first_release_date: dates.get(work.work_id) ?? null
  })).sort(compareWorkDates);
  const rows = categoryIds.map(id => {
    const { label, entries } = rankings.categories[id];
    const entry = entries.find(item => item.creator_id === creatorId);
    return { label, rank: entry?.rank ?? null, workCount: entry?.work_count ?? 0 };
  });
  return { name: creator.creator_name, total: creator.work_count, works, rows };
}

export function filterCreatorWorks(works, role) {
  if (role === "all") return works;
  return works.filter(work => role === "other"
    ? work.roles.some(value => !Object.hasOwn(ROLE_LABELS, value))
    : work.roles.includes(role));
}

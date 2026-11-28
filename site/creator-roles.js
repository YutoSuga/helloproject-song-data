// Only the three ordinary categories provide badge evidence. Composite categories
// have different recording semantics and must never drive pair filtering.
export const ROLE_LABELS = { lyrics: "作詞", composition: "作曲", arrangement: "編曲" };

export const ALL_ROLE_LABELS = { ...ROLE_LABELS, english_lyrics: "英語詞", brass_arrangement: "ブラス編曲" };

export function buildCreatorRoleIndex(categories) {
  const index = new Map();
  const validId = value => typeof value === "string" && value.trim().length > 0;
  for (const role of Object.keys(ROLE_LABELS)) {
    const entries = categories?.[role]?.entries;
    if (!Array.isArray(entries)) throw new Error("Invalid role category");
    const seen = new Set();
    for (const entry of entries) {
      if (!validId(entry?.creator_id) || seen.has(entry.creator_id) || !Array.isArray(entry.works)) {
        throw new Error("Invalid role creator");
      }
      seen.add(entry.creator_id);
      const works = index.get(entry.creator_id) ?? new Map();
      const seenWorks = new Set();
      for (const work of entry.works) {
        if (!validId(work?.work_id) || seenWorks.has(work.work_id) ||
            !Array.isArray(work.roles) || work.roles.length === 0 || work.roles.some(value => value !== role) ||
            !Array.isArray(work.song_ids) || work.song_ids.length === 0 || !work.song_ids.every(validId)) {
          throw new Error("Invalid role work evidence");
        }
        seenWorks.add(work.work_id);
        const roles = works.get(work.work_id) ?? new Set();
        for (const value of work.roles) roles.add(value);
        works.set(work.work_id, roles);
      }
      index.set(entry.creator_id, works);
    }
  }
  return index;
}

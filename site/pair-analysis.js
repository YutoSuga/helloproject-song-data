export function analyzeCreatorPairs(entries, creatorId, lyrics = false, composition = false) {
  const selected = entries.filter((entry) => {
    if (!creatorId) return true;
    const L = entry.lyricist_creator_id === creatorId;
    const C = entry.composer_creator_id === creatorId;
    return lyrics && composition ? L && C : lyrics ? L : composition ? C : L || C;
  });
  let rank = 0;
  const ranked = selected.map((entry, index) => {
    if (index === 0 || entry.work_count !== selected[index - 1].work_count) rank = index + 1;
    return { ...entry, rank };
  });
  const selfPair = entries.find((entry) => entry.lyricist_creator_id === creatorId && entry.composer_creator_id === creatorId);
  return { entries: ranked, self_work_count: selfPair?.work_count ?? 0 };
}

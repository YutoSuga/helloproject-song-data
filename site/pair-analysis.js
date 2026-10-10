export function analyzeCreatorPairs(entries, creatorId, direction) {
  const selected = entries.filter((entry) => direction === "all"
    || (direction === "lyricist" ? entry.lyricist_creator_id : entry.composer_creator_id) === creatorId);
  let rank = 0;
  const ranked = selected.map((entry, index) => {
    if (index === 0 || entry.work_count !== selected[index - 1].work_count) rank = index + 1;
    return { ...entry, rank };
  });
  const selfPair = entries.find((entry) => entry.lyricist_creator_id === creatorId && entry.composer_creator_id === creatorId);
  return { entries: ranked, self_work_count: selfPair?.work_count ?? 0 };
}

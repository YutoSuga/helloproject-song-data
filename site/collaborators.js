import { compareWorkDates } from './song-catalog-model.js';

export function catalogCreators(works) {
  const creators = new Map();
  for (const work of works) for (const song of work.songs) for (const credit of song.credits) {
    creators.set(credit.creator_id, credit.creator_name);
  }
  return creators;
}

export function analyzeCollaborators(works, targetId) {
  const collaborators = new Map();
  let assigned = 0;
  for (const work of works) {
    let matched = false;
    for (const song of work.songs) {
      const credits = new Map(song.credits.map(credit => [credit.creator_id, credit.creator_name]));
      if (!credits.delete(targetId)) continue;
      matched = true;
      for (const [creatorId, name] of credits) {
        if (!collaborators.has(creatorId)) collaborators.set(creatorId, { creator_id: creatorId, creator_name: name, works: new Map() });
        const evidence = collaborators.get(creatorId).works;
        if (!evidence.has(work.work_id)) evidence.set(work.work_id, {
          work_id: work.work_id, title: work.title, first_release_date: work.first_release_date, song_ids: []
        });
        const songs = evidence.get(work.work_id).song_ids;
        songs.push(song.song_id);
      }
    }
    if (matched) assigned++;
  }
  const entries = [...collaborators.values()].map(row => ({
    ...row, work_count: row.works.size, works: [...row.works.values()].sort(compareWorkDates)
  })).sort((a, b) => b.work_count - a.work_count || a.creator_id.localeCompare(b.creator_id, 'en'));
  let rank;
  for (const [index, row] of entries.entries()) {
    if (row.work_count !== entries[index - 1]?.work_count) rank = index + 1;
    row.rank = rank;
  }
  return { assigned, entries };
}

export const CATEGORY_DEFINITIONS = [
  { id: "lyrics", label: "作詞" },
  { id: "composition", label: "作曲" },
  { id: "lyrics_composition", label: "作詞 & 作曲" },
  { id: "lyrics_or_composition", label: "作詞 or 作曲" },
  { id: "arrangement", label: "編曲" }
];

const byId = (left, right) => left.localeCompare(right, "en");

export function aggregateCreatorRankings(data, artistId) {
  const artist = data.artists.find((item) => item.artist_id === artistId);
  if (!artist) throw new Error(`Unknown artist_id: ${artistId}`);

  const songsById = new Map(data.songs.map((song) => [song.song_id, song]));
  const worksById = new Map(data.works.map((work) => [work.work_id, work]));
  const creatorsById = new Map(data.creators.map((creator) => [creator.creator_id, creator]));
  const targetSongIds = new Set(data.songArtists
    .filter((relation) => relation.artist_id === artistId && relation.role === "primary")
    .map((relation) => relation.song_id));

  const evidence = new Map();
  const pairEvidence = new Map();
  const addEvidence = (category, credit, song) => {
    const key = `${category}\0${credit.creator_id}\0${song.work_id}`;
    const current = evidence.get(key) ?? {
      category,
      creator_id: credit.creator_id,
      work_id: song.work_id,
      song_ids: new Set(),
      roles: new Set()
    };
    current.song_ids.add(song.song_id);
    current.roles.add(credit.role);
    evidence.set(key, current);
  };

  const creditsBySong = new Map();
  const pairCreditsBySong = new Map();
  for (const credit of data.songCreators) {
    if (!targetSongIds.has(credit.song_id)) continue;
    const song = songsById.get(credit.song_id);
    if (!song) throw new Error(`Credit references missing song: ${credit.song_id}`);
    if (["lyrics", "composition", "arrangement"].includes(credit.role)) {
      addEvidence(credit.role, credit, song);
    }
    if (["lyrics", "composition"].includes(credit.role)) {
      addEvidence("lyrics_or_composition", credit, song);
      const roles = pairCreditsBySong.get(credit.song_id) ?? { lyrics: new Set(), composition: new Set() };
      roles[credit.role].add(credit.creator_id);
      pairCreditsBySong.set(credit.song_id, roles);
    }
    const key = `${credit.song_id}\0${credit.creator_id}`;
    const roles = creditsBySong.get(key) ?? new Set();
    roles.add(credit.role);
    creditsBySong.set(key, roles);
  }

  // Form pairs within one concrete song, then deduplicate at work + pair level.
  for (const [songId, roles] of pairCreditsBySong) {
    const song = songsById.get(songId);
    for (const lyricistId of roles.lyrics) {
      for (const composerId of roles.composition) {
        const key = `${song.work_id}\0${lyricistId}\0${composerId}`;
        const item = pairEvidence.get(key) ?? {
          work_id: song.work_id,
          lyricist_creator_id: lyricistId,
          composer_creator_id: composerId,
          song_ids: new Set()
        };
        item.song_ids.add(songId);
        pairEvidence.set(key, item);
      }
    }
  }

  // Both roles must occur on the same concrete recording. Evidence is still
  // deduplicated to creator + work after this condition has been established.
  for (const [key, roles] of creditsBySong) {
    if (!roles.has("lyrics") || !roles.has("composition")) continue;
    const [songId, creatorId] = key.split("\0");
    const song = songsById.get(songId);
    addEvidence("lyrics_composition", { creator_id: creatorId, role: "lyrics" }, song);
    addEvidence("lyrics_composition", { creator_id: creatorId, role: "composition" }, song);
  }

  const categories = {};
  for (const definition of CATEGORY_DEFINITIONS) {
    const grouped = new Map();
    for (const item of evidence.values()) {
      if (item.category !== definition.id) continue;
      const creatorItems = grouped.get(item.creator_id) ?? [];
      const work = worksById.get(item.work_id);
      if (!work) throw new Error(`Song references missing work: ${item.work_id}`);
      creatorItems.push({
        work_id: item.work_id,
        title: work.title,
        song_ids: [...item.song_ids].sort(byId),
        roles: [...item.roles].sort(byId)
      });
      grouped.set(item.creator_id, creatorItems);
    }
    const entries = [...grouped].map(([creatorId, works]) => ({
      artist_id: artistId,
      category: definition.id,
      rank: 0,
      creator_id: creatorId,
      creator_name: creatorsById.get(creatorId)?.name ?? "",
      work_count: works.length,
      works: works.sort((left, right) => byId(left.work_id, right.work_id))
    })).sort((left, right) => right.work_count - left.work_count || byId(left.creator_id, right.creator_id));

    entries.forEach((entry, index) => {
      entry.rank = index === 0 || entry.work_count !== entries[index - 1].work_count
        ? index + 1
        : entries[index - 1].rank;
    });
    categories[definition.id] = { label: definition.label, entries };
  }

  const targetSongs = [...targetSongIds].map((id) => songsById.get(id));
  const pairsByCreators = new Map();
  for (const item of pairEvidence.values()) {
    const key = `${item.lyricist_creator_id}\0${item.composer_creator_id}`;
    const works = pairsByCreators.get(key) ?? [];
    const work = worksById.get(item.work_id);
    if (!work) throw new Error(`Song references missing work: ${item.work_id}`);
    works.push({ work_id: item.work_id, title: work.title, song_ids: [...item.song_ids].sort(byId) });
    pairsByCreators.set(key, works);
  }
  const pairEntries = [...pairsByCreators].map(([key, works]) => {
    const [lyricistId, composerId] = key.split("\0");
    return {
      rank: 0,
      lyricist_creator_id: lyricistId,
      lyricist_name: creatorsById.get(lyricistId)?.name ?? "",
      composer_creator_id: composerId,
      composer_name: creatorsById.get(composerId)?.name ?? "",
      work_count: works.length,
      works: works.sort((left, right) => byId(left.work_id, right.work_id))
    };
  }).sort((left, right) => right.work_count - left.work_count
    || byId(left.lyricist_creator_id, right.lyricist_creator_id)
    || byId(left.composer_creator_id, right.composer_creator_id));
  pairEntries.forEach((entry, index) => {
    entry.rank = index === 0 || entry.work_count !== pairEntries[index - 1].work_count
      ? index + 1
      : pairEntries[index - 1].rank;
  });
  return {
    artist: { artist_id: artist.artist_id, name: artist.name },
    summary: {
      primary_song_count: targetSongIds.size,
      target_work_count: new Set(targetSongs.map((song) => song.work_id)).size
    },
    categories,
    lyrics_composition_pairs: { label: "作詞者 × 作曲者", entries: pairEntries }
  };
}

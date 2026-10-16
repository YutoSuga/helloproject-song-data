import { join } from "node:path";
import { readCsv } from "../csv.js";
import { withCanonicalRead } from "../fn004-repository.js";

const normalize = (title) => title.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
export async function loadTitleIndex(root, { gate } = {}) {
  return withCanonicalRead({ root, gate, fn: (resolvedRoot) => readTitleIndex(resolvedRoot) });
}

async function readTitleIndex(root) {
  const reads = await Promise.allSettled([
    readCsv(join(root, "data", "songs.csv")),
    readCsv(join(root, "data", "works.csv"))
  ]);
  const failure = reads.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  const [songs, works] = reads.map((result) => result.value);
  const index = new Map();
  for (const song of songs) {
    const key = normalize(song.title);
    const entry = index.get(key) ?? { songIds: new Set(), workIds: new Set() };
    entry.songIds.add(song.song_id);
    if (song.work_id) entry.workIds.add(song.work_id);
    index.set(key, entry);
  }
  for (const work of works) {
    const key = normalize(work.title);
    const entry = index.get(key) ?? { songIds: new Set(), workIds: new Set() };
    entry.workIds.add(work.work_id);
    index.set(key, entry);
  }
  return index;
}
export function matchExisting(title, index) {
  const entry = index.get(normalize(title));
  return {
    state: entry ? "exact_title_match" : "no_match",
    song_ids: entry ? [...entry.songIds].sort() : [],
    work_ids: entry ? [...entry.workIds].sort() : [],
    confirmed_song_id: null,
    confirmed_work_id: null
  };
}

import { join } from "node:path";
import { readCsv } from "./csv.js";
import { withCanonicalRead } from "./fn004-repository.js";

export async function loadCanonicalData(root = process.cwd(), { gate } = {}) {
  return withCanonicalRead({ root, gate, fn: async (root) => {
    const read = (name) => readCsv(join(root, "data", `${name}.csv`));
    // Await every read even on failure before releasing the shared gate.
    const reads = await Promise.allSettled([
      read("artists"), read("creators"), read("songs"), read("works"),
      read("song_artists"), read("song_creators")
    ]);
    const failure = reads.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const [artists, creators, songs, works, songArtists, songCreators] = reads.map((result) => result.value);
    return { artists, creators, songs, works, songArtists, songCreators };
  } });
}

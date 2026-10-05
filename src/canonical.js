import { join } from "node:path";
import { readCsv } from "./csv.js";

export async function loadCanonicalData(root = process.cwd()) {
  const read = (name) => readCsv(join(root, "data", `${name}.csv`));
  const [artists, creators, songs, works, songArtists, songCreators] = await Promise.all([
    read("artists"), read("creators"), read("songs"), read("works"),
    read("song_artists"), read("song_creators")
  ]);
  return { artists, creators, songs, works, songArtists, songCreators };
}

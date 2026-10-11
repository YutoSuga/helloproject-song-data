import { artists } from "./artists.js";

export function selectArtists(artistSlug) {
  if (artistSlug === undefined) return Object.values(artists);
  if (!Object.hasOwn(artists, artistSlug)) throw new Error(`Unknown artist: ${artistSlug}`);
  return [artists[artistSlug]];
}

export function parseCollectorArgs(args) {
  let artistSlug;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--artist") throw new Error(`Unknown CLI option: ${option}`);
    if (artistSlug !== undefined) throw new Error("--artist may only be specified once");
    const value = args[++index];
    if (!value || value.startsWith("-")) throw new Error("--artist requires a slug");
    selectArtists(value);
    artistSlug = value;
  }
  return { artistSlug };
}

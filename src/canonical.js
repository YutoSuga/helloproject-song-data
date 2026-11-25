import { readValidatedCanonical } from './canonical-reader.js';

export async function loadCanonicalData(root = process.cwd()) {
  const { tables: t } = await readValidatedCanonical(root);
  return { artists: t.artists, creators: t.creators, songs: t.songs, works: t.works,
    songArtists: t.song_artists, songCreators: t.song_creators };
}

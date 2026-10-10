import { byClass, clean, firstClass, parseHtml } from "./html.js";

const audioMedia = new Set(["CD", "STREAMING", "DIGITAL"]);
const videoMedia = new Set(["BD", "BLU-RAY", "DVD"]);
const instrumental = /[（(]\s*(?:instrumental|inst\.?|カラオケ)\s*[)）]\s*$/i;
export const isInstrumental = (title) => instrumental.test(title);
const dateValue = (value) => {
  const match = value.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!match) throw new Error(`Invalid release date: ${value}`);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};
function creditsFor(item) {
  const credits = Object.fromEntries(["lyrics", "composition", "arrangement", "performer"].map((key) => [key, { raw: null, names: [] }]));
  for (const span of byClass(firstClass(item, "TrackListItem__notes") ?? item, "pr-[1em]")) {
    const raw = clean(span);
    const match = raw.match(/^(作詞|作曲|編曲|歌|出演)\s*[：:]\s*(.+)$/);
    if (!match) continue;
    const key = { 作詞: "lyrics", 作曲: "composition", 編曲: "arrangement", 歌: "performer", 出演: "performer" }[match[1]];
    credits[key].raw = credits[key].raw ? `${credits[key].raw} / ${raw}` : raw;
    // Do not guess person boundaries from separators in official names.
    credits[key].names.push(match[2]);
  }
  return credits;
}
export function parseReleaseDetail(html, release, config) {
  const root = parseHtml(html);
  const head = firstClass(root, "ReleaseHead");
  const title = clean(firstClass(head, "ReleaseHead__mainName"));
  const type = clean(firstClass(head, "StatusLabel--category"));
  const artistNodes = firstClass(head, "ReleaseHead__mainTitle")?.children?.filter?.((n) => n?.attrs?.class === "paragraph-sm") ?? [];
  const artist = clean(artistNodes.at(-1));
  const details = firstClass(head, "ReleaseHead__mainDetails");
  const date = byClass(head, "ReleaseHead__mainDetails").flatMap((n) => {
    const dls = n.children.filter((x) => x?.tag === "dl");
    return dls.filter((dl) => clean(dl.children.find((x) => x?.tag === "dt")).startsWith("発売日"))
      .map((dl) => clean(dl.children.find((x) => x?.tag === "dd")));
  })[0];
  if (!title || !type || !artist || !date || !details || type !== release.type) throw new Error(`Release detail missing or changed: ${release.url}`);
  const editions = byClass(root, "ReleaseEdition");
  if (!editions.length) throw new Error(`No release editions: ${release.url}`);
  const tracks = [];
  const counts = { audioTracks: 0, instrumentalExcluded: 0, videoExcluded: 0 };
  for (const [editionIndex, edition] of editions.entries()) {
    const editionName = clean(firstClass(edition, "ReleaseEdition__name")) || `edition-${editionIndex}`;
    const discs = byClass(edition, "TrackList__inner");
    if (!discs.length) throw new Error(`No media sections: ${release.url}`);
    for (const [discIndex, disc] of discs.entries()) {
      const headline = firstClass(disc, "ReleaseEdition__headline");
      const mediaType = clean(firstClass(headline, "ReleaseEdition__mediaType")).toUpperCase();
      if (!audioMedia.has(mediaType) && !videoMedia.has(mediaType)) throw new Error(`Unknown media section ${mediaType}: ${release.url}`);
      const productNumber = clean(headline?.children?.find?.((n) => typeof n !== "string" && (n.attrs?.class ?? "").includes("font-figtree"))) || null;
      const items = byClass(disc, "TrackListItem");
      if (!items.length && audioMedia.has(mediaType)) throw new Error(`Audio section has no tracks: ${release.url}`);
      for (const item of items) {
        if (videoMedia.has(mediaType)) { counts.videoExcluded += 1; continue; }
        counts.audioTracks += 1;
        const trackNumber = Number.parseInt(clean(firstClass(item, "TrackListItem__index")), 10);
        const trackTitle = clean(firstClass(item, "TrackListItem__title"));
        if (!Number.isInteger(trackNumber) || !trackTitle) throw new Error(`Invalid track: ${release.url}`);
        if (isInstrumental(trackTitle)) { counts.instrumentalExcluded += 1; continue; }
        tracks.push({ title: trackTitle, trackNumber, mediaType, editionName, editionIndex, discIndex, productNumber, credits: creditsFor(item) });
      }
    }
  }
  if (!counts.audioTracks) throw new Error(`No audio tracks: ${release.url}`);
  return { title, type, artist, date: dateValue(date), tracks, counts };
}

import { createHash } from "node:crypto";

function hashIdentity(identity) {
  return `sc_${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`;
}

function sourcePosition(slug, releaseUrl, mediaType, editionName, productNumber, discIndex, trackNumber) {
  if (!slug || !releaseUrl || !mediaType || !editionName ||
      !Number.isInteger(discIndex) || !Number.isInteger(trackNumber)) {
    throw new Error("Candidate source position is incomplete");
  }
  return [slug, new URL(releaseUrl).href, mediaType, editionName,
    productNumber || null, discIndex, trackNumber];
}

function storedPosition(candidate) {
  return sourcePosition(candidate.source_artist_slug ?? candidate.artist_slug,
    candidate.source_release_url, candidate.media_type, candidate.edition,
    candidate.product_number, candidate.disc_index, candidate.track_number);
}

export function candidateId(config, releaseUrl, track) {
  return hashIdentity(sourcePosition(config.slug, releaseUrl, track.mediaType,
    track.editionName, track.productNumber, track.discIndex, track.trackNumber));
}

function migrateCandidate(candidate) {
  const position = storedPosition(candidate);
  const nextId = hashIdentity(position);
  if (candidate.candidate_id === nextId) return candidate;
  const legacyIdentity = [position[0], position[1], position[2],
    candidate.product_number || candidate.edition || String(candidate.edition_index),
    String(position[5]), String(position[6]), candidate.title?.normalize("NFC")];
  if (candidate.candidate_id !== hashIdentity(legacyIdentity)) {
    throw new Error(`Unrecognized candidate ID: ${candidate.candidate_id}`);
  }
  return { ...candidate, candidate_id: nextId };
}
export function makeCandidate(config, release, detail, track, match, now) {
  const isConfiguredArtist = detail.artist === config.artistName;
  return {
    candidate_id: candidateId(config, release.url, track),
    artist_id: isConfiguredArtist ? config.artistId : null,
    artist_slug: isConfiguredArtist ? config.slug : null,
    source_artist_slug: config.slug,
    artist_name: detail.artist,
    title: track.title,
    release_title: detail.title,
    release_date: detail.date,
    release_type: detail.type,
    source_url: release.url,
    source_release_url: release.url,
    track_number: track.trackNumber,
    media_type: track.mediaType,
    edition: track.editionName,
    disc_index: track.discIndex,
    product_number: track.productNumber,
    status: "pending",
    detected_at: now,
    last_seen_at: now,
    credits: track.credits,
    match,
    notes: ""
  };
}
export function mergeCandidates(previous, observed, now) {
  if (!Array.isArray(previous)) throw new Error("Invalid staging candidates");
  const byId = new Map();
  for (const old of previous) {
    if (!old?.candidate_id) throw new Error("Invalid existing candidate_id");
    const candidate = migrateCandidate(old);
    if (byId.has(candidate.candidate_id)) throw new Error(`Duplicate source position: ${candidate.candidate_id}`);
    byId.set(candidate.candidate_id, candidate);
  }
  let added = 0;
  let rediscovered = 0;
  for (const candidate of observed) {
    const old = byId.get(candidate.candidate_id);
    if (!old) { added += 1; byId.set(candidate.candidate_id, candidate); continue; }
    if (JSON.stringify(storedPosition(old)) !== JSON.stringify(storedPosition(candidate))) {
      throw new Error(`Candidate ID collision: ${candidate.candidate_id}`);
    }
    rediscovered += 1;
    byId.set(candidate.candidate_id, {
      ...old,
      ...candidate,
      status: old.status,
      notes: old.notes,
      detected_at: old.detected_at,
      last_seen_at: now
    });
  }
  const groups = new Map();
  for (const candidate of byId.values()) {
    const key = `${candidate.artist_name}\0${candidate.title?.normalize("NFKC").replace(/\s+/g, "")}`;
    const group = groups.get(key) ?? [];
    group.push(candidate.candidate_id);
    groups.set(key, group);
  }
  const candidates = [...byId.values()].map((candidate) => ({
    ...candidate,
    related_candidates: (groups.get(`${candidate.artist_name}\0${candidate.title?.normalize("NFKC").replace(/\s+/g, "")}`) ?? [])
      .filter((id) => id !== candidate.candidate_id).sort()
  }));
  return { candidates, added, rediscovered };
}

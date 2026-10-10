import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { artists } from "./artists.js";
import { fetchPage } from "./fetch-page.js";
import { parseReleaseList, parseReleaseFeed, parseReleaseFeedYear } from "./parse-release-list.js";
import { parseReleaseDetail } from "./parse-release-detail.js";
import { loadTitleIndex, matchExisting } from "./match-existing.js";
import { makeCandidate, mergeCandidates } from "./merge-candidates.js";

async function readStaging(path) {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.schema_version !== 1 || !Array.isArray(data.candidates)) throw new Error("Unsupported staging schema");
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return { schema_version: 1, candidates: [] };
    throw error;
  }
}
export async function collectCandidates({
  root = process.cwd(), artistSlug = "rosychronicle", fetchImpl = fetch,
  now = new Date().toISOString(), outputPath = join(root, "staging", "song-candidates.json")
} = {}) {
  const config = artists[artistSlug];
  if (!config) throw new Error(`Unknown artist: ${artistSlug}`);
  const existing = await readStaging(outputPath);
  const titleIndex = await loadTitleIndex(root);
  const listHtml = await fetchPage(config.releaseUrl, { fetchImpl });
  const releasesByUrl = new Map(parseReleaseList(listHtml, config).map((release) => [release.url, release]));
  const feed = parseReleaseFeed(listHtml, config);
  for (const year of feed.years) {
    const url = new URL(`/json/${feed.versionDir}/${year}_releases.json`, config.releaseUrl).href;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const payload = await response.json();
    for (const release of parseReleaseFeedYear(payload, config)) releasesByUrl.set(release.url, release);
  }
  const releases = [...releasesByUrl.values()];
  if (!releases.length) throw new Error("No audio releases on release list");
  const observed = [];
  const summary = {
    artist: config.artistName, releases: releases.length, detail_success: 0,
    detail_failed: 0, tracks_detected: 0, instrumental_excluded: 0,
    video_excluded: 0, new_candidates: 0, rediscovered_candidates: 0,
    possible_matches: 0, errors: 0
  };
  const failures = [];
  for (const release of releases) {
    try {
      const html = await fetchPage(release.url, { fetchImpl });
      const detail = parseReleaseDetail(html, release, config);
      summary.detail_success += 1;
      summary.tracks_detected += detail.counts.audioTracks;
      summary.instrumental_excluded += detail.counts.instrumentalExcluded;
      summary.video_excluded += detail.counts.videoExcluded;
      for (const track of detail.tracks) {
        const match = matchExisting(track.title, titleIndex);
        if (match.state !== "no_match") summary.possible_matches += 1;
        observed.push(makeCandidate(config, release, detail, track, match, now));
      }
    } catch (error) {
      summary.detail_failed += 1;
      failures.push(`${release.url}: ${error.message}`);
    }
  }
  summary.errors = failures.length;
  if (failures.length) {
    const error = new Error(`Collection aborted; staging unchanged.\n${failures.join("\n")}`);
    error.summary = summary;
    throw error;
  }
  const merged = mergeCandidates(existing.candidates, observed, now);
  summary.new_candidates = merged.added;
  summary.rediscovered_candidates = merged.rediscovered;
  const data = { ...existing, schema_version: 1, updated_at: now, candidates: merged.candidates };
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temp, outputPath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return summary;
}

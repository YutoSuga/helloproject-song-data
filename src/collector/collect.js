import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { selectArtists } from "./cli.js";
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

export async function saveStaging(outputPath, data) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = `${outputPath}.${process.pid}.tmp`;
  let created = false;
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    created = true;
    await rename(temp, outputPath);
  } catch (error) {
    // Never remove a temp file owned by another invocation after an EEXIST.
    if (created || error.code !== "EEXIST") await rm(temp, { force: true });
    throw error;
  }
}

function artistSummary(config) {
  return {
    artist: config.artistName, artist_slug: config.slug, releases: 0, detail_success: 0,
    detail_failed: 0, empty_audio_releases: 0, empty_audio_release_urls: [],
    tracks_detected: 0, instrumental_excluded: 0,
    video_excluded: 0, new_candidates: 0, rediscovered_candidates: 0,
    possible_matches: 0, errors: 0
  };
}

// This phase observes official sources only; it never reads or writes staging.
export async function collectArtist({ config, titleIndex, fetchImpl = fetch,
  now = new Date().toISOString(), feedCache = new Map() }) {
  const summary = artistSummary(config);
  try {
    const listHtml = await fetchPage(config.releaseUrl, { fetchImpl });
    const releasesByUrl = new Map(parseReleaseList(listHtml, config).map((release) => [release.url, release]));
    const feed = parseReleaseFeed(listHtml, config);
    for (const year of feed.years) {
      const url = new URL(`/json/${feed.versionDir}/${year}_releases.json`, config.releaseUrl).href;
      if (!feedCache.has(url)) {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        feedCache.set(url, await response.json());
      }
      for (const release of parseReleaseFeedYear(feedCache.get(url), config)) releasesByUrl.set(release.url, release);
    }
    const releases = [...releasesByUrl.values()];
    summary.releases = releases.length;
    if (!releases.length) throw new Error("No audio releases on release list");
    const observed = [];
    const failures = [];
    for (const release of releases) {
      try {
        const html = await fetchPage(release.url, { fetchImpl });
        const detail = parseReleaseDetail(html, release, config);
        summary.detail_success += 1;
        if (detail.officialEmptyAudioRelease) {
          summary.empty_audio_releases += 1;
          summary.empty_audio_release_urls.push(release.url);
        }
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
    if (failures.length) {
      summary.errors = failures.length;
      throw new Error(failures.join("\n"));
    }
    return { observed, summary };
  } catch (error) {
    summary.errors ||= 1;
    error.artistSummary = summary;
    throw error;
  }
}

function collectionSummary(mode, summaries, saved, transactionErrors = 0) {
  const fields = Object.keys(artistSummary({})).filter((key) =>
    key !== "artist" && key !== "artist_slug" && key !== "empty_audio_release_urls");
  const total = Object.fromEntries(fields.map((key) => [key, summaries.reduce((sum, summary) => sum + summary[key], 0)]));
  total.empty_audio_release_urls = summaries.flatMap((summary) => summary.empty_audio_release_urls);
  total.errors += transactionErrors;
  return { mode, saved, artists: summaries, total };
}

export async function collectCandidates({
  root = process.cwd(), artistSlug, fetchImpl = fetch,
  now = new Date().toISOString(), outputPath = join(root, "staging", "song-candidates.json"),
  save = saveStaging
} = {}) {
  const selected = selectArtists(artistSlug);
  const mode = artistSlug === undefined ? "all" : "single";
  const summaries = [];
  try {
    const existing = await readStaging(outputPath);
    const titleIndex = await loadTitleIndex(root);
    const observed = [];
    const feedCache = new Map();
    for (const config of selected) {
      const result = await collectArtist({ config, titleIndex, fetchImpl, now, feedCache });
      summaries.push(result.summary);
      observed.push(...result.observed);
    }
    // No staging mutation occurs until every selected artist has succeeded.
    const merged = mergeCandidates(existing.candidates, observed, now);
    const data = { ...existing, schema_version: 1, updated_at: now, candidates: merged.candidates };
    await save(outputPath, data);
    for (const summary of summaries) {
      const counts = merged.countsByArtist.get(summary.artist_slug);
      summary.new_candidates = counts?.added ?? 0;
      summary.rediscovered_candidates = counts?.rediscovered ?? 0;
    }
    return collectionSummary(mode, summaries, true);
  } catch (cause) {
    if (cause.artistSummary) summaries.push(cause.artistSummary);
    const error = new Error(`Collection aborted; staging unchanged.\n${cause.message}`, { cause });
    error.summary = collectionSummary(mode, summaries, false, cause.artistSummary ? 0 : 1);
    throw error;
  }
}

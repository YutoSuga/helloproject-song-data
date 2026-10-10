import { collectCandidates } from "../src/collector/collect.js";

try {
  const summary = await collectCandidates({ artistSlug: process.argv[2] || "rosychronicle" });
  console.log(JSON.stringify({ event: "collection_summary", ...summary }));
} catch (error) {
  console.error(JSON.stringify({ event: "collection_summary", artist: process.argv[2] || "rosychronicle", releases: 0, detail_success: 0, detail_failed: 0, tracks_detected: 0, instrumental_excluded: 0, video_excluded: 0, new_candidates: 0, rediscovered_candidates: 0, possible_matches: 0, errors: 1, ...(error.summary ?? {}), error: error.message }));
  process.exitCode = 1;
}

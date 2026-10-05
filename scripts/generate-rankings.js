import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCanonicalData } from "../src/canonical.js";
import { aggregateCreatorRankings } from "../src/rankings.js";

const artistId = process.argv[2] ?? "G00001";
const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "site/data/rankings");
const ranking = aggregateCreatorRankings(await loadCanonicalData(root), artistId);
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `${artistId}.json`);
await writeFile(outputPath, `${JSON.stringify(ranking, null, 2)}\n`);
console.log(`Generated ${outputPath}`);
console.log(`${ranking.artist.name}: ${ranking.summary.primary_song_count} primary songs / ${ranking.summary.target_work_count} works`);

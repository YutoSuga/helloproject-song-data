import { collectCandidates } from "../src/collector/collect.js";
import { parseCollectorArgs } from "../src/collector/cli.js";

try {
  const summary = await collectCandidates(parseCollectorArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ event: "collection_summary", ...summary }));
} catch (error) {
  console.error(JSON.stringify({ event: "collection_summary", saved: false, artists: [],
    total: { errors: 1 }, ...(error.summary ?? {}), error: error.message }));
  process.exitCode = 1;
}

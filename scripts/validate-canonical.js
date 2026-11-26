import { readValidatedCanonical } from '../src/canonical-reader.js';
try {
  const { manifest } = await readValidatedCanonical();
  console.log(`All 14 canonical tables valid: ${manifest.manifest_hash}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateIdDiff } from '../src/id-diff.js';
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--base') throw new Error('Usage: npm run ids:validate -- --base <full SHA>');
  const { stdout } = await promisify(execFile)('git',['rev-parse','HEAD']);
  console.log(JSON.stringify(await validateIdDiff({base:args[1],candidate:stdout.trim()}),null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }

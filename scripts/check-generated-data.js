import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkGeneratedData(root) {
  const paths = ['site/data/rankings', 'site/data/songs', 'site/data/about/artists.json'];
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...paths], { cwd: root, stdio: 'pipe' });
  // No exclude-standard: ignored output files must not bypass this check either.
  const untracked = execFileSync('git', ['ls-files', '--others', '-z', '--', ...paths], { cwd: root, encoding: 'utf8' });
  if (untracked) throw new Error(`Generated files are not committed: ${untracked.split('\0').filter(Boolean).join(', ')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { checkGeneratedData(resolve(import.meta.dirname, '..')); console.log('Generated public data files match HEAD'); }
  catch (error) { console.error(error.stdout?.toString() || error.message); process.exitCode = 1; }
}

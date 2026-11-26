import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
if (process.argv.length > 2) throw new Error('npm test runs the current CSV/site suite only; archived tests use the pinned manual workflow.');
const files = (await readdir(new URL('../test',import.meta.url)))
  .filter(name => /\.test\.(js|cjs)$/.test(name) && !name.startsWith('fn004-')).sort();
const child = spawn(process.execPath,['--test', ...files.map(name=>`test/${name}`)],{stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code ?? 1;});

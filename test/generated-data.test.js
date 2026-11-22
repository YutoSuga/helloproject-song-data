import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkGeneratedData } from '../scripts/check-generated-data.js';

test('generated drift detects modified, staged, missing, untracked and ignored files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'generated-drift-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  try {
    git('init');git('config','user.email','test@example.com');git('config','user.name','test');
    await mkdir(join(root,'site/data/songs'),{recursive:true});await mkdir(join(root,'site/data/rankings'),{recursive:true});
    const file=join(root,'site/data/songs/G00001.json');await writeFile(file,'{}\n');
    git('add','.');git('commit','-m','fixture');checkGeneratedData(root);
    await writeFile(file,'{ "changed": true }\n');assert.throws(()=>checkGeneratedData(root));
    git('add','.');assert.throws(()=>checkGeneratedData(root));git('reset','--hard','HEAD');
    await rm(file);assert.throws(()=>checkGeneratedData(root));git('reset','--hard','HEAD');
    const extra=join(root,'site/data/songs/G00002.json');await writeFile(extra,'{}');assert.throws(()=>checkGeneratedData(root),/not committed/);
    await writeFile(join(root,'.gitignore'),'site/data/songs/G00002.json\n');assert.throws(()=>checkGeneratedData(root),/not committed/);
  } finally {await rm(root,{recursive:true,force:true});}
});

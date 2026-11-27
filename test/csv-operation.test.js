import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readValidatedCanonical } from '../src/canonical-reader.js';
import { loadCanonicalData } from '../src/canonical.js';
import { loadSongTables, generateSongCatalog } from '../src/song-catalog.js';
import { loadReviewCanonical } from '../src/prepare-reviews.js';
import { loadTitleIndex } from '../src/collector/match-existing.js';
import { aggregateCreatorRankings } from '../src/rankings.js';
import { parseHighWater, validateIdChanges, ID_MASTERS } from '../src/id-high-water.js';
import { validateIdDiff } from '../src/id-diff.js';
import { acquireGate, withCanonicalGate } from '../src/fn004-gate.js';
import { runCanonicalCli } from '../src/canonical-cli.js';
import { createBootstrapService } from '../src/fn004-bootstrap.js';
import { createDecisionService } from '../src/fn004-decision-application.js';
import { createApplyPlanService } from '../src/fn004-plan-application.js';
import { createApprovalRequestService } from '../src/fn004-approval-application.js';
import { createSuccessRecoveryService } from '../src/fn004-success-recovery.js';
import { createCanonicalManagementService } from '../src/fn004-management-application.js';
import { completeRow, writeCanonicalTables } from './fixtures/csv-edit.js';
import selectBase from '../.github/scripts/id-ci-base.cjs';
const sourceRoot = new URL('../',import.meta.url), exec = promisify(execFile);
const currentHighWater = parseHighWater(await readFile(new URL('data/id-high-water.json', sourceRoot)));
const testId = (namespace, offset = 1) => namespace + String(currentHighWater[namespace] + offset).padStart(5, '0');
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'csv-operation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await cp(new URL('data',sourceRoot),join(root,'data'),{recursive:true});return root;
}

test('all ordinary readers/generators ignore corrupt FN-004 state and gate; bytes remain identical',async t=>{
  const root=await fixture(t);
  await mkdir(join(root,'staging'));await writeFile(join(root,'staging/fn004-state.json'),'broken');
  await writeFile(join(root,'staging/fn004-bootstrap.json'),'broken');
  // A real FN-004 gate is under .git, but neither that path nor staging is input.
  const tables=(await readValidatedCanonical(root)).tables;
  assert.deepEqual(await loadReviewCanonical(root),tables);assert.ok((await loadTitleIndex(root)).size);
  assert.deepEqual(await loadSongTables(root),Object.fromEntries(['artists','works','songs','song_artists','creators','song_creators'].map(n=>[n,tables[n]])));
  const ranking=aggregateCreatorRankings(await loadCanonicalData(root),'G00001');
  for(const [path,value] of [['rankings/G00001.json',ranking],['songs/G00001.json',generateSongCatalog(tables)]]) {
    assert.equal(await readFile(new URL('site/data/'+path,sourceRoot),'utf8'),JSON.stringify(value,null,2)+'\n');
  }
  await writeFile(join(root,'data/releases.csv'),'invalid\n');
  for (const reader of [loadCanonicalData,loadSongTables,loadReviewCanonical,loadTitleIndex]) await assert.rejects(reader(root),/releases.csv/);
});

test('common reader rejects symlink and special paths before reading',async t=>{
  const root=await fixture(t),path=join(root,'data/creators.csv');await rm(path);await symlink('/dev/null',path);
  await assert.rejects(readValidatedCanonical(root),{code:'PATH_UNSAFE'});
});

test('ledger rejects missing/unknown namespaces, duplicates, invalid numbers and reservations',async t=>{
  const root=await fixture(t),tables=(await readValidatedCanonical(root)).tables,water=currentHighWater;
  for(const v of [{...water,C:water.C-1},{...water,C:water.C+1},{...water,C:String(water.C)},{...water,C:-1},{...water,C:1.1},{...water,C:100000},{C:water.C},{...water,X:0}]) {
    assert.throws(()=>validateIdChanges(tables,tables,water,v));
  }
  assert.throws(()=>parseHighWater(Buffer.from(`{"C":${water.C},"C":${water.C+1}}`)));
  assert.throws(()=>parseHighWater(Buffer.from('\ufeff{}')));
});

test('new song and creator added directly to CSV fixture pass validation, allocation and JSON generation',async t=>{
  const root=await fixture(t),base=(await readValidatedCanonical(root)).tables,tables=structuredClone(base);
  tables.creators.push(completeRow('creators',{creator_id:testId('C'),name:'New writer'}));
  tables.songs.push(completeRow('songs',{song_id:testId('J'),work_id:tables.works[0].work_id,title:'New song',version_type:'original'}));
  tables.song_artists.push(completeRow('song_artists',{song_id:testId('J'),artist_id:'G00001',role:'primary'}));
  tables.song_creators.push(completeRow('song_creators',{song_id:testId('J'),creator_id:testId('C'),role:'composition',credit_name:'New writer'}));
  const water={...currentHighWater,C:currentHighWater.C+1,J:currentHighWater.J+1};
  await writeCanonicalTables(root,tables);await writeFile(join(root,'data/id-high-water.json'),JSON.stringify(water));
  const after=(await readValidatedCanonical(root)).tables;
  const changes=validateIdChanges(base,after,currentHighWater,water);assert.equal(changes.additions.length,2);
  assert.ok(generateSongCatalog(after).works.some(w=>w.songs.some(s=>s.song_id===testId('J'))));
  const edited=structuredClone(after);edited.creators[0].name='Identity change requires review';
  assert.equal(validateIdChanges(after,edited,water,water).identity_review[0].id,edited.creators[0].creator_id);
  // Same provisional allocation from a second PR conflicts after the first merges.
  const second=structuredClone(after);second.creators.push(completeRow('creators',{creator_id:testId('C',2),name:'Other writer'}));
  assert.throws(()=>validateIdChanges(after,second,{...water,C:water.C+1},{...water,C:water.C+1}),/cannot be reused/);
});

test('all namespaces keep deleted confirmed IDs and consumed gaps unavailable',async t=>{
  const root=await fixture(t),base=(await readValidatedCanonical(root)).tables;
  for(const master of ID_MASTERS) {
    const prefix=master.columns.find(c=>c.name===master.primaryKey[0]).pattern;
    for(const n of Object.keys(currentHighWater).filter(n=>prefix.test(n+'00001'))) {
      const water={...currentHighWater,[n]:10},tables=structuredClone(base);
      tables[master.name]=[];const after=structuredClone(tables);
      after[master.name].push({[master.primaryKey[0]]:n+'00005'});
      assert.throws(()=>validateIdChanges(tables,after,water,water),/cannot be reused/);
    }
  }
});

test('archived CLI, service mutations and direct gate entry stop before effects even for malformed ledger',async t=>{
  const root=await fixture(t),before=await readFile(join(root,'data/songs.csv'));
  for(const ledger of ['{}','broken']) {
    await writeFile(join(root,'data/id-high-water.json'),ledger);
    const disabled={code:'LEGACY_OPERATION_DISABLED'};
    await assert.rejects(acquireGate({root}),disabled);
    await assert.rejects(withCanonicalGate({root,fn:()=>assert.fail('must not run')}),disabled);
    await assert.rejects(createDecisionService({root}).saveDecisionDraft({}),disabled);
    await assert.rejects(createApplyPlanService({root}).generateApplyPlan({decision_id:'unused'}),disabled);
    const status=await createBootstrapService().inspectBootstrapStatus({root}).catch(e=>e);
    assert.equal(status.code,'LEGACY_OPERATION_DISABLED');
    let output='';const stream={write:s=>{output+=s;}};
    const code=await runCanonicalCli(['apply','--json'],{root,output:stream,errorOutput:stream});
    assert.notEqual(code,0);assert.match(output,/LEGACY_OPERATION_DISABLED/);
    // Public management Apply and Recovery paths must also refuse before effects.
    const service=createCanonicalManagementService({root,actor:{id:'local:test',assurance:'local_process'}});
    await assert.rejects(service.inspectRecovery('unused'),disabled);
    await assert.rejects(service.runRecovery({transaction_id:'unused'}),disabled);
    await assert.rejects(createSuccessRecoveryService(root),disabled);
    const approval=createApprovalRequestService({root});
    await assert.rejects(approval.approveApplyPlan({}, {actor:{id:'local:test',assurance:'local_process'}}),disabled);
    assert.deepEqual(await readdir(root),['data']);
    assert.deepEqual(await readFile(join(root,'data/songs.csv')),before);
  }
});

test('event boundaries use the full push, preserve PR merge candidate and require explicit manual base',()=>{
  const base='1'.repeat(40),candidate='3'.repeat(40);
  for(const eventName of ['push','pull_request','workflow_dispatch']) {
    const payload=eventName==='push'?{before:base,after:candidate}:eventName==='pull_request'?{pull_request:{base:{ref:'main',sha:base},head:{sha:'2'.repeat(40)}}}:{inputs:{base_sha:base}};
    assert.deepEqual(selectBase({eventName,payload,sha:candidate,ref:'refs/heads/main'}),{base,candidate});
  }
  for(const before of [undefined,'0'.repeat(40),candidate,'bad']) assert.throws(()=>selectBase({eventName:'push',payload:{before,after:candidate},sha:candidate,ref:'refs/heads/main'}));
  assert.throws(()=>selectBase({eventName:'workflow_dispatch',payload:{},sha:candidate,ref:'refs/heads/main'}));
});

test('Git multi-commit boundary validates earlier ID edits, rejects non-ancestor and unknown migration baseline',async t=>{
  const root=await fixture(t);await exec('git',['init',root]);
  const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout.trim();
  await git('config','user.email','test@example.test');await git('config','user.name','Fixture');
  await git('add','data');await git('commit','-m','base');const base=await git('rev-parse','HEAD');
  await writeFile(join(root,'data/id-high-water.json'),JSON.stringify({...currentHighWater,C:currentHighWater.C+1}));
  await git('add','data');await git('commit','-m','invalid reservation');const middle=await git('rev-parse','HEAD');
  await writeFile(join(root,'note.txt'),'documentation');await git('add','note.txt');await git('commit','-m','docs only');const candidate=await git('rev-parse','HEAD');
  await assert.rejects(validateIdDiff({root,base,candidate}),new RegExp(`expected ${currentHighWater.C}\\b`));
  assert.equal((await validateIdDiff({root,base:middle,candidate})).additions.length,0);
  await assert.rejects(validateIdDiff({root,base:candidate,candidate:base}));
  await assert.rejects(validateIdDiff({root,base:candidate,candidate}));
  // A missing ledger is only permitted at the single fixed production migration SHA.
  await git('rm','data/id-high-water.json');await git('commit','-m','remove ledger');const noLedger=await git('rev-parse','HEAD');
  await writeFile(join(root,'note.txt'),'next');await git('add','note.txt');await git('commit','-m','next');
  await assert.rejects(validateIdDiff({root,base:noLedger,candidate:await git('rev-parse','HEAD')}),/missing ledger/);
});

test('real merge commit compares the previous main tree to merged candidate',async t=>{
  const root=await fixture(t);await exec('git',['init',root]);
  const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout.trim();
  await git('config','user.email','test@example.test');await git('config','user.name','Fixture');
  await git('add','data');await git('commit','-m','base');const initial=await git('rev-parse','HEAD');
  await git('checkout','-b','topic');await writeFile(join(root,'topic.txt'),'topic');await git('add','.');await git('commit','-m','topic');
  await git('checkout','-b','mainline',initial);await writeFile(join(root,'mainline.txt'),'mainline');await git('add','.');await git('commit','-m','mainline');const before=await git('rev-parse','HEAD');
  await git('merge','--no-ff','topic','-m','merge');const after=await git('rev-parse','HEAD');
  const result=await validateIdDiff({root,base:before,candidate:after});assert.deepEqual(result.additions,[]);
  await writeFile(join(root,'data/id-high-water.json'),'{}');
  await assert.rejects(validateIdDiff({root,base:before,candidate:after}));
});

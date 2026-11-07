import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {COMMIT_PATHS} from '../src/fn004-evidence-types.js';
import {command} from './fixtures/recovery-runtime.js';
import {createFailureRecoveryService} from '../src/fn004-failure-recovery.js';
import {createSuccessRecoveryService} from '../src/fn004-success-recovery.js';
import {createCanonicalApplyService as createApprovalRequestService} from '../src/fn004-apply-application.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';

describe('6E real initial dispatch process termination',{concurrency:2},()=>{
for(const [boundary,path,success,newEntities=false] of [
  ['owner:after','',false],['preparing:after','',false],['prepared:after','',false],
  ['consume:after','',false],
  ['replace_last:after','',true],['decided:after','',true],['history:after','',true],
  ['success_state:after','',true],['proof:after','',true],['completion:after','',true],
  ...COMMIT_PATHS.flatMap(path=>[['replace:before',path,false,true],['replace:after',path,path===COMMIT_PATHS.at(-1),true]])
])test(`6E SIGKILL ${boundary} ${path}: explicit Recovery preserves original Request`,{timeout:900000},async t=>{
  const f=await normalApplyFixture(t,{newEntities}),child=fork(new URL('./fixtures/normal-apply-child.js',import.meta.url),
    [f.root,JSON.stringify(f.payload),JSON.stringify(f.context),boundary,path],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',c=>stderr+=c);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(stderr);})]);
  assert.equal(message.boundary,boundary,JSON.stringify(message));
  const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
  const binding=message.binding,requestPath=join(f.root,`staging/apply-requests/${binding.request_id}.json`);
  const receipt=await fs.readFile(requestPath),stateBefore=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  const retry=createApprovalRequestService({root:f.root,execute:()=>{throw Error('retry redispatch');}});
  await assert.rejects(retry.submitApplyRequest(f.payload,f.context));
  assert.deepEqual(await fs.readFile(requestPath),receipt);
  const recovery=await (success?createSuccessRecoveryService:createFailureRecoveryService)(f.root);
  const observation=await recovery.inspect(binding);
  if(path==='data/songs.csv'&&boundary==='replace:after'){
    assert.equal((await readCanonicalSnapshot(f.root)).validation.ok,false);
    assert.ok(observation.diagnostics.some(d=>d.code==='CANONICAL_INVALID'));
    assert.ok(observation.diagnostics.some(d=>d.code==='PRIMARY_ARTIST_MISSING'));
    assert.deepEqual(observation.allowed_actions,['rollback']);
  }
  const result=await recovery.run({binding,command:command(binding,observation)});
  assert.equal(result.observation.readiness,'initialized');
  const after=await readCanonicalSnapshot(f.root);assert.equal(after.validation.ok,true);
  if(!success)assert.deepEqual(after.manifest,f.snapshot.manifest);
  const stateAfter=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  assert.deepEqual(stateAfter.high_water_marks,stateBefore.high_water_marks);
  assert.deepEqual(stateAfter.allocation_events,stateBefore.allocation_events);
  assert.equal(stateAfter.pending_transaction,null);
  const response=await retry.submitApplyRequest(f.payload,f.context);
  assert.equal(response.readiness,'initialized');assert.equal(response.result!==null,success);
  assert.deepEqual(await fs.readFile(requestPath),receipt);
  await readValidatedCanonicalSnapshot(f.root);
});
});

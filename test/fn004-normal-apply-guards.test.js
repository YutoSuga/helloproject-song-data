import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {createCanonicalApplyService as createApprovalRequestService} from '../src/fn004-apply-application.js';
import {hashState} from '../src/fn004-state.js';
import {withCanonicalGate,releaseGate,closeRetainedGate,acquireGate,assertGateOwnership} from '../src/fn004-gate.js';

for(const kind of ['candidate','Approval','canonical','state'])test(`6E rejects ${kind} before Receipt and execution`,async t=>{
  const f=await normalApplyFixture(t),write=(p,v)=>fs.writeFile(join(f.root,p),JSON.stringify(v));
  const before=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  if(kind==='candidate'){
    const candidates=structuredClone(f.candidates);candidates.candidates[0].title='external changed candidate';
    await write('staging/song-candidates.json',candidates);
  }
  if(kind==='Approval')await write(`staging/apply-approvals/${f.binding.approval_id}.json`,{});
  if(kind==='canonical')await fs.appendFile(join(f.root,'data/songs.csv'),'unknown');
  if(kind==='state'){
    const state=structuredClone(f.state);state.high_water_marks.W++;
    state.state_hash=hashState(state);await write('staging/fn004-state.json',state);
  }
  let executed=false;
  const service=createApprovalRequestService({root:f.root,execute:()=>{executed=true;throw Error('invalid inputs dispatched');}});
  await assert.rejects(service.submitApplyRequest(f.payload,f.context));assert.equal(executed,false);
  await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)),{code:'ENOENT'});
  if(kind!=='state')assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),before);
});

test('6E initial dispatch observes partial gate metadata fail-closed, without stealing or publishing a Receipt',async t=>{
  const f=await normalApplyFixture(t),before=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  let resume,created;
  const paused=new Promise(resolve=>{created=resolve;}),ready=new Promise(resolve=>{resume=resolve;});
  const io={...fs,open:async(p,...args)=>{
    const h=await fs.open(p,...args);
    if(p!==join(f.root,'staging/.fn004.lock')||args[0]!=='wx')return h;
    return new Proxy(h,{get(o,k){if(k==='writeFile')return async bytes=>{created();await ready;return o.writeFile(bytes);};
      const v=o[k];return typeof v==='function'?v.bind(o):v;}});
  }};
  const pending=acquireGate({root:f.root,io});await paused;
  try {
    const service=createApprovalRequestService({root:f.root,execute:()=>{throw Error('contender dispatched');}});
    await assert.rejects(service.submitApplyRequest(f.payload,f.context),error=>{
      assert.equal(error.code,'GATE_CORRUPT');assert.equal(error.cause.code,'PERSISTENCE_PARSE_FAILED');return true;
    });
    assert.equal((await fs.readFile(join(f.root,'staging/.fn004.lock'))).length,0);
    assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),before);
    await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)),{code:'ENOENT'});
  } finally {resume();await releaseGate(await pending);}
});

test('6E same-lease handoff releases once and never hides retained/release-failed outcomes',async t=>{
  const f=await normalApplyFixture(t);
  assert.equal(await withCanonicalGate({root:f.root,fn:async gate=>{await releaseGate(gate);return 'consumed';}}),'consumed');
  await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
  const cause=Object.assign(Error('directory sync failure'),{code:'EIO'});
  const io={...fs,unlink:async p=>{await fs.unlink(p);throw cause;}};
  await assert.rejects(withCanonicalGate({root:f.root,io,fn:async gate=>{
    try {await releaseGate(gate);}catch(error){assert.equal(error.cause,cause);}
    return 'caught release is not success';
  }}),error=>error.code==='GATE_RELEASE_FAILED'&&error.cause===cause);
  await assert.rejects(withCanonicalGate({root:f.root,fn:async gate=>{
    await assertGateOwnership(gate,f.root);await closeRetainedGate(gate);return 'retained';
  }}),{code:'RECOVERY_REQUIRED'});
  assert.ok(await fs.stat(join(f.root,'staging/.fn004.lock')));
});

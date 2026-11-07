import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {prepareFixture} from './fixtures/durable-prepare.js';
import {terminalProof,terminalCompletion} from '../src/fn004-failure-terminal.js';
import {createPersistence} from '../src/persistence.js';
import {withCanonicalGate} from '../src/fn004-gate.js';
import {inspectRuntimeState} from '../src/fn004-runtime-state.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';
import {requestPayloadProjectionV1} from '../src/fn004-approval-schema.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';
import {createApplyPlanService} from '../src/fn004-plan-application.js';

async function terminalFixture(t,{retainGate=false}={}){
  const f=await prepareFixture(t,{releaseGate:!retainGate});
  const proof=terminalProof({binding:f.binding,owner:f.owner,inputs:f.inputs,intent:null,
    chain:{head:null,entries:[]},authority:{gate:f.owner.payload.gate,recovery:null},ended_at:f.request.receipt.requested_at,histories:[]});
  for(const [path,value] of [[`staging/transaction-proofs/${f.binding.transaction_id}.json`,proof],
    [`staging/apply-requests/completions/${f.binding.request_id}.json`,terminalCompletion(proof)]]){
    await fs.mkdir(join(f.root,path.slice(0,path.lastIndexOf('/'))),{recursive:true});
    await fs.writeFile(join(f.root,path),JSON.stringify(value));
  }
  return f;
}
test('6E published Proof temp is cleanup evidence, never a second terminal record; unknown temp stays STOP',async t=>{
  const f=await terminalFixture(t),store=await createPersistence(f.root);
  const original=join(f.root,`staging/transaction-proofs/${f.binding.transaction_id}.json`);
  const temp=join(f.root,`staging/transaction-proofs/.fn004-${f.binding.transaction_id}.json.tmp-00000000-0000-4000-8000-000000000099`);
  const observe=()=>withCanonicalGate({root:f.root,fn:gate=>inspectRuntimeState(store,{gate})});
  assert.equal((await observe()).readiness,'initialized');
  await fs.copyFile(original,temp);assert.equal((await observe()).readiness,'cleanup_required');
  await fs.writeFile(temp,'{}');assert.equal((await observe()).readiness,'recovery_required');
  await fs.unlink(temp);assert.equal((await observe()).readiness,'initialized');
});
test('6E typed terminal proof read failure is not converted into a normal Request response',async t=>{
  const f=await terminalFixture(t),path=`staging/transaction-proofs/${f.binding.transaction_id}.json`;
  await fs.writeFile(join(f.root,path),'{');
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,{actor:f.binding.actor}),
    error=>error.code==='PERSISTENCE_PARSE_FAILED'&&error.path===path&&error.cause!==undefined);
});
test('S6E-H01: a failure Proof in a clone prohibits reissuing its missing Receipt even with unchanged Plan/state',async t=>{
  const f=await terminalFixture(t),state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  await fs.rm(join(f.root,`staging/transactions/${f.binding.transaction_id}`),{recursive:true});
  await fs.rm(join(f.root,'staging/apply-requests'),{recursive:true});
  const store=await createPersistence(f.root);
  const runtime=await withCanonicalGate({root:f.root,fn:gate=>inspectRuntimeState(store,{gate})});
  assert.equal(runtime.readiness,'initialized');
  await assert.rejects(createCanonicalApplyService({root:f.root}).submitApplyRequest(requestPayloadProjectionV1(f.request),
    {actor:f.binding.actor}),{code:'RECOVERY_REQUIRED'});
  await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${f.binding.request_id}.json`)),{code:'ENOENT'});
  await assert.rejects(fs.stat(join(f.root,`staging/transactions/${f.binding.transaction_id}/owner.json`)),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
});
test('6E unrelated Plan corruption stays a typed integrity error rather than a blocked normal response',async t=>{
  const f=await terminalFixture(t),path=`staging/apply-plans/ap_${'f'.repeat(64)}.json`;
  const request=await fs.readFile(join(f.root,`staging/apply-requests/${f.binding.request_id}.json`));
  await fs.writeFile(join(f.root,path),JSON.stringify({schema_version:1}));
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,{actor:f.binding.actor}),
    {code:'PLAN_INTEGRITY_CONFLICT'});
  assert.deepEqual(await fs.readFile(join(f.root,`staging/apply-requests/${f.binding.request_id}.json`)),request);
});
test('S6E-M06: the original gate remains cleanup work; a fresh reader lease is not that old gate',async t=>{
  const f=await terminalFixture(t,{retainGate:true}),store=await createPersistence(f.root);
  const before=await inspectRuntimeState(store,{gate:f.gate});assert.equal(before.readiness,'cleanup_required');
  await assert.rejects(readValidatedCanonicalSnapshot(f.root,{gate:f.gate}),{code:'RECOVERY_REQUIRED'});
  await assert.rejects(createApplyPlanService({root:f.root}).checkApplyPlan(f.plan.plan_id,{gate:f.gate}),{code:'RECOVERY_REQUIRED'});
  await f.releaseFixtureGate();
  const after=await withCanonicalGate({root:f.root,fn:gate=>inspectRuntimeState(store,{gate})});
  assert.equal(after.readiness,'initialized');await readValidatedCanonicalSnapshot(f.root);
});
test('S6E-M08: immutable Request conflict/corruption precedes unresolved publisher work',async t=>{
  const f=await terminalFixture(t),path=join(f.root,`staging/apply-requests/${f.binding.request_id}.json`);
  const original=await fs.readFile(path),temp=join(f.root,`staging/apply-requests/.fn004-${f.binding.request_id}.json.tmp-00000000-0000-4000-8000-000000000099`);
  await fs.copyFile(path,temp);
  let dispatched=false;
  const service=createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry allocated time');},execute:()=>{dispatched=true;}});
  const payload=requestPayloadProjectionV1(f.request),actor={...payload.actor,id:'local:other'};
  await assert.rejects(service.submitApplyRequest({...payload,actor},{actor}),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(service.submitApplyRequest(payload,{actor:payload.actor}),{code:'RECOVERY_REQUIRED'});
  assert.equal(dispatched,false);assert.deepEqual(await fs.readFile(path),original);
  await fs.writeFile(path,'{}');
  await assert.rejects(service.checkApplyRequest(f.binding.request_id,{actor:payload.actor}),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(service.getApplyRequest(f.binding.request_id,{actor:payload.actor}),{code:'INTEGRITY_CONFLICT'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {approvalFixture} from './fixtures/approval-runtime.js';
import {syntheticSuccess} from './fixtures/history-success.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {approvalHash,newInvalidationId,newRequestId,receiptHash,requestPayloadHash,requestPayloadProjectionV1} from '../src/fn004-approval-schema.js';
import {hashCanonicalJson} from '../src/canonical-hash.js';
import {hashState} from '../src/fn004-state.js';
import {validateHistoryRecord} from '../src/fn004-history-record.js';
import {withCanonicalGate} from '../src/fn004-gate.js';

const write=(path,value)=>fs.writeFile(path,JSON.stringify(value));
const requestFile=f=>join(f.root,'staging/apply-requests',`${f.payload.request_id}.json`);
function dto(response) {
 assert.deepEqual(Object.keys(response).sort(),['artifact','diagnostics','readiness','result']);
 for(const diagnostic of response.diagnostics)assert.deepEqual(Object.keys(diagnostic),['code']);
 const codes=response.diagnostics.map(d=>d.code);
 assert.deepEqual(codes,[...new Set(codes)].sort());
}
async function retryAndCheck(f,service=f.service) {
 const retry=await service.submitApplyRequest(f.payload,f.context);
 dto(retry);
 assert.deepEqual(await service.checkApplyRequest(f.payload.request_id,f.context),retry);
 return retry;
}
function successFor(f,artifact) {
 const {record:r}=syntheticSuccess(f),p=f.plan,e=artifact.receipt;
 r.decision_snapshot=f.decision;r.plan_snapshot=p;
 Object.assign(r.payload,{decision:p.payload.decision.identity,plan:{plan_id:p.plan_id,plan_hash:p.plan_hash},
  apply_id:e.apply_id,transaction_id:e.transaction_id,actor:e.actor,
  approval:{approval_id:e.approval_id,approval_hash:e.approval_hash},
  request:{request_id:e.request_id,request_payload_hash:e.request_payload_hash}});
 r.payload.results=p.payload.operations.map(o=>{
  const row=Object.fromEntries(Object.entries(o.result.existing_row??o.result.row_template).map(([k,v])=>[k,typeof v==='object'?r.payload.apply_time:v]));
  return {operation_id:o.operation_id,classification:o.classification,table:o.table,key:o.key,row,row_hash:hashCanonicalJson({table:o.table,row})};
 });
 const consumed=r.payload.state_transition.consumed;
 consumed.pending_transaction=e.transaction_id;consumed.state_hash=hashState(consumed);
 validateAndSeal(r);
 return r;
}
function validateAndSeal(r) {r.record_hash=hashCanonicalJson(r.payload);validateHistoryRecord(r);}
async function installSuccess(f,r,{pending=false}={}) {
 const state=structuredClone(r.payload.state_transition.consumed);
 state.generation++;state.pending_transaction=pending?r.payload.transaction_id:null;
 state.history={count:r.payload.sequence,head_hash:r.record_hash,last_apply_id:r.payload.apply_id};state.state_hash=hashState(state);
 const directory=join(f.root,'staging/apply-history');await fs.mkdir(directory,{recursive:true});
 await write(join(directory,`${r.payload.apply_id}.json`),r);
 await write(join(f.root,'staging/fn004-state.json'),state);
}

test('initial publication and same-payload retry return the closed current DTO without rewriting or generating time/IDs',async t=>{
 const f=await approvalFixture(t),response=await f.service.submitApplyRequest(f.payload,f.context);dto(response);
 const bytes=await fs.readFile(requestFile(f));
 assert.deepEqual(response.artifact,JSON.parse(bytes));
 assert.equal(response.readiness,'recovery_required');
 assert.deepEqual(response.diagnostics,[{code:'RECOVERY_REQUIRED'}]);assert.equal(response.result,null);
 const readonly=createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry allocated time');},io:{...fs,link:async()=>{throw Error('retry published');},rename:async()=>{throw Error('retry replaced');}}});
 assert.deepEqual(await retryAndCheck(f,readonly),response);
 assert.deepEqual(await readonly.getApplyRequest(f.payload.request_id,f.context),response.artifact);
 assert.deepEqual(await fs.readFile(requestFile(f)),bytes);
 assert.deepEqual(await fs.readdir(join(f.root,'staging/apply-requests')),[`${f.payload.request_id}.json`]);
 await assert.rejects(fs.stat(join(f.root,'staging/transactions')),{code:'ENOENT'});
 await assert.rejects(readonly.submitApplyRequest({...f.payload,repository_instance_id:`repo_${newRequestId()}`},f.context),{code:'INTEGRITY_CONFLICT'});
});

test('pending and changed candidates retain original Receipt and report recovery rather than infer stale Plan',async t=>{
 const f=await approvalFixture(t),initial=await f.service.submitApplyRequest(f.payload,f.context),bytes=await fs.readFile(requestFile(f));
 const state={...f.state,pending_transaction:initial.artifact.receipt.transaction_id};state.state_hash=hashState(state);
 await write(join(f.root,'staging/fn004-state.json'),state);
 const candidates=structuredClone(f.candidates);candidates.candidates[0].title='changed after acceptance';await write(join(f.root,'staging/song-candidates.json'),candidates);
 const retry=await retryAndCheck(f);
 assert.deepEqual(retry.artifact,initial.artifact);assert.equal(retry.readiness,'recovery_required');assert.equal(retry.result,null);
 assert.ok(retry.diagnostics.some(d=>d.code==='RECOVERY_REQUIRED'));
 assert.ok(!retry.diagnostics.some(d=>d.code==='STALE_PLAN'));
 assert.deepEqual(await fs.readFile(requestFile(f)),bytes);
});

test('post-accept invalidation is a sorted current diagnostic, not cancellation; original bytes and live lease retained',async t=>{
 const f=await approvalFixture(t),initial=await f.service.submitApplyRequest(f.payload,f.context),bytes=await fs.readFile(requestFile(f));
 await f.service.invalidateApproval({event_id:newInvalidationId(),approval_id:f.approval.approval_id,approval_hash:approvalHash(f.approval),reason:'stop future acceptance'},f.context);
 await withCanonicalGate({root:f.root,fn:async gate=>{
  const retry=await f.service.submitApplyRequest(f.payload,{...f.context,gate});
  assert.deepEqual(await f.service.checkApplyRequest(f.payload.request_id,{...f.context,gate}),retry);
  assert.deepEqual(retry.artifact,initial.artifact);
  assert.deepEqual(retry.diagnostics,[{code:'APPROVAL_INVALIDATED'},{code:'RECOVERY_REQUIRED'}]);
 }});
 assert.deepEqual(await fs.readFile(requestFile(f)),bytes);
 await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
});

test('verified successful History returns only its exact reference while runtime remains recovery_required',async t=>{
 for(const pending of [false,true]) {
  const f=await approvalFixture(t),initial=await f.service.submitApplyRequest(f.payload,f.context),bytes=await fs.readFile(requestFile(f));
  const r=successFor(f,initial.artifact);await installSuccess(f,r,{pending});
  const historyFile=join(f.root,'staging/apply-history',`${r.payload.apply_id}.json`),before=await fs.readFile(historyFile);
  const retry=await retryAndCheck(f);
  assert.deepEqual(retry.artifact,initial.artifact);assert.equal(retry.readiness,'recovery_required');
  assert.deepEqual(retry.result,{apply_id:r.payload.apply_id,record_hash:r.record_hash});
  assert.ok(retry.diagnostics.some(d=>d.code==='ALREADY_APPLIED'));assert.ok(retry.diagnostics.some(d=>d.code==='RECOVERY_REQUIRED'));
  if(pending)assert.ok(retry.diagnostics.some(d=>d.code==='STATE_TRANSITION_PROOF_REQUIRED'));
  assert.deepEqual(await fs.readFile(requestFile(f)),bytes);assert.deepEqual(await fs.readFile(historyFile),before);
 }
});

test('self-consistent History with wrong Receipt binding and corrupt History never become successful responses',async t=>{
 const f=await approvalFixture(t),initial=await f.service.submitApplyRequest(f.payload,f.context),original=successFor(f,initial.artifact);
 for(const mutate of [r=>r.payload.request.request_id=newRequestId(),r=>r.payload.request.request_payload_hash='0'.repeat(64),r=>r.payload.approval.approval_id=`apr_${newRequestId()}`,r=>r.payload.approval.approval_hash='0'.repeat(64),r=>r.payload.actor.id='local:other']) {
  const r=structuredClone(original);mutate(r);validateAndSeal(r);await installSuccess(f,r);
  await assert.rejects(f.service.submitApplyRequest(f.payload,f.context),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(f.service.checkApplyRequest(f.payload.request_id,f.context),{code:'INTEGRITY_CONFLICT'});
 }
 const r=structuredClone(original);r.record_hash='0'.repeat(64);await installSuccess(f,r);
 await assert.rejects(f.service.submitApplyRequest(f.payload,f.context),{code:'HISTORY_CORRUPT'});
 await assert.rejects(f.service.checkApplyRequest(f.payload.request_id,f.context),{code:'HISTORY_CORRUPT'});
});

test('post-publication evaluation failure retains the original durable artifact for same-ID retry',async t=>{
 const f=await approvalFixture(t);let published=false;
 const service=createApprovalRequestService({root:f.root,io:{...fs,
  link:async(...args)=>{await fs.link(...args);published=true;},
  readFile:async(file,...args)=>{
   if(published && String(file).endsWith('fn004-bootstrap.json'))throw Object.assign(Error('evaluation read failed'),{code:'EIO'});
   return fs.readFile(file,...args);
  }
 }});
 await assert.rejects(service.submitApplyRequest(f.payload,f.context),{code:'PERSISTENCE_READ_FAILED'});
 assert.ok(published);
 const bytes=await fs.readFile(requestFile(f)),artifact=JSON.parse(bytes);
 const retry=await retryAndCheck(f,createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry regenerated');}}));
 assert.deepEqual(retry.artifact,artifact);assert.deepEqual(await fs.readFile(requestFile(f)),bytes);
 await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
});

test('corrupt Request, Receipt tamper, wrong receipt_hash and self-consistent cross-repository Receipt stay integrity errors',async t=>{
 const f=await approvalFixture(t),initial=await f.service.submitApplyRequest(f.payload,f.context),original=initial.artifact;
 const badRepo=structuredClone(original);badRepo.receipt.repository_instance_id=`repo_${newRequestId()}`;
 badRepo.receipt.request_payload_hash=requestPayloadHash(requestPayloadProjectionV1(badRepo));badRepo.receipt_hash=receiptHash(badRepo);
 for(const bad of [{},{...original,receipt_hash:'0'.repeat(64)},{...original,receipt:{...original.receipt,requested_at:'2026-10-20T00:00:00Z'}},badRepo]) {
  await write(requestFile(f),bad);
  await assert.rejects(f.service.submitApplyRequest(f.payload,f.context),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(f.service.checkApplyRequest(f.payload.request_id,f.context),{code:'INTEGRITY_CONFLICT'});
 }
});

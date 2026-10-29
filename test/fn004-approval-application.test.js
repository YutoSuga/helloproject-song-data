import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {approvalFixture,actor,execute} from './fixtures/approval-runtime.js';
import {newApprovalId,newInvalidationId,newRequestId,approvalHash,receiptHash,requestPayloadHash,requestPayloadProjectionV1} from '../src/fn004-approval-schema.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {createFn004Repository} from '../src/fn004-repository.js';
import {withCanonicalGate} from '../src/fn004-gate.js';
import {hashState} from '../src/fn004-state.js';
import {CANONICAL_TABLES} from '../src/canonical-schema.js';
const submitArtifact=async(service,payload,context)=>(await service.submitApplyRequest(payload,context)).artifact;
const inv=f=>({event_id:newInvalidationId(),approval_id:f.approval.approval_id,approval_hash:approvalHash(f.approval),reason:'  明示的な失効  '});
const path=(f,part)=>join(f.root,'staging',part);
const requestFile=f=>path(f,`apply-requests/${f.payload.request_id}.json`);
const approvalFile=f=>path(f,`apply-approvals/${f.approval.approval_id}.json`);
const write=(file,v)=>fs.writeFile(file,JSON.stringify(v));

test('create/read/check Approval and immutable full-content persistence; protected inputs unchanged after acceptance',async t=>{
 const f=await approvalFixture(t),files=[...CANONICAL_TABLES.map(t=>join(f.root,t.path)),...['fn004-bootstrap.json','fn004-state.json','decisions.json','song-candidates.json'].map(n=>path(f,n))];
 const before=await Promise.all(files.map(p=>fs.readFile(p)));
 assert.deepEqual(await f.service.getApproval(f.approval.approval_id,f.context),f.approval);
 assert.equal((await f.service.checkApproval(f.approval.approval_id,f.context)).status,'APPLICABLE');
 const replay=createApprovalRequestService({root:f.root,clock:()=>{throw Error('Clock must not run');}});
 assert.deepEqual(await replay.approveApplyPlan(f.command,f.context),f.approval);
 await assert.rejects(f.service.approveApplyPlan({...f.command,intended_request_id:newRequestId()},f.context),{code:'INTEGRITY_CONFLICT'});
 const repo=await createFn004Repository(f.root);
 await withCanonicalGate({root:f.root,fn:async gate=>{
  assert.deepEqual(await repo.saveApproval(f.approval,{gate}),f.approval);
  await assert.rejects(repo.saveApproval({...f.approval,approved_at:'2026-10-26T00:00:00Z'},{gate}),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(repo.writeJsonAtomic(`staging/apply-approvals/${f.approval.approval_id}.json`,f.approval,{gate}),{code:'PATH_UNSAFE'});
 }});
 const e=await submitArtifact(f.service,f.payload,f.context);
 assert.deepEqual(e.processing,{state:'accepted',journal_ref:null,history_ref:null,diagnostic_code:null});
 assert.deepEqual(await f.service.getApplyRequest(f.payload.request_id,f.context),e);
 assert.deepEqual(await Promise.all(files.map(p=>fs.readFile(p))),before);
 assert.deepEqual(await fs.readdir(path(f,'apply-requests')),[`${f.payload.request_id}.json`]);
 await assert.rejects(fs.stat(path(f,'transactions')),{code:'ENOENT'});
 await assert.rejects(fs.stat(path(f,'.fn004.lock')),{code:'ENOENT'});
});
test('same semantic retry retains receipt bytes, timestamps and IDs after pending/stale and post-acceptance invalidation',async t=>{
 const f=await approvalFixture(t),e=await submitArtifact(f.service,f.payload,f.context),before=await fs.readFile(requestFile(f));
 const i=await f.service.invalidateApproval(inv(f),f.context);
 assert.deepEqual(i.accepted_request,{request_id:e.receipt.request_id,receipt_hash:e.receipt_hash});
 assert.deepEqual(await fs.readFile(requestFile(f)),before);
 const state={...f.state,pending_transaction:e.receipt.transaction_id};state.state_hash=hashState(state);await write(path(f,'fn004-state.json'),state);
 const candidates=structuredClone(f.candidates);candidates.candidates[0].title='changed';await write(path(f,'song-candidates.json'),candidates);
 const service=createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry regenerated time');}});
 assert.deepEqual(await submitArtifact(service,f.payload,f.context),e);
 assert.deepEqual(await fs.readFile(requestFile(f)),before);
});
test('different semantic payload is a conflict before new preconditions; never overwrites or allocates',async t=>{
 const f=await approvalFixture(t),e=await submitArtifact(f.service,f.payload,f.context),before=await fs.readFile(requestFile(f));
 const service=createApprovalRequestService({root:f.root,clock:()=>{throw Error('time allocated');}});
 for(const changed of [{...f.payload,plan_hash:'0'.repeat(64),plan_id:`ap_${'0'.repeat(64)}`},{...f.payload,approval_id:newApprovalId()},{...f.payload,actor:{...actor,id:'local:other'}}])await assert.rejects(submitArtifact(service,changed,{actor:changed.actor}),{code:'INTEGRITY_CONFLICT'});
 assert.deepEqual(await fs.readFile(requestFile(f)),before);assert.deepEqual(await submitArtifact(service,f.payload,f.context),e);
});
test('pre-acceptance invalidation is permanent OR, duplicate-safe and rejects new Request',async t=>{
 const f=await approvalFixture(t),cmd=inv(f),e=await f.service.invalidateApproval(cmd,f.context);assert.equal(e.accepted_request,null);
 const replay=createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry clock');}});
 assert.deepEqual(await replay.invalidateApproval(cmd,f.context),e);
 await assert.rejects(f.service.invalidateApproval({...cmd,reason:'different'},f.context),{code:'INTEGRITY_CONFLICT'});
 await f.service.invalidateApproval({...cmd,event_id:newInvalidationId()},f.context);
 await f.service.invalidateApproval({...cmd,event_id:newInvalidationId(),reason:'another'}, {actor:{...actor,id:'local:second'}});
 assert.equal((await f.service.getApprovalInvalidations(f.context)).length,3);
 await assert.rejects(f.service.checkApproval(f.approval.approval_id,f.context),{code:'APPROVAL_INVALIDATED'});
 await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'APPROVAL_INVALIDATED'});
 await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
});
test('Invalidation exact target, missing and corrupt Approval fail closed',async t=>{
 const f=await approvalFixture(t);
 await assert.rejects(f.service.invalidateApproval({...inv(f),approval_hash:'0'.repeat(64)},f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(f.service.invalidateApproval({...inv(f),approval_id:newApprovalId()},f.context),{code:'INTEGRITY_CONFLICT'});
 await write(approvalFile(f),{...f.approval,extra:true});
 await assert.rejects(f.service.invalidateApproval(inv(f),f.context),{code:'INTEGRITY_CONFLICT'});
});
test('global scan rejects unrelated corrupt events, tracked deletions, unknown entries and filenames',async t=>{
 const f=await approvalFixture(t),event=await f.service.invalidateApproval(inv(f),f.context),dir=path(f,'apply-approvals/invalidations'),file=join(dir,`${event.event_id}.json`);
 for(const bad of [{...event,schema_version:2},{...event,approval_id:newApprovalId()},{...event,repository_instance_id:`repo_${newRequestId()}`},{...event,event_id:newInvalidationId()}]){
  await write(file,bad);await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
 }
 await write(file,event);await fs.writeFile(join(dir,'unknown.tmp'),'x');await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});await fs.unlink(join(dir,'unknown.tmp'));
 await execute('git',['-C',f.root,'add','staging/apply-approvals/invalidations']);await fs.unlink(file);
 await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
});
test('post-acceptance Receipt reference missing/tampered and null-event coexistence never become ordinary invalidation',async t=>{
 const f=await approvalFixture(t),e=await submitArtifact(f.service,f.payload,f.context),i=await f.service.invalidateApproval(inv(f),f.context),file=path(f,`apply-approvals/invalidations/${i.event_id}.json`);
 await fs.unlink(requestFile(f));await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'RECOVERY_REQUIRED'});
 await write(requestFile(f),e);await write(file,{...i,accepted_request:{...i.accepted_request,receipt_hash:'0'.repeat(64)}});await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
 await write(file,{...i,accepted_request:null});await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'INTEGRITY_CONFLICT'});
});
test('strict JSON failures and filename binding are checked on readonly load',async t=>{
 const f=await approvalFixture(t);
 for(const bytes of [Buffer.from('{"schema_version":1,"schema_version":1}'),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(f.approval))]),Buffer.from([0xff]),Buffer.from('{}')]){await fs.writeFile(approvalFile(f),bytes);await assert.rejects(f.service.getApproval(f.approval.approval_id,f.context),{code:'INTEGRITY_CONFLICT'});}
 await write(approvalFile(f),{...f.approval,approval_id:newApprovalId()});await assert.rejects(f.service.getApproval(f.approval.approval_id,f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(f.service.getApproval('../escape',f.context),{code:'PATH_UNSAFE'});
});
test('new Approval/Request reject stale Plan and pending; retry precedence is independent',async t=>{
 const f=await approvalFixture(t),state={...f.state,pending_transaction:`tx_${newRequestId()}`};state.state_hash=hashState(state);await write(path(f,'fn004-state.json'),state);
 await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'RECOVERY_REQUIRED'});
 await assert.rejects(f.service.approveApplyPlan({...f.command,approval_id:newApprovalId()},f.context),{code:'RECOVERY_REQUIRED'});
 await write(path(f,'fn004-state.json'),f.state);const candidates=structuredClone(f.candidates);candidates.candidates[0].title='changed';await write(path(f,'song-candidates.json'),candidates);
 await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'STALE_PLAN'});
 await assert.rejects(f.service.approveApplyPlan({...f.command,approval_id:newApprovalId()},f.context),{code:'STALE_PLAN'});
});
test('Request binding mismatches reject without publication',async t=>{
 const f=await approvalFixture(t);
 for(const bad of [{...f.payload,approval_hash:'0'.repeat(64)},{...f.payload,repository_instance_id:`repo_${newRequestId()}`},{...f.payload,decision:{...f.payload.decision,content_hash:'0'.repeat(64)}},{...f.payload,request_id:newRequestId()},{...f.payload,actor:{...actor,id:'local:other'}}])await assert.rejects(submitArtifact(f.service,bad,{actor:bad.actor}),{code:'APPROVAL_PLAN_MISMATCH'});
 await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
});
test('common live lease supports both operations without nested acquisition and defines both race orders',async t=>{
 const f=await approvalFixture(t);
 await withCanonicalGate({root:f.root,fn:async gate=>{
  const context={actor,gate};await f.service.checkApproval(f.approval.approval_id,context);
  const e=await submitArtifact(f.service,f.payload,context),i=await f.service.invalidateApproval(inv(f),context);
  assert.equal(i.accepted_request.receipt_hash,e.receipt_hash);
 }});
 const g=await approvalFixture(t);
 await withCanonicalGate({root:g.root,fn:async gate=>{
  await g.service.invalidateApproval(inv(g),{actor,gate});await assert.rejects(submitArtifact(g.service,g.payload,{actor,gate}),{code:'APPROVAL_INVALIDATED'});
 }});
});
test('parallel double-click returns one receipt or BUSY, subsequent same-ID retry is original; different payload never wins twice',async t=>{
 const f=await approvalFixture(t),results=await Promise.allSettled([submitArtifact(f.service,f.payload,f.context),submitArtifact(f.service,f.payload,f.context)]);
 const accepted=results.filter(r=>r.status==='fulfilled');assert.ok(accepted.length>=1);
 for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'GATE_BUSY');
 const retry=await submitArtifact(f.service,f.payload,f.context);for(const r of accepted)assert.deepEqual(r.value,retry);
 const altered={...f.payload,actor:{...actor,id:'local:other'}};await assert.rejects(submitArtifact(f.service,altered,{actor:altered.actor}),{code:'INTEGRITY_CONFLICT'});
});
test('publication failures retain typed phase/evidence and do not mutate protected files',async t=>{
 const f=await approvalFixture(t),before=await fs.readFile(path(f,'fn004-state.json'));
 const broken=createApprovalRequestService({root:f.root,io:{...fs,link:async()=>{throw Error('injected publication failure');}}});
 await assert.rejects(submitArtifact(broken,f.payload,f.context),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='publish'&&!e.published);
 assert.deepEqual(await fs.readFile(path(f,'fn004-state.json')),before);await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
 await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'RECOVERY_REQUIRED'});
});

test('actual concurrent Request/Invalidation and conflicting-submit races retain one serializable outcome',async t=>{
 for(let n=0;n<2;n++){
  const f=await approvalFixture(t),cmd=inv(f),results=await Promise.allSettled(n===0?[submitArtifact(f.service,f.payload,f.context),f.service.invalidateApproval(cmd,f.context)]:[f.service.invalidateApproval(cmd,f.context),submitArtifact(f.service,f.payload,f.context)]);
  for(const r of results)if(r.status==='rejected')assert.ok(['GATE_BUSY','APPROVAL_INVALIDATED'].includes(r.reason.code));
  const receipt=await fs.readFile(requestFile(f),'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
  if(receipt){const event=await f.service.invalidateApproval(cmd,f.context);assert.equal(event.accepted_request.receipt_hash,receipt.receipt_hash);assert.deepEqual(await submitArtifact(f.service,f.payload,f.context),receipt);}
  else {const events=await f.service.getApprovalInvalidations(f.context);assert.ok(events.length);assert.equal(events[0].accepted_request,null);await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'APPROVAL_INVALIDATED'});}
 }
 const f=await approvalFixture(t),different={...f.payload,actor:{...actor,id:'local:different'}};
 const results=await Promise.allSettled([submitArtifact(f.service,f.payload,f.context),submitArtifact(f.service,different,{actor:different.actor})]);
 for(const r of results)if(r.status==='rejected')assert.ok(['GATE_BUSY','APPROVAL_PLAN_MISMATCH','INTEGRITY_CONFLICT'].includes(r.reason.code));
 const receipt=await submitArtifact(f.service,f.payload,f.context);assert.equal(receipt.receipt.actor.id,actor.id);
 await assert.rejects(submitArtifact(f.service,different,{actor:different.actor}),{code:'INTEGRITY_CONFLICT'});
});
test('file-sync and post-publication cleanup failures retain evidence and cannot become successful retry',async t=>{
 for(const phase of ['file_sync','temp_cleanup']){
  const f=await approvalFixture(t),io={...fs};
  if(phase==='temp_cleanup')io.unlink=async()=>{throw Error('cleanup failure');};
  else io.open=async(file,...args)=>{const h=await fs.open(file,...args);return new Proxy(h,{get(target,key){if(key==='sync'&&file.includes('.tmp-'))return async()=>{throw Error('sync failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});};
  const broken=createApprovalRequestService({root:f.root,io});
  await assert.rejects(submitArtifact(broken,f.payload,f.context),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase===phase&&e.published===(phase==='temp_cleanup'));
  await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'RECOVERY_REQUIRED'});
 }
});

import {syntheticSuccess} from './fixtures/history-success.js';
import {hashCanonicalJson} from '../src/canonical-hash.js';
import {validateHistoryRecord} from '../src/fn004-history-record.js';
test('successful History precheck prevents Approval and Request acceptance without modifying History proof',async t=>{
 const f=await approvalFixture(t),success=syntheticSuccess(f),r=success.record,p=f.plan;
 r.decision_snapshot=f.decision;r.plan_snapshot=p;r.payload.decision=p.payload.decision.identity;r.payload.plan={plan_id:p.plan_id,plan_hash:p.plan_hash};
 r.payload.results=p.payload.operations.map(o=>{const row=Object.fromEntries(Object.entries(o.result.existing_row??o.result.row_template).map(([k,v])=>[k,typeof v==='object'?r.payload.apply_time:v]));return {operation_id:o.operation_id,classification:o.classification,table:o.table,key:o.key,row,row_hash:hashCanonicalJson({table:o.table,row})};});
 r.payload.request={request_id:f.payload.request_id,request_payload_hash:requestPayloadHash(f.payload)};r.payload.approval={approval_id:f.approval.approval_id,approval_hash:approvalHash(f.approval)};
 r.record_hash=hashCanonicalJson(r.payload);success.terminal.history.head_hash=r.record_hash;success.terminal.state_hash=hashState(success.terminal);validateHistoryRecord(r);
 await fs.mkdir(path(f,'apply-history'));await write(path(f,`apply-history/${r.payload.apply_id}.json`),r);await write(path(f,'fn004-state.json'),success.terminal);
 await assert.rejects(submitArtifact(f.service,f.payload,f.context),{code:'ALREADY_APPLIED'});
 await assert.rejects(f.service.approveApplyPlan({...f.command,approval_id:newApprovalId()},f.context),{code:'ALREADY_APPLIED'});
 // Static Invalidation is permitted for used approvals; no Receipt can be
 // invented for a History proving acceptance whose local original is missing.
 await assert.rejects(f.service.invalidateApproval(inv(f),f.context),{code:'RECOVERY_REQUIRED'});
});

test('unrelated Approval cannot bypass a corrupt event; known untracked event deletion never restores validity',async t=>{
 const f=await approvalFixture(t),other=await f.service.approveApplyPlan({...f.command,approval_id:newApprovalId(),intended_request_id:newRequestId()},f.context);
 const event=await f.service.invalidateApproval(inv(f),f.context),file=path(f,`apply-approvals/invalidations/${event.event_id}.json`);
 await write(file,{...event,extra:1});await assert.rejects(f.service.checkApproval(other.approval_id,f.context),{code:'INTEGRITY_CONFLICT'});
 await fs.unlink(file);await assert.rejects(f.service.checkApproval(other.approval_id,f.context),{code:'INTEGRITY_CONFLICT'});
});
test('Request check reports recovery readiness without altering receipt or deriving success from processing',async t=>{
 const f=await approvalFixture(t),receipt=await submitArtifact(f.service,f.payload,f.context),checked=await f.service.checkApplyRequest(f.payload.request_id,f.context);
 assert.deepEqual(checked.artifact,receipt);assert.notEqual(checked.readiness,'initialized');assert.ok(checked.diagnostics.some(d=>d.code==='RECOVERY_REQUIRED'));
});

test('accepted_request creation rejects another Approval receipt for the same Plan and intended Request',async t=>{
 const f=await approvalFixture(t),b=await f.service.approveApplyPlan({...f.command,approval_id:newApprovalId()},f.context);
 assert.equal(b.plan_id,f.approval.plan_id);assert.equal(b.intended_request_id,f.approval.intended_request_id);
 assert.notEqual(b.approval_id,f.approval.approval_id);assert.notEqual(approvalHash(b),approvalHash(f.approval));
 const receipt=await submitArtifact(f.service,f.payload,f.context);
 const command={...inv(f),approval_id:b.approval_id,approval_hash:approvalHash(b)};
 await assert.rejects(f.service.invalidateApproval(command,f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(fs.stat(path(f,`apply-approvals/invalidations/${command.event_id}.json`)),{code:'ENOENT'});
 const valid=await f.service.invalidateApproval(inv(f),f.context);
 assert.deepEqual(valid.accepted_request,{request_id:receipt.receipt.request_id,receipt_hash:receipt.receipt_hash});
 assert.deepEqual(await f.service.getApprovalInvalidation(valid.event_id,f.context),valid);
});

test('accepted_request global scan rejects a stored event bound to another valid Approval receipt',async t=>{
 const f=await approvalFixture(t),b=await f.service.approveApplyPlan({...f.command,approval_id:newApprovalId()},f.context);
 const receipt=await submitArtifact(f.service,f.payload,f.context);
 const event={schema_version:1,event_id:newInvalidationId(),repository_instance_id:b.repository_instance_id,approval_id:b.approval_id,approval_hash:approvalHash(b),reason:'wrong Approval receipt',actor,invalidated_at:'2026-10-29T00:00:00Z',accepted_request:{request_id:receipt.receipt.request_id,receipt_hash:receipt.receipt_hash}};
 const dir=path(f,'apply-approvals/invalidations');await fs.mkdir(dir,{recursive:true});await write(join(dir,`${event.event_id}.json`),event);
 await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(f.service.getApprovalInvalidation(event.event_id,f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(f.service.getApplyRequest(f.payload.request_id,f.context),{code:'INTEGRITY_CONFLICT'});
});

test('Invalidation create and scan reject wrong Approval hash, cross-repository and corrupt Request originals',async t=>{
 const f=await approvalFixture(t),receipt=await submitArtifact(f.service,f.payload,f.context);
 await f.service.invalidateApproval(inv(f),f.context);
 for(const mutate of [e=>e.receipt.approval_hash='0'.repeat(64),e=>e.receipt.repository_instance_id=`repo_${newRequestId()}`]) {
  const bad=structuredClone(receipt);mutate(bad);
  // Keep both hashes self-consistent: exact target binding must still reject.
  bad.receipt.request_payload_hash=requestPayloadHash(requestPayloadProjectionV1(bad));bad.receipt_hash=receiptHash(bad);
  await write(requestFile(f),bad);
  const command=inv(f);
  await assert.rejects(f.service.invalidateApproval(command,f.context),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(fs.stat(path(f,`apply-approvals/invalidations/${command.event_id}.json`)),{code:'ENOENT'});
  await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
 }
 await write(requestFile(f),{});
 await assert.rejects(f.service.invalidateApproval(inv(f),f.context),{code:'INTEGRITY_CONFLICT'});
 await assert.rejects(f.service.getApprovalInvalidations(f.context),{code:'INTEGRITY_CONFLICT'});
 await write(requestFile(f),receipt);
 assert.equal((await f.service.getApprovalInvalidations(f.context)).length,1);
});

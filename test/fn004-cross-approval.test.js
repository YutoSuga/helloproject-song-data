import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {approvalFixture} from './fixtures/approval-runtime.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {approvalHash,newApprovalId,newInvalidationId,newRequestId} from '../src/fn004-approval-schema.js';
import {withCanonicalGate} from '../src/fn004-gate.js';

const requestFile=f=>join(f.root,'staging/apply-requests',`${f.payload.request_id}.json`);
const invalidate=(f,a)=>f.service.invalidateApproval({event_id:newInvalidationId(),approval_id:a.approval_id,approval_hash:approvalHash(a),reason:'pre-publication compatibility'},f.context);
async function secondApproval(f,intended_request_id=f.command.intended_request_id) {
 const b=await f.service.approveApplyPlan({...f.command,approval_id:newApprovalId(),intended_request_id},f.context);
 assert.equal(b.plan_id,f.approval.plan_id);assert.notEqual(b.approval_id,f.approval.approval_id);
 assert.notEqual(approvalHash(b),approvalHash(f.approval));return b;
}

test('cross-Approval invalidation-first rejects before publication and preserves valid global scan',async t=>{
 const f=await approvalFixture(t),b=await secondApproval(f);
 assert.equal(b.intended_request_id,f.approval.intended_request_id);
 assert.equal((await f.service.checkApproval(f.approval.approval_id,f.context)).status,'APPLICABLE');
 const event=await invalidate(f,b);assert.equal(event.accepted_request,null);
 const eventFile=join(f.root,'staging/apply-approvals/invalidations',`${event.event_id}.json`),before=await fs.readFile(eventFile);
 let publications=0;
 const service=createApprovalRequestService({root:f.root,io:{...fs,link:async(...args)=>{publications++;return fs.link(...args);}}});
 await assert.rejects(service.submitApplyRequest(f.payload,f.context),{code:'INTEGRITY_CONFLICT'});
 assert.equal(publications,0,'No Request publication may precede rejection');
 await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
 assert.deepEqual(await f.service.getApprovalInvalidations(f.context),[event]);
 assert.deepEqual(await f.service.getApprovalInvalidation(event.event_id,f.context),event);
 assert.deepEqual(await fs.readFile(eventFile),before);
 assert.deepEqual(await f.service.getApproval(f.approval.approval_id,f.context),f.approval);
 await assert.rejects(f.service.checkApproval(b.approval_id,f.context),{code:'APPROVAL_INVALIDATED'});
 await assert.rejects(f.service.checkApplyRequest(f.payload.request_id,f.context),{code:'PERSISTENCE_NOT_FOUND'});
 await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
});

test('Approval check reports prospective conflict, but submit independently revalidates after an earlier applicable check',async t=>{
 const f=await approvalFixture(t),b=await secondApproval(f);
 assert.equal((await f.service.checkApproval(f.approval.approval_id,f.context)).status,'APPLICABLE');
 await invalidate(f,b);
 const service=createApprovalRequestService({root:f.root,clock:()=>{throw Error('Conflict must precede time allocation');}});
 await withCanonicalGate({root:f.root,fn:async gate=>{
  const context={...f.context,gate};
  await assert.rejects(service.checkApproval(f.approval.approval_id,context),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(service.submitApplyRequest(f.payload,context),{code:'INTEGRITY_CONFLICT'});
 }});
 await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
 assert.equal((await service.getApprovalInvalidations(f.context)).length,1);
});

test('a valid pre-request Invalidation with a different intended Request does not conflict',async t=>{
 const f=await approvalFixture(t),b=await secondApproval(f,newRequestId()),event=await invalidate(f,b);
 assert.notEqual(b.intended_request_id,f.approval.intended_request_id);
 assert.equal((await f.service.checkApproval(f.approval.approval_id,f.context)).status,'APPLICABLE');
 const first=await f.service.submitApplyRequest(f.payload,f.context),bytes=await fs.readFile(requestFile(f));
 assert.equal(first.artifact.receipt.approval_id,f.approval.approval_id);
 assert.deepEqual(await f.service.getApprovalInvalidations(f.context),[event]);
 assert.deepEqual(await f.service.submitApplyRequest(f.payload,f.context),first);
 assert.deepEqual(await f.service.checkApplyRequest(f.payload.request_id,f.context),first);
 assert.deepEqual(await fs.readFile(requestFile(f)),bytes);
 await assert.rejects(f.service.submitApplyRequest({...f.payload,approval_id:b.approval_id,approval_hash:approvalHash(b)},f.context),{code:'INTEGRITY_CONFLICT'});
});

test('concurrent cross-Approval Request/Invalidation cannot publish an incompatible pair',async t=>{
 const f=await approvalFixture(t),b=await secondApproval(f);
 const results=await Promise.allSettled([f.service.submitApplyRequest(f.payload,f.context),invalidate(f,b)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 for(const r of results)if(r.status==='rejected')assert.ok(['GATE_BUSY','INTEGRITY_CONFLICT'].includes(r.reason.code));
 const exists=await fs.stat(requestFile(f)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 if(exists) {
  assert.deepEqual(await f.service.getApprovalInvalidations(f.context),[]);
  await assert.rejects(invalidate(f,b),{code:'INTEGRITY_CONFLICT'});
  const retry=await f.service.submitApplyRequest(f.payload,f.context);
  assert.deepEqual(await f.service.checkApplyRequest(f.payload.request_id,f.context),retry);
 } else {
  assert.equal((await f.service.getApprovalInvalidations(f.context)).length,1);
  await assert.rejects(f.service.submitApplyRequest(f.payload,f.context),{code:'INTEGRITY_CONFLICT'});
  await assert.rejects(fs.stat(requestFile(f)),{code:'ENOENT'});
 }
});

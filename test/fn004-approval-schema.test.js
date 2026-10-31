import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseStrictJson} from '../src/strict-json.js';
import {hashCanonicalJson} from '../src/canonical-hash.js';
import {validateApproval,validateInvalidation,validateApplyRequest,approvalHash,requestPayloadHash,receiptHash,requestPayloadProjectionV1,newApprovalId,newRequestId,newInvalidationId,approvalId,requestId,invalidationId} from '../src/fn004-approval-schema.js';
const text=await readFile(new URL('../docs/design/FN-004-承認・反映リクエスト.md',import.meta.url),'utf8');
const [inv,a,ap,e,p,r,rp]=[...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>parseStrictJson(Buffer.from(m[1])));
test('formal complete examples, exact projections and three published hash vectors',()=>{
 validateApproval(a);validateInvalidation(inv);validateApplyRequest(e);
 assert.deepEqual(a,ap);assert.deepEqual(e.receipt,r);assert.deepEqual(requestPayloadProjectionV1(e),p);
 assert.equal(approvalHash(a),'4e2a1737cfad8ebb06b6fbd7c90b84d60cd5c899d30d7574ae2e334f71740d7c');
 assert.equal(requestPayloadHash(p),'bc0140034af0f210f32a72906b53fa4fe8dc365a43f07fe4b9db0d92f41145d2');
 assert.equal(receiptHash(e),'69024a028f80c30396118b31088e3dfd0f0c86d0a859a270e3e8214da19f72ec');
 assert.equal(receiptHash(e),hashCanonicalJson(rp));
});
for(const [name,original,validate] of [['Approval',a,validateApproval],['Invalidation',inv,validateInvalidation],['Request',e,validateApplyRequest]]) {
 test(`${name}: every required field, closedness/version/null and JSON domain`,()=>{
  for(const key of Object.keys(original)){const bad=structuredClone(original);delete bad[key];assert.throws(()=>validate(bad),{code:'INTEGRITY_CONFLICT'});}
  for(const mutate of [x=>x.extra=1,x=>x.schema_version=2,x=>x.schema_version=null,x=>x.actor?x.actor.extra=1:x.processing.extra=1,x=>x.actor?x.actor.id='local:\ud800':x.processing.state='\ud800']){const bad=structuredClone(original);mutate(bad);assert.throws(()=>validate(bad),{code:'INTEGRITY_CONFLICT'});}
 });
}
test('UUID generation enforces prefix, lowercase v4 and variant',()=>{
 for(const [generate,valid] of [[newApprovalId,approvalId],[newRequestId,requestId],[newInvalidationId,invalidationId]]) {const id=generate();assert.ok(valid(id));assert.ok(!valid(id.toUpperCase()));const versionAt=id.length-36+14;assert.ok(!valid(id.slice(0,versionAt)+'5'+id.slice(versionAt+1))); assert.ok(!valid('../'+id));assert.ok(!valid(id+'\n'));const variantAt=id.length-36+19;assert.ok(!valid(id.slice(0,variantAt)+'7'+id.slice(variantAt+1)));}
});
test('Approval types, actor, purpose, hashes, timestamps and filename binding',()=>{
 for(const [key,value] of [['approved_at','2026-02-30T00:00:00Z'],['approved_at','2026-01-01T00:00:00'],['purpose',' canonical_apply'],['decision_content_hash','A'.repeat(64)],['revision',0],['intended_request_id',null],['actor',{id:'admin:test',assurance:'local_process'}],['plan_id','ap_bad']]){const bad={...a,[key]:value};assert.throws(()=>validateApproval(bad),{code:'INTEGRITY_CONFLICT'});}
 assert.throws(()=>validateApproval(a,newApprovalId()),{code:'INTEGRITY_CONFLICT'});
});
test('Invalidation reason, nullable accepted_request and no independent hash',()=>{
 for(const reason of ['', ' \n\t'])assert.throws(()=>validateInvalidation({...inv,reason}),{code:'INTEGRITY_CONFLICT'});
 validateInvalidation({...inv,reason:'  日本語 e\u0301  ',accepted_request:null});
 for(const value of [{},[],{...inv.accepted_request,extra:1},{...inv.accepted_request,receipt_hash:'bad'}])assert.throws(()=>validateInvalidation({...inv,accepted_request:value}),{code:'INTEGRITY_CONFLICT'});
 assert.throws(()=>validateInvalidation({...inv,invalidation_hash:'a'.repeat(64)}),{code:'INTEGRITY_CONFLICT'});
});
test('mutable cache excluded from hashes but strict, receipt tamper rejected',()=>{
 const changed=structuredClone(e);changed.processing.state='future_unknown';validateApplyRequest(changed);assert.equal(receiptHash(changed),e.receipt_hash);
 for(const mutate of [x=>x.receipt.requested_at='bad',x=>x.receipt.apply_id='apply_'+newRequestId(),x=>x.receipt.actor.id='local:other',x=>x.receipt.schema_version=1,x=>x.processing.journal_ref='../escape',x=>x.processing.state=' ',x=>x.receipt_hash='0'.repeat(64)]) {const bad=structuredClone(e);mutate(bad);assert.throws(()=>validateApplyRequest(bad),{code:'INTEGRITY_CONFLICT'});}
});

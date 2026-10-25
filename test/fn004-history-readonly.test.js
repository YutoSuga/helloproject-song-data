import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createFn004Repository } from '../src/fn004-repository.js';
import { withCanonicalGate } from '../src/fn004-gate.js';
import { applyHistoryPath } from '../src/fn004-history-directory.js';
import { historyRecordHash,validateHistoryChain,historySetProjection,historySemanticHash,buildHistoryIndexes,lookupAppliedDecision } from '../src/fn004-history-projections.js';
const hash='a'.repeat(64);
const identity={repository_instance_id:`repo_${randomUUID()}`,bootstrap_hash:hash};
const copy=structuredClone;
// Minimal projection inputs, deliberately NOT complete successful History
// records. These tests certify chain/index helpers, not schema/state readiness.
function record(sequence,previous,decisionId=`dec_${randomUUID()}`,candidate=`candidate-${sequence}`) {
  const id=randomUUID();const planHash=String(sequence).repeat(64);
  const payload={schema_version:1,...identity,sequence,previous_history_hash:previous,apply_id:`apply_${id}`,transaction_id:`tx_${id}`,
    decision:{decision_id:decisionId,revision:2,content_hash:hash},plan:{plan_id:`ap_${planHash}`,plan_hash:planHash},request:{request_id:randomUUID(),request_payload_hash:hash},candidate_coverage:[{candidate_id:candidate}]};
  return {payload,record_hash:historyRecordHash(payload),metadata:{published_at:'2026-10-25T00:00:00Z'}};
}
const seal=r=>{r.record_hash=historyRecordHash(r.payload);return r;};
test('chain and formal set projection order records by sequence independently of listing order',()=>{
  const a=record(1,hash),b=record(2,a.record_hash);
  assert.deepEqual(validateHistoryChain([b,a],identity),[a,b]);
  const projection=historySetProjection([b,a],identity);
  assert.deepEqual(projection,{schema_version:1,...identity,records:[{sequence:1,apply_id:a.payload.apply_id,record_hash:a.record_hash},{sequence:2,apply_id:b.payload.apply_id,record_hash:b.record_hash}]});
  assert.equal(historySemanticHash([a,b],identity),historySemanticHash([b,a],identity));
  assert.notEqual(historySemanticHash([],identity),historySemanticHash([a],identity));
});
test('payload hash excludes display metadata and binds semantic payload changes',()=>{
  const a=record(1,hash),b=copy(a);b.metadata.published_at='2026-10-26T00:00:00Z';
  assert.equal(historySemanticHash([a],identity),historySemanticHash([b],identity));
  b.payload.request.request_payload_hash='b'.repeat(64);assert.notEqual(historyRecordHash(a.payload),historyRecordHash(b.payload));
  assert.throws(()=>validateHistoryChain([b],identity),{code:'HISTORY_CORRUPT'});
});
test('sequence gaps, duplicate sequence/apply, forked previous hash and identity mismatch block chain',()=>{
  const a=record(1,hash),b=record(2,a.record_hash);
  for(const records of [[b],[a,a],[a,record(1,a.record_hash)],[a,record(3,a.record_hash)],[a,record(2,hash)]])assert.throws(()=>validateHistoryChain(records,identity));
  const wrong=copy(b);wrong.payload.repository_instance_id=`repo_${randomUUID()}`;seal(wrong);assert.throws(()=>validateHistoryChain([a,wrong],identity),{code:'HISTORY_CHAIN_MISMATCH'});
  const duplicate=copy(b);duplicate.payload.apply_id=a.payload.apply_id;duplicate.payload.transaction_id=a.payload.transaction_id;seal(duplicate);assert.throws(()=>validateHistoryChain([a,duplicate],identity),{code:'HISTORY_CORRUPT'});
  for(const bad of [null,{payload:{}},{...a,record_hash:'x'}, {...a,payload:{...a.payload,transaction_id:`tx_${randomUUID()}`}}])assert.throws(()=>validateHistoryChain([bad],identity));
});
test('indexes follow formal fields/order and lookup distinguishes hashes, revisions and coverage',()=>{
  const a=record(1,hash),b=record(2,a.record_hash);const indexes=buildHistoryIndexes([b,a],identity);
  assert.deepEqual(Object.keys(indexes),['by_decision_revision','by_candidate','by_request','by_plan']);
  assert.deepEqual(indexes.by_candidate.map(r=>r.candidate_id),['candidate-1','candidate-2']);
  const decision=a.payload.decision;
  assert.deepEqual(lookupAppliedDecision(indexes,decision),{code:'ALREADY_APPLIED',apply_id:a.payload.apply_id});
  assert.equal(lookupAppliedDecision(indexes,{...decision,content_hash:'b'.repeat(64)}).code,'INTEGRITY_CONFLICT');
  assert.equal(lookupAppliedDecision(indexes,{...decision,revision:3}).code,'APPLIED_DECISION_REVISION_UNSUPPORTED');
  const unseen={...decision,decision_id:`dec_${randomUUID()}`};
  assert.deepEqual(lookupAppliedDecision(indexes,unseen),{code:null,apply_id:null});
  assert.equal(lookupAppliedDecision(indexes,unseen,{candidate_ids:['candidate-1']}).code,'APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED');
  assert.equal(lookupAppliedDecision(indexes,unseen,{replaces:[{target:decision}]}).code,'APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED');
});
test('repeated successful Decision, coverage, request or Plan identity is not silently collapsed',()=>{
  const a=record(1,hash);
  for(const mutate of [b=>b.payload.decision=copy(a.payload.decision),b=>b.payload.candidate_coverage=copy(a.payload.candidate_coverage),b=>b.payload.request=copy(a.payload.request),b=>b.payload.plan=copy(a.payload.plan)]) {
    const b=record(2,a.record_hash);mutate(b);seal(b);assert.throws(()=>buildHistoryIndexes([a,b],identity),{code:'HISTORY_IDENTITY_CONFLICT'});
  }
});
async function fixture(t) {
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,repo:await createFn004Repository(root)};
}
test('readonly directory snapshot distinguishes absent/empty and leaves unrelated staging alone',async t=>{
  const {root,repo}=await fixture(t);assert.deepEqual(await repo.readApplyHistoryDirectory(),{present:false,entries:[]});
  await fs.mkdir(join(root,'staging/apply-history'));await fs.writeFile(join(root,'staging/unrelated.txt'),'untouched');
  assert.deepEqual(await repo.readApplyHistoryDirectory(),{present:true,entries:[]});
  const id=`apply_${randomUUID()}`,document={example:'directory capture only'};
  await fs.writeFile(join(root,applyHistoryPath(id)),JSON.stringify(document));
  assert.deepEqual(await repo.readApplyHistoryDirectory(),{present:true,entries:[{name:`${id}.json`,kind:'file',document}]});
  assert.deepEqual(await repo.readJson(applyHistoryPath(id)),document);
  assert.equal(await fs.readFile(join(root,'staging/unrelated.txt'),'utf8'),'untouched');
  assert.deepEqual((await fs.readdir(join(root,'staging'))).filter(n=>n.startsWith('.fn004')),[]);
});
test('History writes and traversal cannot pass the repository boundary',async t=>{
  const {root,repo}=await fixture(t),path=applyHistoryPath(`apply_${randomUUID()}`);
  await withCanonicalGate({root,fn:async gate=>{
    for(const p of [path,'staging/apply-history/../../escape.json','staging/apply-history/invalid.json']){
      await assert.rejects(repo.writeJsonAtomic(p,{}, {gate}),{code:'PATH_UNSAFE'});
      await assert.rejects(repo.createJsonExclusive(p,{}, {gate}),{code:'PATH_UNSAFE'});
    }
  }});
  await assert.rejects(repo.readJson('staging/apply-history/../../escape.json'),{code:'PATH_UNSAFE'});
  await assert.rejects(fs.stat(join(root,'staging/apply-history')),{code:'ENOENT'});
});
test('unknown filename is rejected and symlink/directory entries are captured without following them',async t=>{
  const {root,repo}=await fixture(t);await fs.mkdir(join(root,'staging/apply-history'),{recursive:true});
  await fs.writeFile(join(root,'staging/apply-history/unknown.json'),'{}');
  await assert.rejects(repo.readApplyHistoryDirectory(),{code:'HISTORY_CORRUPT'});await fs.unlink(join(root,'staging/apply-history/unknown.json'));
  const id=`apply_${randomUUID()}`;await fs.symlink('/does/not/exist',join(root,applyHistoryPath(id)));
  assert.deepEqual((await repo.readApplyHistoryDirectory()).entries,[{name:`${id}.json`,kind:'symlink',document:null}]);
  await fs.unlink(join(root,applyHistoryPath(id)));await fs.mkdir(join(root,applyHistoryPath(id)));
  assert.equal((await repo.readApplyHistoryDirectory()).entries[0].kind,'directory');
});
test('History strict reader rejects duplicate members, BOM and invalid UTF8 without writing',async t=>{
  const {root,repo}=await fixture(t);await fs.mkdir(join(root,'staging/apply-history'),{recursive:true});const path=join(root,applyHistoryPath(`apply_${randomUUID()}`));
  for(const bytes of [Buffer.from('{"a":1,"a":2}'),Buffer.from('\ufeff{}'),Buffer.from([0xff])]){
    await fs.writeFile(path,bytes);await assert.rejects(repo.readApplyHistoryDirectory());assert.deepEqual(await fs.readFile(path),bytes);
  }
});

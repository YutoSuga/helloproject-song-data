import test from 'node:test';
import assert from 'node:assert/strict';
import { historyFixture,syntheticSuccess,directory } from './fixtures/history-success.js';
import { validateHistoryRecord } from '../src/fn004-history-record.js';
import { verifySuccessfulHistory,lookupVerifiedHistory } from '../src/fn004-history-verify.js';
import { hashCanonicalJson } from '../src/canonical-hash.js';
import { hashState } from '../src/fn004-state.js';
const copy=structuredClone;
function successful(allocate=false){const f=historyFixture(),{record,terminal}=syntheticSuccess(f,[],{allocate});return {...f,state:terminal,history_directory:directory([record]),record};}
const verify=f=>verifySuccessfulHistory(f);
const rehash=r=>{r.record_hash=hashCanonicalJson(r.payload);return r;};
test('complete successful record, embedded Plan and success-only terminal state verify',()=>{for(const allocate of [false,true]){const f=successful(allocate);validateHistoryRecord(f.record);const v=verify(f);assert.equal(v.valid,true,JSON.stringify(v.diagnostics));assert.equal(v.readiness,'ready',JSON.stringify(v.diagnostics));assert.equal(v.state_proof.terminal_state_hash,f.state.state_hash);}});
test('empty/absent History is ready only with full genesis',()=>{const f=historyFixture();for(const present of [false,true]){f.history_directory=directory([],present);assert.equal(verify(f).readiness,'ready');}
  for(const mutate of [s=>s.generation++,s=>s.high_water_marks.W++,s=>s.allocation_events.push({transaction_id:'tx_00000000-0000-4000-8000-000000000000',namespace:'W',first:1,last:1}),s=>s.history.head_hash='f'.repeat(64),s=>s.history.count++,s=>s.history.last_apply_id='apply_00000000-0000-4000-8000-000000000000']){const bad=copy(f);mutate(bad.state);bad.state.state_hash=hashState(bad.state);assert.notEqual(verify(bad).readiness,'ready');}});
test('multiple successful records reconstruct generation, allocations and final head',()=>{const f=historyFixture(),a=syntheticSuccess(f,[],{allocate:true}),b=syntheticSuccess({...f,state:a.terminal},[a.record],{allocate:true});const v=verify({...f,state:b.terminal,history_directory:directory([b.record,a.record])});assert.equal(v.readiness,'ready',JSON.stringify(v.diagnostics));assert.equal(v.count,2);assert.equal(b.terminal.generation,4);assert.equal(b.terminal.high_water_marks.C,2);});

function rebind(r){r.plan_snapshot.plan_hash=hashCanonicalJson(r.plan_snapshot.payload);r.plan_snapshot.plan_id=`ap_${r.plan_snapshot.plan_hash}`;r.payload.plan={plan_id:r.plan_snapshot.plan_id,plan_hash:r.plan_snapshot.plan_hash};return rehash(r);}
function mutatedFixture(f,mutate){const bad=copy(f);mutate(bad.record);rebind(bad.record);bad.history_directory=directory([bad.record]);bad.state.history.head_hash=bad.record.record_hash;bad.state.state_hash=hashState(bad.state);return bad;}
test('closed complete schemas reject unknown/missing fields and malformed IDs, hashes, bindings',()=>{
  const f=successful(true);
  for(const mutate of [r=>r.extra=true,r=>delete r.metadata,r=>r.schema_version=2,r=>r.payload.extra=true,r=>delete r.payload.actor,r=>r.payload.sequence=0,r=>r.payload.apply_id='apply_bad',r=>r.payload.transaction_id='tx_bad',r=>r.record_hash='0'.repeat(64),r=>r.payload.decision.content_hash='0'.repeat(64),r=>r.payload.approval.extra=true,r=>r.payload.request.request_id='bad',r=>r.plan_snapshot.plan_id='ap_bad',r=>r.plan_snapshot.payload.extra=true,r=>r.plan_snapshot.payload.rules.planner=2,r=>r.plan_snapshot.payload.operations[0].extra=true,r=>r.payload.results[0].row_hash='0'.repeat(64),r=>r.payload.candidate_coverage[0].song_id='J99999',r=>r.payload.id_mappings[0].canonical_id='C99999',r=>r.payload.before_manifest.files[0].extra=true,r=>r.payload.applied_at='2026-02-30T00:00:00Z']){
    const r=copy(f.record);mutate(r);assert.throws(()=>validateHistoryRecord(r),{code:'HISTORY_CORRUPT'});
  }
});
test('static Plan validation catches internally rehashed template, mapping, dependency and applicability tampering',()=>{
  const f=successful(true);
  for(const mutate of [p=>p.operations=[],p=>p.operations[0].source.decision_paths=[],p=>p.operations[0].source.candidate_ids=[],p=>p.operations.at(-1).dependencies=[],p=>p.operations.at(-1).result.row_template.song_id='J99999',p=>p.planned_id_mappings[0].namespace='P',p=>p.applicability.applicable=false,p=>p.validation.performed=false,p=>p.conflicts=['op_'+'a'.repeat(64)],p=>p.candidate_preconditions[0].snapshot_hash='f'.repeat(64)]){
    const r=copy(f.record);mutate(r.plan_snapshot.payload);rebind(r);assert.throws(()=>validateHistoryRecord(r),{code:'HISTORY_CORRUPT'});
  }
});
test('metadata is excluded while semantic History fields remain hash-bound',()=>{
  const f=successful();const r=copy(f.record);r.metadata.published_at='2026-10-26T00:00:00Z';r.plan_snapshot.generated_at='2026-10-26T00:00:00Z';r.decision_snapshot.metadata.saved_at='2026-10-26T00:00:00Z';r.decision_snapshot.metadata.confirmed_at=r.decision_snapshot.metadata.saved_at;
  validateHistoryRecord(r);assert.equal(hashCanonicalJson(r.payload),f.record.record_hash);r.payload.actor.id='local:other';assert.notEqual(hashCanonicalJson(r.payload),f.record.record_hash);assert.throws(()=>validateHistoryRecord(r));
});
test('valid History remains distinct from state proof on generation, high-water, allocation and pending failures',()=>{
  const f=successful(true);
  for(const [mutate,code]of [[s=>s.generation++,'STATE_TRANSITION_PROOF_REQUIRED'],[s=>s.high_water_marks.W=0,'STATE_HIGH_WATER_INVALID'],[s=>s.allocation_events=[],'STATE_TRANSITION_PROOF_REQUIRED'],[s=>s.repository_instance_id='repo_00000000-0000-4000-8000-000000000000','STATE_BOOTSTRAP_MISMATCH'],[s=>s.pending_transaction=f.record.payload.transaction_id,'RECOVERY_REQUIRED']]){
    const bad=copy(f);mutate(bad.state);bad.state.state_hash=hashState(bad.state);const v=verify(bad);assert.equal(v.valid,true);assert.equal(v.state_proof.verified,false);assert.equal(v.readiness,'recovery_required');assert.ok(v.diagnostics.some(d=>d.code===code),JSON.stringify(v.diagnostics));assert.throws(()=>lookupVerifiedHistory(v,f.record.payload.decision),{code:'RECOVERY_REQUIRED'});
  }
});
test('state history head/count/last, absent records, bad chain and prefix are blocking',()=>{
  const f=successful();
  for(const mutate of [s=>s.history.count++,s=>s.history.head_hash='f'.repeat(64),s=>s.history.last_apply_id=null]){const bad=copy(f);mutate(bad.state);bad.state.state_hash=hashState(bad.state);const v=verify(bad);assert.equal(v.valid,false);assert.ok(v.diagnostics.some(d=>d.code==='HISTORY_CHAIN_MISMATCH'));}
  const absent=copy(f);absent.history_directory=directory([],false);assert.equal(verify(absent).valid,false);
  for(const mutate of [r=>r.payload.previous_history_hash='f'.repeat(64),r=>r.plan_snapshot.payload.history_precondition.semantic_hash='f'.repeat(64)]){const v=verify(mutatedFixture(f,mutate));assert.equal(v.valid,false);assert.ok(v.diagnostics.some(d=>d.code==='HISTORY_CHAIN_MISMATCH'));}
});
test('success-only reconstruction rejects consumed-generation gaps, unmatched allocation and high-water decreases',()=>{
  const f=successful(true);
  for(const mutate of [r=>r.payload.state_transition.consumed.generation++,r=>r.payload.state_transition.allocation_ranges=[],r=>r.payload.state_transition.before.generation++]){
    const bad=mutatedFixture(f,r=>{mutate(r);for(const s of [r.payload.state_transition.before,r.payload.state_transition.consumed])s.state_hash=hashState(s);});const v=verify(bad);assert.equal(v.valid,true);assert.equal(v.state_proof.verified,false);assert.ok(v.diagnostics.some(d=>d.code==='STATE_TRANSITION_PROOF_REQUIRED'));
  }
  const bad=mutatedFixture(f,r=>{r.payload.state_transition.consumed.high_water_marks.W=0;r.payload.state_transition.consumed.state_hash=hashState(r.payload.state_transition.consumed);});assert.ok(verify(bad).diagnostics.some(d=>d.code==='STATE_HIGH_WATER_INVALID'));
});
test('fully verified indexes support required applied lookup precedence',()=>{
  const f=successful(),v=verify(f),d=f.record.payload.decision;
  assert.equal(lookupVerifiedHistory(v,d).code,'ALREADY_APPLIED');assert.equal(lookupVerifiedHistory(v,{...d,content_hash:'f'.repeat(64)}).code,'INTEGRITY_CONFLICT');assert.equal(lookupVerifiedHistory(v,{...d,revision:d.revision+1}).code,'APPLIED_DECISION_REVISION_UNSUPPORTED');assert.equal(lookupVerifiedHistory(v,{...d,decision_id:'dec_00000000-0000-4000-8000-000000000000'}).code,null);
});
test('directory artifact integrity and external canonical/Git observations cannot be bypassed',()=>{
  const f=successful();for(const mutate of [x=>x.history_directory.entries[0].kind='symlink',x=>x.history_directory.entries[0].name='other.json',x=>x.history_directory.entries.push(copy(x.history_directory.entries[0])),x=>x.history_directory.present=false]){const bad=copy(f);mutate(bad);assert.equal(verify(bad).valid,false);}
  const bad=copy(f);bad.git_audit.git.complete=false;assert.throws(()=>verify(bad),{code:'BOOTSTRAP_AUDIT_INCOMPLETE'});bad.git_audit=f.git_audit;bad.snapshot.validation.ok=false;assert.throws(()=>verify(bad),{code:'CANONICAL_INVALID'});
});

import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CANONICAL_TABLES } from '../src/canonical-schema.js';
import { readCanonicalSnapshot } from '../src/canonical-snapshot.js';
import { auditGitIds } from '../src/fn004-git-audit.js';
import { createAuditPayload,createBootstrapRecords,DECLARATION_STATEMENT } from '../src/fn004-state.js';
import { emptyMaxima } from '../src/fn004-id-audit.js';
import { readApplyHistory,lookupAppliedDecision } from '../src/fn004-history-runtime.js';
import { readValidatedCanonicalSnapshot } from '../src/fn004-repository.js';
const execute=promisify(execFile);
async function runtimeFixture(t){
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-history-proof-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(join(root,'data'));await fs.mkdir(join(root,'staging'));
  for(const table of CANONICAL_TABLES)await fs.writeFile(join(root,table.path),table.columns.map(c=>c.name).join(',')+'\n');
  for(const args of [['init','-q','-b','main'],['add','data'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','canonical'],['update-ref','refs/remotes/origin/main','HEAD']])await execute('git',['-C',root,...args]);
  const snapshot=await readCanonicalSnapshot(root),git_audit=await auditGitIds(root);
  const declaration={schema_version:1,namespaces:{...emptyMaxima(),W:1,J:1,G:1,L:1},statement:DECLARATION_STATEMENT,evidence:[]};
  const audit_payload=createAuditPayload({...snapshot,current_maxima:emptyMaxima()},git_audit,declaration);
  const {record:bootstrap,state}=createBootstrapRecords({audit_payload,canonical_manifest:snapshot.manifest,repository_instance_id:historyFixture().state.repository_instance_id,initialized_at:'2026-10-25T00:00:00Z',actor:{id:'local:test',assurance:'local_process'},expected_audit_hash:hashCanonicalJson(audit_payload)});
  await fs.writeFile(join(root,'staging/fn004-bootstrap.json'),JSON.stringify(bootstrap));await fs.writeFile(join(root,'staging/fn004-state.json'),JSON.stringify(state));
  return {root,bootstrap,state,snapshot,git_audit};
}
test('readonly runtime proves actual empty/genesis and noninitial states under one gate',async t=>{
  const f=await runtimeFixture(t);const initial=await readApplyHistory({root:f.root});assert.equal(initial.readiness,'ready');
  const bootstrapBytes=await fs.readFile(join(f.root,'staging/fn004-bootstrap.json'));
  const {record,terminal}=syntheticSuccess(f,[],{allocate:true});await fs.mkdir(join(f.root,'staging/apply-history'));await fs.writeFile(join(f.root,`staging/apply-history/${record.payload.apply_id}.json`),JSON.stringify(record));await fs.writeFile(join(f.root,'staging/fn004-state.json'),JSON.stringify(terminal));
  const stateBytes=await fs.readFile(join(f.root,'staging/fn004-state.json')),historyBytes=await fs.readFile(join(f.root,`staging/apply-history/${record.payload.apply_id}.json`));
  const v=await readApplyHistory({root:f.root});assert.equal(v.readiness,'ready');assert.equal(v.count,1);assert.equal(v.state_proof.terminal_state_hash,terminal.state_hash);
  assert.equal((await lookupAppliedDecision({root:f.root,decision:record.payload.decision})).code,'ALREADY_APPLIED');assert.equal((await readValidatedCanonicalSnapshot(f.root)).validation.ok,true);
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-bootstrap.json')),bootstrapBytes);assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),stateBytes);assert.deepEqual(await fs.readFile(join(f.root,`staging/apply-history/${record.payload.apply_id}.json`)),historyBytes);
  assert.deepEqual((await fs.readdir(join(f.root,'staging'))).filter(n=>n.startsWith('.fn004')),[]);
  terminal.pending_transaction=record.payload.transaction_id;terminal.state_hash=hashState(terminal);await fs.writeFile(join(f.root,'staging/fn004-state.json'),JSON.stringify(terminal));
  await assert.rejects(readApplyHistory({root:f.root}),{code:'RECOVERY_REQUIRED'});
});
test('runtime rejects unproven noninitial generations and unknown transaction work even with valid History',async t=>{
  const f=await runtimeFixture(t);f.state.generation=1;f.state.state_hash=hashState(f.state);await fs.writeFile(join(f.root,'staging/fn004-state.json'),JSON.stringify(f.state));
  await assert.rejects(readApplyHistory({root:f.root}),{code:'STATE_TRANSITION_PROOF_REQUIRED'});
  await fs.mkdir(join(f.root,'staging/transactions/tx_unknown'),{recursive:true});await assert.rejects(readApplyHistory({root:f.root}),{code:'RECOVERY_REQUIRED'});
});

test('reuse/no_op success has unchanged manifests but still proves both generation transitions',()=>{
  const f=successful(),r=f.record,op=r.plan_snapshot.payload.operations.at(-1),row=copy(r.payload.results.at(-1).row);
  op.classification='no_op';op.result={requested_row:row,existing_row:row,row_hash:hashCanonicalJson({table:op.table,row}),reason_code:'RELATION_ALL_COLUMNS_EQUAL'};
  r.plan_snapshot.payload.no_op_operations=[op.operation_id];r.payload.results.at(-1).classification='no_op';r.payload.after_manifest=copy(r.payload.before_manifest);rebind(r);f.state.history.head_hash=r.record_hash;f.state.state_hash=hashState(f.state);f.history_directory=directory([r]);
  validateHistoryRecord(r);assert.equal(verify(f).readiness,'ready');assert.equal(f.state.generation,2);
  const bad=copy(r);bad.payload.after_manifest.files[0].byte_length++;bad.payload.after_manifest.manifest_hash=hashCanonicalJson(bad.payload.after_manifest.files);rehash(bad);assert.throws(()=>validateHistoryRecord(bad),{code:'HISTORY_CORRUPT'});
});
test('fully rehashed but noncontiguous allocation cannot certify consumed IDs',()=>{
  const f=successful(true);f.record=JSON.parse(JSON.stringify(f.record).replaceAll('C00001','C00003'));
  const r=f.record;for(const result of r.payload.results)result.row_hash=hashCanonicalJson({table:result.table,row:result.row});
  const consumed=r.payload.state_transition.consumed;consumed.high_water_marks.C=3;consumed.allocation_events[0].first=3;consumed.allocation_events[0].last=3;r.payload.state_transition.allocation_ranges=copy(consumed.allocation_events);consumed.state_hash=hashState(consumed);rebind(r);
  f.history_directory=directory([r]);f.state.high_water_marks.C=3;f.state.allocation_events=copy(consumed.allocation_events);f.state.history.head_hash=r.record_hash;f.state.state_hash=hashState(f.state);
  validateHistoryRecord(r);const v=verify(f);assert.equal(v.valid,true);assert.ok(v.diagnostics.some(d=>d.code==='STATE_TRANSITION_PROOF_REQUIRED'));
});
test('current canonical and historical ID lower bounds remain mandatory after History proof',()=>{
  const f=successful();f.git_audit.maxima.W=2;const v=verify(f);assert.equal(v.valid,true);assert.equal(v.state_proof.verified,false);assert.ok(v.diagnostics.some(d=>d.code==='STATE_HIGH_WATER_INVALID'));assert.equal(v.state_proof.terminal_state_hash,f.state.state_hash);
});

test('timestamp ordering retains sub-millisecond precision and timezone meaning',()=>{
  const r=successful().record;r.payload.apply_time='2026-10-25T00:00:00.0002Z';r.payload.applied_at='2026-10-25T00:00:00.0001Z';rehash(r);assert.throws(()=>validateHistoryRecord(r),{code:'HISTORY_CORRUPT'});
});

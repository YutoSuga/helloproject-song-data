import test from 'node:test';
import assert from 'node:assert/strict';
import { planFixture,withNewEntities } from './fixtures/plan-input.js';
import { generatePlanFromInput,diagnoseUnsupportedRequests } from '../src/fn004-plan-generate.js';
import { validateApplyPlan } from '../src/fn004-plan-validator.js';
import { canonicalJson,hashCanonicalJson } from '../src/canonical-hash.js';
import { validateFn004State } from '../src/fn004-state.js';
import { seal,next } from './fixtures/decision-lifecycle.js';
const copy=structuredClone;
const rehash=p=>{p.plan_hash=hashCanonicalJson(p.payload);p.plan_id=`ap_${p.plan_hash}`;return p;};
test('complete bound Plan generates deterministically without consuming state or changing input',()=>{const f=planFixture(),before=JSON.stringify(f),a=generatePlanFromInput(f,{generated_at:'2026-10-25T00:00:00Z'}),b=generatePlanFromInput(f,{generated_at:'2026-10-26T00:00:00Z'});assert.deepEqual(a.payload,b.payload);assert.equal(a.plan_id,b.plan_id);assert.equal(a.payload.applicability.applicable,true);assert.equal(JSON.stringify(f),before);validateFn004State(f.state);validateApplyPlan(a,{decision:f.decision});assert.equal(a.payload.decision.registry_hash,f.registry.registry_hash);assert.deepEqual(a.payload.canonical_precondition,f.snapshot.manifest);assert.equal(a.payload.id_state_precondition.state_hash,f.state.state_hash);assert.equal(a.payload.history_precondition.semantic_hash,f.history.semantic_hash);});
test('all new master/relation kinds and explicit member reuse form a whole valid target',()=>{const f=withNewEntities(planFixture()),p=generatePlanFromInput(f);assert.equal(p.payload.applicability.applicable,true);assert.deepEqual(p.payload.planned_id_mappings.map(m=>m.planned_id),['W00002','C00001','G00002','L00002','H00001']);assert.equal(p.payload.operations.length,10);assert.ok(p.payload.operations.some(o=>o.table==='members'&&o.classification==='reuse'));validateApplyPlan(p,{decision:f.decision});});
test('candidate mismatch and non-effective Decisions never create artifacts',()=>{const f=planFixture(),bad=copy(f);bad.candidates.candidates[0].title='changed';assert.throws(()=>generatePlanFromInput(bad),{code:'CANDIDATE_FINGERPRINT_MISMATCH'});for(const status of ['draft','cancelled']){const x=copy(f);x.decision=status==='draft'?x.store.revisions[0]:next(x.decision,'cancelled');assert.throws(()=>generatePlanFromInput(x),{code:'DECISION_NOT_EFFECTIVE'});}const projection={...f.registry.projection,active_confirmed:[]};const replaced={...f,registry:{...f.registry,projection,registry_hash:hashCanonicalJson(projection),active_confirmed:[]}};assert.throws(()=>generatePlanFromInput(replaced),{code:'DECISION_NOT_EFFECTIVE'});});
test('History precheck preserves already-applied/hash/revision distinctions',()=>{const f=planFixture(),d=f.decision;for(const [revision,content_hash,code]of [[d.revision,d.content_hash,'ALREADY_APPLIED'],[d.revision,'f'.repeat(64),'INTEGRITY_CONFLICT'],[d.revision+1,d.content_hash,'APPLIED_DECISION_REVISION_UNSUPPORTED']]){const x=copy(f);x.history.indexes.by_decision_revision=[{decision_id:d.decision_id,revision,content_hash,apply_id:'apply_00000000-0000-4000-8000-000000000000'}];assert.throws(()=>generatePlanFromInput(x),{code});}});
test('blocked canonical conflicts and capacity produce valid diagnostic Plans, never partial applicability',()=>{const f=planFixture();f.snapshot.tables.release_tracks=[{release_id:'L00001',disc_number:'1',track_number:'1',song_id:'J00001',track_title:'Different',notes:'',source_url:'https://example.org/song'}];const p=generatePlanFromInput(f);assert.equal(p.payload.applicability.applicable,false);assert.ok(p.payload.operations.some(o=>o.result.code==='RELATION_PK_CONTENT_CONFLICT'));validateApplyPlan(p,{decision:f.decision});const g=withNewEntities(planFixture());g.state.high_water_marks.W=99999;g.state.state_hash=hashCanonicalJson(Object.fromEntries(Object.entries(g.state).filter(([k])=>k!=='state_hash')));g.history.state_proof.terminal_state_hash=g.state.state_hash;const q=generatePlanFromInput(g);assert.equal(q.payload.applicability.applicable,false);assert.equal(q.payload.validation.performed,false);assert.ok(q.payload.validation.diagnostics.some(d=>d.code==='REQUIREMENT_UNPLANNED'));validateApplyPlan(q,{decision:g.decision});});
test('same relation is no_op only under full-column integer-aware equivalence',()=>{const f=planFixture();f.snapshot.tables.release_tracks=[{release_id:'L00001',disc_number:'01',track_number:'01',song_id:'J00001',track_title:'曲',notes:'',source_url:'https://example.org/song'}];const p=generatePlanFromInput(f);assert.equal(p.payload.operations.at(-1).classification,'no_op');assert.equal(p.payload.applicability.applicable,true);assert.equal(p.payload.operations.at(-1).result.existing_row.disc_number,'01');});
test('unsupported requests use a diagnostic-only surface and cannot become formal Plans',()=>{const f=planFixture(),d=copy(f.store.revisions[0]);d.unsupported_requests=[{request_ref:'unsupported:u1',kind:'new_member',target:null,description:'Register a new member',evidence_refs:[]}];seal(d);const result=diagnoseUnsupportedRequests(d);assert.equal(result.operations[0].classification,'unsupported');assert.equal(result.diagnostics[0].code,'NEW_MEMBER');assert.throws(()=>generatePlanFromInput({...f,decision:d}),{code:'DECISION_NOT_EFFECTIVE'});});
test('artifact closedness, IDs, hashes, ordering and applicability are enforced after rehash',()=>{const f=withNewEntities(planFixture()),p=generatePlanFromInput(f);for(const mutate of [p=>p.extra=true,p=>p.payload.extra=true,p=>p.payload.rules.planner=2,p=>p.payload.operations.reverse(),p=>p.payload.operations[0].operation_id='op_'+'0'.repeat(64),p=>p.payload.operations[0].source.extra=true,p=>p.payload.applicability.applicable=false,p=>p.payload.planned_id_mappings[0].namespace='P',p=>p.payload.operations[0].result.row_template.extra='bad']){const bad=copy(p);mutate(bad);rehash(bad);assert.throws(()=>validateApplyPlan(bad,{decision:f.decision}),{code:'PLAN_INTEGRITY_CONFLICT'});}const bad=copy(p);bad.plan_id='ap_bad';assert.throws(()=>validateApplyPlan(bad));});

import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CANONICAL_TABLES } from '../src/canonical-schema.js';
import { currentIdMaxima } from '../src/fn004-id-audit.js';
import { createAuditPayload,createBootstrapRecords,DECLARATION_STATEMENT,hashState } from '../src/fn004-state.js';
import { readCanonicalSnapshot } from '../src/canonical-snapshot.js';
import { auditGitIds } from '../src/fn004-git-audit.js';
import { createApplyPlanService } from '../src/fn004-plan-application.js';
import { createFn004Repository } from '../src/fn004-repository.js';
import { withCanonicalGate } from '../src/fn004-gate.js';
import { buildDecisionRegistry } from '../src/fn004-decision-lifecycle.js';
const execute=promisify(execFile);
async function runtimeFixture(t){const root=await fs.mkdtemp(join(tmpdir(),'fn004-plan-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(join(root,'data'));await fs.mkdir(join(root,'staging'));const f=planFixture();
  for(const table of CANONICAL_TABLES)await fs.writeFile(join(root,table.path),[table.columns.map(c=>c.name).join(','),...f.snapshot.tables[table.name].map(row=>table.columns.map(c=>row[c.name]).join(','))].join('\n')+'\n');
  for(const args of [['init','-q','-b','main'],['add','data'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','canonical'],['update-ref','refs/remotes/origin/main','HEAD']])await execute('git',['-C',root,...args]);
  const snapshot=await readCanonicalSnapshot(root),git=await auditGitIds(root),max=currentIdMaxima(snapshot),audit_payload=createAuditPayload({...snapshot,current_maxima:max},git,{schema_version:1,namespaces:max,statement:DECLARATION_STATEMENT,evidence:[]});
  const {record:bootstrap,state}=createBootstrapRecords({audit_payload,canonical_manifest:snapshot.manifest,repository_instance_id:f.state.repository_instance_id,initialized_at:'2026-10-25T00:00:00Z',actor:{id:'local:test',assurance:'local_process'},expected_audit_hash:hashCanonicalJson(audit_payload)});
  for(const [name,value]of [['fn004-bootstrap',bootstrap],['fn004-state',state],['song-candidates',f.candidates],['decisions',f.store]])await fs.writeFile(join(root,`staging/${name}.json`),JSON.stringify(value));
  return {...f,root,bootstrap,state,snapshot,service:createApplyPlanService({root})};
}
test('runtime generate/save/load/check is immutable, no-clobber and leaves protected inputs unchanged',async t=>{const f=await runtimeFixture(t),names=['fn004-bootstrap','fn004-state','song-candidates','decisions'],before=await Promise.all(names.map(n=>fs.readFile(join(f.root,`staging/${n}.json`))));
  const p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});assert.equal((await f.service.checkApplyPlan(p)).status,'APPLICABLE');const saved=await f.service.saveApplyPlan(p);assert.deepEqual(saved,p);assert.deepEqual(await f.service.getApplyPlan(p.plan_id),p);
  const reused=await f.service.saveApplyPlan({...p,generated_at:'2026-10-26T00:00:00Z'});assert.deepEqual(reused,p);assert.equal((await f.service.checkApplyPlan(p.plan_id)).status,'APPLICABLE');
  assert.deepEqual(await Promise.all(names.map(n=>fs.readFile(join(f.root,`staging/${n}.json`)))),before);assert.deepEqual((await fs.readdir(join(f.root,'staging'))).filter(n=>n.startsWith('.fn004')),[]);
  await assert.rejects(f.service.getApplyPlan('../escape'),{code:'PATH_UNSAFE'});const corrupted=copy(p);corrupted.payload.decision.registry_hash='0'.repeat(64);await assert.rejects(f.service.saveApplyPlan(corrupted),{code:'PLAN_INTEGRITY_CONFLICT'});
});
test('current candidate and canonical raw-byte changes make a saved Plan stale',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});await f.service.saveApplyPlan(p);
  const candidates=copy(f.candidates);candidates.candidates[0].title='changed';await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify(candidates));assert.equal((await f.service.checkApplyPlan(p)).status,'STALE_PLAN');await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify(f.candidates));
  await fs.appendFile(join(f.root,'data/works.csv'),'\n');const bytes=await fs.readFile(join(f.root,'data/works.csv'),'utf8');await fs.writeFile(join(f.root,'data/works.csv'),bytes.trimEnd()+'\r\n');assert.equal((await f.service.checkApplyPlan(p)).status,'STALE_PLAN');
});
test('later draft is not stale; changed active confirmation, registry or rules is stale',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});const draft=next(f.decision);let store={schema_version:1,revisions:[...f.store.revisions,draft]};await fs.writeFile(join(f.root,'staging/decisions.json'),JSON.stringify(store));assert.equal((await f.service.checkApplyPlan(p)).status,'APPLICABLE');
  const confirmed=next(draft,'confirmed');store.revisions.push(confirmed);await fs.writeFile(join(f.root,'staging/decisions.json'),JSON.stringify(store));assert.equal((await f.service.checkApplyPlan(p)).status,'STALE_PLAN');
  const changed=copy(p);changed.payload.rules.planner=2;rehash(changed);assert.equal((await f.service.checkApplyPlan(changed)).status,'STALE_PLAN');
});
test('pending transactions block both generate and check',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id}),state=copy(f.state);state.pending_transaction='tx_00000000-0000-4000-8000-000000000000';state.state_hash=hashState(state);await fs.writeFile(join(f.root,'staging/fn004-state.json'),JSON.stringify(state));await assert.rejects(f.service.generateApplyPlan({decision_id:f.decision.decision_id}),{code:'RECOVERY_REQUIRED'});await assert.rejects(f.service.checkApplyPlan(p),{code:'RECOVERY_REQUIRED'});});
test('persistence failure before publication preserves absent target and releases the gate',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});const broken=createApplyPlanService({root:f.root,io:{...fs,link:async()=>{throw new Error('injected publication failure');}}});await assert.rejects(broken.saveApplyPlan(p),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&!e.published);await assert.rejects(fs.stat(join(f.root,`staging/apply-plans/${p.plan_id}.json`)),{code:'ENOENT'});await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});});

import { syntheticSuccess } from './fixtures/history-success.js';
import { validateHistoryRecord } from '../src/fn004-history-record.js';
async function publishTestHistory(f,record,terminal){validateHistoryRecord(record);await fs.mkdir(join(f.root,'staging/apply-history'),{recursive:true});await fs.writeFile(join(f.root,`staging/apply-history/${record.payload.apply_id}.json`),JSON.stringify(record));await fs.writeFile(join(f.root,'staging/fn004-state.json'),JSON.stringify(terminal));}
test('unrelated validated History/state progression makes a saved Plan stale',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});const success=syntheticSuccess(f,[],{candidate_id:'unrelated-candidate'});await publishTestHistory(f,success.record,success.terminal);assert.equal((await f.service.checkApplyPlan(p)).status,'STALE_PLAN');});
test('runtime History precheck distinguishes applied identity, hash conflict and different revision',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id}),success=syntheticSuccess(f),r=success.record;
  r.decision_snapshot=f.decision;r.plan_snapshot=p;r.payload.decision=p.payload.decision.identity;r.payload.plan={plan_id:p.plan_id,plan_hash:p.plan_hash};r.payload.results=p.payload.operations.map(o=>{const row=Object.fromEntries(Object.entries(o.result.existing_row??o.result.row_template).map(([k,v])=>[k,typeof v==='object'?r.payload.apply_time:v]));return {operation_id:o.operation_id,classification:o.classification,table:o.table,key:o.key,row,row_hash:hashCanonicalJson({table:o.table,row})};});r.record_hash=hashCanonicalJson(r.payload);success.terminal.history.head_hash=r.record_hash;success.terminal.state_hash=hashState(success.terminal);
  await publishTestHistory(f,r,success.terminal);assert.equal((await f.service.checkApplyPlan(p)).status,'ALREADY_APPLIED');await assert.rejects(f.service.generateApplyPlan({decision_id:f.decision.decision_id}),{code:'ALREADY_APPLIED'});
  const bad=copy(p);bad.payload.decision.identity.content_hash='f'.repeat(64);rehash(bad);assert.equal((await f.service.checkApplyPlan(bad)).status,'INTEGRITY_CONFLICT');const other=copy(p);other.payload.decision.identity.revision++;rehash(other);await assert.rejects(f.service.checkApplyPlan(other),{code:'APPLIED_DECISION_REVISION_UNSUPPORTED'});
});
test('corrupt saved artifacts and generic Plan overwrite attempts are rejected',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});await f.service.saveApplyPlan(p);const repo=await createFn004Repository(f.root);await withCanonicalGate({root:f.root,fn:gate=>assert.rejects(repo.writeJsonAtomic(`staging/apply-plans/${p.plan_id}.json`,p,{gate}),{code:'PATH_UNSAFE'})});await fs.writeFile(join(f.root,`staging/apply-plans/${p.plan_id}.json`),'{}');await assert.rejects(f.service.getApplyPlan(p.plan_id),{code:'PLAN_INTEGRITY_CONFLICT'});await assert.rejects(f.service.saveApplyPlan(p),{code:'PLAN_INTEGRITY_CONFLICT'});});
test('file-sync failure never publishes a partial Plan and keeps failure evidence',async t=>{const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id});const broken=createApplyPlanService({root:f.root,io:{...fs,open:async(path,...args)=>{const h=await fs.open(path,...args);return new Proxy(h,{get(target,key){if(key==='sync'&&path.includes('.tmp-'))return async()=>{throw new Error('injected file sync');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});}}});await assert.rejects(broken.saveApplyPlan(p),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='file_sync'&&!e.published);await assert.rejects(fs.stat(join(f.root,`staging/apply-plans/${p.plan_id}.json`)),{code:'ENOENT'});await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});});

test('unsupported diagnostics preserve explicit target tables without inventing ambiguous targets',()=>{
  const f=planFixture(),d=copy(f.store.revisions[0]);
  d.unsupported_requests=[
    ['new_member',null],['update_existing','J00001'],['delete','releases'],['member_affiliation',null],['video','video_songs'],['large_correction','song:s1'],['update_existing',null],['delete','unresolved human description']
  ].map(([kind,target],i)=>({request_ref:`unsupported:u${i+1}`,kind,target,description:'Unsupported intent',evidence_refs:[]}));seal(d);
  const result=diagnoseUnsupportedRequests(d),tables=new Map(result.operations.map(o=>[o.result.request_ref,o.table]));
  assert.deepEqual([...tables.entries()].sort(),[['unsupported:u1','members'],['unsupported:u2','songs'],['unsupported:u3','releases'],['unsupported:u4','member_affiliations'],['unsupported:u5','video_songs'],['unsupported:u6','songs']]);
  assert.equal(result.diagnostics.length,8);assert.ok(result.diagnostics.some(x=>x.code==='EXISTING_UPDATE'&&x.target===null));assert.ok(result.diagnostics.some(x=>x.code==='DELETE'&&x.target===null));
  assert.throws(()=>generatePlanFromInput({...f,decision:d}),{code:'DECISION_NOT_EFFECTIVE'});
});

test('standalone artifact validation rejects missing FK dependencies and insert ID inconsistencies',()=>{
  const f=withNewEntities(planFixture()),p=generatePlanFromInput(f);
  for(const mutate of [x=>x.payload.operations.find(o=>o.table==='songs').dependencies=[],x=>{const op=x.payload.operations.find(o=>o.table==='works');op.result.row_template.work_id='W99999';op.key.work_id='W99999';}]){
    const bad=copy(p);mutate(bad);rehash(bad);assert.throws(()=>validateApplyPlan(bad),{code:'PLAN_INTEGRITY_CONFLICT'});
  }
});
test('unsupported diagnostic operations cannot be persisted as formal Plan artifacts',async t=>{
  const f=await runtimeFixture(t),p=await f.service.generateApplyPlan({decision_id:f.decision.decision_id}),d=copy(f.store.revisions[0]);
  d.unsupported_requests=[{request_ref:'unsupported:u1',kind:'new_member',target:null,description:'unsupported',evidence_refs:[]}];seal(d);
  const diagnostic=diagnoseUnsupportedRequests(d),op=diagnostic.operations[0];
  // Give the operation the formal Plan's Decision identity to ensure rejection
  // is the unsupported-artifact boundary, rather than a malformed hash.
  const {canonicalOperationId}=await import('../src/fn004-plan-primitives.js');op.operation_id=canonicalOperationId(p.payload.decision.identity.decision_id,op.table,op.source.subject);
  const {comparePlanOperations}=await import('../src/fn004-plan-primitives.js');p.payload.operations.push(op);p.payload.operations.sort((a,b)=>comparePlanOperations(a,b,f.decision));p.payload.unsupported_operations=[op.operation_id];
  const error={...diagnostic.diagnostics[0],target:op.operation_id};p.payload.validation.diagnostics.push(error);p.payload.validation.diagnostics.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0);
  const {planApplicability}=await import('../src/fn004-plan-target.js');p.payload.applicability=planApplicability(p.payload.operations,p.payload.validation);rehash(p);
  assert.throws(()=>validateApplyPlan(p),{code:'PLAN_INTEGRITY_CONFLICT'});await assert.rejects(f.service.saveApplyPlan(p),{code:'PLAN_INTEGRITY_CONFLICT'});
});

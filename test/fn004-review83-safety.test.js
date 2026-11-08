import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {prepareFixture} from './fixtures/durable-prepare.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';
import {createApplyPlanService} from '../src/fn004-plan-application.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';

const stopped=error=>['RECOVERY_REQUIRED','INTEGRITY_CONFLICT','GATE_CORRUPT','GATE_BUSY'].includes(error.code);
for(const kind of ['barrier','archive']) {
  async function orphan(f) {
    const path=kind==='barrier'?'staging/.fn004-recovery.lock':
      `staging/recovery-ownership/${f.binding.transaction_id}/anchor.json`;
    await fs.mkdir(dirname(join(f.root,path)),{recursive:true});
    await fs.writeFile(join(f.root,path),'{}');
    return path;
  }
  test(`R83 guard ${kind}: orphan Recovery work blocks genesis reader and Plan`,async t=>{
    const f=await normalApplyFixture(t),path=await orphan(f);
    await assert.rejects(readValidatedCanonicalSnapshot(f.root),stopped);
    await assert.rejects(createApplyPlanService({root:f.root}).checkApplyPlan(f.plan.plan_id),stopped);
    assert.equal(await fs.readFile(join(f.root,path),'utf8'),'{}');
  });
  test(`R83 guard ${kind}: reject before Receipt or Owner, preserve unknown evidence and state`,async t=>{
    const f=await normalApplyFixture(t),path=await orphan(f);
    const state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
    await assert.rejects(createCanonicalApplyService({root:f.root}).submitApplyRequest(f.payload,f.context));
    await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)),{code:'ENOENT'});
    assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
    assert.equal(await fs.readFile(join(f.root,path),'utf8'),'{}');
    assert.deepEqual(await fs.readdir(join(f.root,'staging/transactions')),[]);
  });
}

test('R83-M01 corrupt unfinished Journal is a typed integrity error, not a normal recovery DTO',async t=>{
  const f=await prepareFixture(t),path=`staging/transactions/${f.binding.transaction_id}/journal/000001.json`;
  await fs.mkdir(dirname(join(f.root,path)),{recursive:true});await fs.writeFile(join(f.root,path),'{}');
  const service=createApprovalRequestService({root:f.root});
  await assert.rejects(service.checkApplyRequest(f.binding.request_id,{actor:f.binding.actor,gate:f.gate}),
    {code:'INTEGRITY_CONFLICT'});
  assert.equal(await fs.readFile(join(f.root,path),'utf8'),'{}');
});

for(const kind of ['owner','intent','journal-hash','cache','input-copy'])test(`R83-M01 unfinished ${kind} corruption is never a normal DTO`,async t=>{
  const f=await prepareFixture(t),root=`staging/transactions/${f.binding.transaction_id}`;
  const path=kind==='owner'?`${root}/owner.json`:kind==='intent'?`${root}/intent.json`:
    kind==='journal-hash'?`${root}/journal/000001.json`:kind==='cache'?`${root}/transaction.json`:`${root}/plan.json`;
  const bad=kind==='journal-hash'?{...structuredClone(f.genesis),hash:'0'.repeat(64)}:{};
  await fs.mkdir(dirname(join(f.root,path)),{recursive:true});await fs.writeFile(join(f.root,path),JSON.stringify(bad));
  const original=await fs.readFile(join(f.root,path));
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate}),{code:'INTEGRITY_CONFLICT'});
  assert.deepEqual(await fs.readFile(join(f.root,path)),original);
  assert.deepEqual(await f.protectedHashes(),f.before);
});

for(const kind of ['backup','temp'])test(`R83-M01 unfinished ${kind} hash mismatch remains a typed error`,async t=>{
  const f=await prepareFixture(t),{createTransactionPreparer}=await import('../src/fn004-durable-prepare.js');
  const prepared=await(await createTransactionPreparer(f.root)).prepare({gate:f.gate,binding:f.binding,apply_time:f.apply_time});
  const refs=prepared.intent.payload[kind==='backup'?'backup_refs':'temp_refs'],path=refs.find(r=>r.path.endsWith('.csv')).path;
  await fs.appendFile(join(f.root,path),'unknown');const original=await fs.readFile(join(f.root,path));
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate}),{code:'INTEGRITY_CONFLICT'});
  assert.deepEqual(await fs.readFile(join(f.root,path)),original);
  assert.deepEqual(await f.protectedHashes(),f.before);
});

for(const sameRequest of [true,false])test(`R83-M02 concurrent valid ${sameRequest?'same':'different'} Request: exactly one real execution`,{timeout:900000},async t=>{
  const f=await normalApplyFixture(t,{newEntities:true});
  const {newApprovalId,newRequestId,approvalHash}=await import('../src/fn004-approval-schema.js');
  let second=f.payload;
  if(!sameRequest){
    const approval=await createApprovalRequestService({root:f.root}).approveApplyPlan({approval_id:newApprovalId(),
      plan_id:f.plan.plan_id,plan_hash:f.plan.plan_hash,intended_request_id:newRequestId()},f.context);
    second={...f.payload,request_id:approval.intended_request_id,approval_id:approval.approval_id,approval_hash:approvalHash(approval)};
    assert.equal((await createApprovalRequestService({root:f.root}).checkApproval(approval.approval_id,f.context)).status,'APPLICABLE');
  }
  const before=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  let entered,release,owners=0;
  const paused=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  const first=createCanonicalApplyService({root:f.root,onBoundary:async e=>{
    if(e.phase==='receipt:after'){entered();await resume;}
    if(e.phase==='owner:after')owners++;
  }}).submitApplyRequest(f.payload,f.context);
  const contender=createCanonicalApplyService({root:f.root,clock:()=>{throw Error('contender allocated time');},
    onBoundary:()=>{throw Error('contender dispatched');}});
  let completed,receipt;
  try {
    await Promise.race([paused,first.then(()=>{throw Error('First submit did not pause');})]);
    receipt=await fs.readFile(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`));
    await assert.rejects(contender.submitApplyRequest(second,f.context),{code:'GATE_BUSY'});
    assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),before);
    assert.equal(owners,0);
    if(!sameRequest)await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${second.request_id}.json`)),{code:'ENOENT'});
  } finally {release();completed=await first;}
  assert.equal(owners,1);assert.ok(completed.result);
  const state=await fs.readFile(join(f.root,'staging/fn004-state.json')),parsed=JSON.parse(state);
  assert.equal(parsed.generation,f.state.generation+2);assert.equal(parsed.history.count,1);assert.equal(parsed.pending_transaction,null);
  assert.equal(new Set(parsed.allocation_events.map(e=>e.transaction_id)).size,1);
  assert.equal((await fs.readdir(join(f.root,'staging/apply-history'))).length,1);
  assert.deepEqual(await fs.readFile(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)),receipt);
  const retry=await contender.submitApplyRequest(f.payload,f.context);
  assert.equal(retry.readiness,'initialized');assert.deepEqual(retry.result,completed.result);
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
  if(!sameRequest){
    await assert.rejects(contender.submitApplyRequest(second,f.context),{code:'ALREADY_APPLIED'});
    await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${second.request_id}.json`)),{code:'ENOENT'});
  }
  await readValidatedCanonicalSnapshot(f.root);
});

test('R83-M01 complete unpublished Owner publication stays recovery-required and is never adopted',async t=>{
  const f=await prepareFixture(t),root=`staging/transactions/${f.binding.transaction_id}`;
  const path=`${root}/.fn004-owner.json.tmp-00000000-0000-4000-8000-000000000099`;
  await fs.rename(join(f.root,`${root}/owner.json`),join(f.root,path));
  const original=await fs.readFile(join(f.root,path));
  const dto=await createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate});
  assert.equal(dto.readiness,'recovery_required');assert.equal(dto.result,null);
  await assert.rejects(fs.stat(join(f.root,`${root}/owner.json`)),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(join(f.root,path)),original);assert.deepEqual(await f.protectedHashes(),f.before);
});

test('R83-M01 Proof-only conflicts with a different valid local Journal prefix and cannot hide behind missing Completion',async t=>{
  const f=await prepareFixture(t),{terminalProof}=await import('../src/fn004-failure-terminal.js');
  const proof=terminalProof({binding:f.binding,owner:f.owner,inputs:f.inputs,intent:null,
    chain:{head:null,entries:[]},authority:{gate:f.owner.payload.gate,recovery:null},
    ended_at:f.request.receipt.requested_at,histories:[]});
  const proofPath=`staging/transaction-proofs/${f.binding.transaction_id}.json`;
  await fs.mkdir(dirname(join(f.root,proofPath)),{recursive:true});await fs.writeFile(join(f.root,proofPath),JSON.stringify(proof));
  const journal=`staging/transactions/${f.binding.transaction_id}/journal/000001.json`;
  await fs.mkdir(dirname(join(f.root,journal)),{recursive:true});await fs.writeFile(join(f.root,journal),JSON.stringify(f.genesis));
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate}),{code:'INTEGRITY_CONFLICT'});
  assert.deepEqual(JSON.parse(await fs.readFile(join(f.root,proofPath))),proof);
  assert.deepEqual(await f.protectedHashes(),f.before);
});

async function preIntentFixture(t,phase='temp_checkpoint:after'){
  const f=await prepareFixture(t),{createTransactionPreparer}=await import('../src/fn004-durable-prepare.js');
  const stop=Error('fixture stops before Intent');
  const preparer=await createTransactionPreparer(f.root,{onBoundary:e=>{if(e.phase===phase)throw stop;}});
  await assert.rejects(preparer.prepare({gate:f.gate,binding:f.binding,apply_time:f.apply_time}),e=>e===stop);
  await assert.rejects(fs.stat(join(f.root,`staging/transactions/${f.binding.transaction_id}/intent.json`)),{code:'ENOENT'});
  const {discoverJournal}=await import('../src/fn004-evidence-discovery.js');
  const {validateJournalChain}=await import('../src/fn004-journal-chain.js');
  const {artifacts,discovery}=await discoverJournal(f.root,f.binding.transaction_id);
  const chain=validateJournalChain({owner:f.owner,intent:null,entries:artifacts,inputs:f.inputs});
  return {f,chain,discovery};
}
for(const kind of ['checkpoint','unbound'])test(`R83-M01 pre-Intent ${kind} backup bytes bind to original evidence without Intent`,async t=>{
  const {f,chain,discovery}=await preIntentFixture(t,kind==='checkpoint'?'temp_checkpoint:after':'backup:after');
  const path=kind==='checkpoint'?chain.head.payload.backup_refs.find(r=>r.path.endsWith('.csv')).path:
    discovery.files.find(v=>v.kind==='file'&&v.path.includes('/backup/data/')).path;
  await fs.appendFile(join(f.root,path),'unknown');
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate}),{code:'INTEGRITY_CONFLICT'});
  assert.deepEqual(await f.protectedHashes(),f.before);
});

test('R83-M03 pre-Intent ABORTED retains Journal refs for cleanup, rejects unexpected restore, then permits readers',async t=>{
  const {f,chain}=await preIntentFixture(t);
  const {recoveryEnvelope}=await import('../src/fn004-recovery-authority.js');
  const {validateJournalChain}=await import('../src/fn004-journal-chain.js');
  const {terminalProof,terminalCompletion}=await import('../src/fn004-failure-terminal.js');
  const {evidencePath}=await import('../src/fn004-evidence-persistence.js');
  const {createPersistence}=await import('../src/persistence.js');
  const {inspectRuntimeState}=await import('../src/fn004-runtime-state.js');
  const entry=recoveryEnvelope('fn004-journal',{...structuredClone(chain.head.payload),sequence:chain.head.payload.sequence+1,
    previous_entry_hash:chain.head.hash,phase:'ABORTED',terminal_state:f.state});
  const terminal=validateJournalChain({owner:f.owner,intent:null,entries:[...chain.entries,entry],inputs:f.inputs});
  const proof=terminalProof({binding:f.binding,owner:f.owner,inputs:f.inputs,intent:null,chain:terminal,histories:[]});
  const completion=terminalCompletion(proof);
  for(const value of [entry,proof,completion]){
    const path=evidencePath(value);await fs.mkdir(dirname(join(f.root,path)),{recursive:true});await fs.writeFile(join(f.root,path),JSON.stringify(value));
  }
  assert.equal(proof.payload.intent,null);assert.equal(completion.payload.terminal_journal.sequence,entry.payload.sequence);
  const store=await createPersistence(f.root),observe=()=>inspectRuntimeState(store,{gate:f.gate});
  assert.equal((await observe()).readiness,'cleanup_required');
  await assert.rejects(readValidatedCanonicalSnapshot(f.root,{gate:f.gate}),{code:'RECOVERY_REQUIRED'});
  const canonical=entry.payload.changed_paths[0],restore=`staging/transactions/${f.binding.transaction_id}/restore/${canonical}`;
  const backup=`staging/transactions/${f.binding.transaction_id}/backup/${canonical}`;
  await fs.mkdir(dirname(join(f.root,restore)),{recursive:true});await fs.copyFile(join(f.root,backup),join(f.root,restore));
  await assert.rejects(createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,
    {actor:f.binding.actor,gate:f.gate}),{code:'INTEGRITY_CONFLICT'});
  await fs.unlink(join(f.root,restore));
  for(const ref of [...entry.payload.backup_refs,...entry.payload.temp_refs])await fs.unlink(join(f.root,ref.path));
  assert.equal((await observe()).readiness,'cleanup_required');
  await f.releaseFixtureGate();await readValidatedCanonicalSnapshot(f.root);
  const dto=await createApprovalRequestService({root:f.root}).checkApplyRequest(f.binding.request_id,{actor:f.binding.actor});
  assert.equal(dto.readiness,'initialized');assert.equal(dto.result,null);
  assert.deepEqual(await f.protectedHashes(),f.before);
});

test('R83-M04 unbound Journal and published Intent refs cannot hide a same-path contradiction',async()=>{
  const {transactionFixture,append,recoveryDiscovery}=await import('./fixtures/transaction-evidence.js');
  const {validateJournalChain}=await import('../src/fn004-journal-chain.js');
  const {validateOtherLocalEvidence}=await import('../src/fn004-local-evidence-validation.js');

const f=transactionFixture(),p=f.intent.payload;
const refs=structuredClone(p.backup_refs);refs.find(r=>r.path.endsWith('/backup/fn004-state.json')).sha256='0'.repeat(64);
const head=append(f.genesis,{target_manifest:p.target_manifest,changed_paths:p.changed_paths,backup_refs:refs,temp_refs:p.temp_refs});
validateJournalChain({owner:f.owner,intent:f.intent,entries:[f.genesis,head],inputs:f.inputs});
const d=recoveryDiscovery(f,{journal:[f.genesis,head],intent:f.intent}),codes=[];
assert.throws(()=>validateOtherLocalEvidence({selected:{request_id:null},requests:[f.request],docs:d.documents,files:d.files,rawBytes:d.rawBytes,histories:[],attempt:fn=>fn(),add:c=>codes.push(c)}),{code:'INTEGRITY_CONFLICT'});
});

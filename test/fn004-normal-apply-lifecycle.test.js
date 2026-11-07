import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';
import {createApplyPlanService} from '../src/fn004-plan-application.js';
import {approvalHash,newApprovalId,newRequestId} from '../src/fn004-approval-schema.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';

test('6E source change after Receipt aborts under the same owner, without fake Intent or redispatch',{timeout:900000},async t=>{
  const f=await normalApplyFixture(t),before=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  const service=createCanonicalApplyService({root:f.root,onBoundary:async e=>{
    if(e.phase==='receipt:after'){
      const candidates=structuredClone(f.candidates);candidates.candidates[0].title='changed after durable acceptance';
      await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify(candidates));
    }
  }});
  const response=await service.submitApplyRequest(f.payload,f.context);
  assert.equal(response.readiness,'cleanup_required');assert.equal(response.result,null);
  const tx=response.artifact.receipt.transaction_id;
  const proof=JSON.parse(await fs.readFile(join(f.root,`staging/transaction-proofs/${tx}.json`)));
  assert.equal(proof.payload.phase,'ABORTED');assert.equal(proof.payload.intent,null);
  assert.deepEqual(proof.payload.journal,[]);assert.deepEqual(proof.payload.diagnostics,[{code:'STALE_PLAN'}]);
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),before);
  const retry=await service.submitApplyRequest(f.payload,f.context);
  assert.deepEqual(retry.artifact,response.artifact);assert.equal(retry.readiness,'initialized');
  assert.ok(retry.diagnostics.some(d=>d.code==='STALE_PLAN'));
});

test('6E consumed rollback permits a newly approved Plan above burned IDs, then publishes one successful History',{timeout:1800000},async t=>{
  const f=await normalApplyFixture(t,{newEntities:true});let fired=false;
  const start=performance.now(),stage=label=>console.error(`6E continuity ${label}: ${Math.round(performance.now()-start)}ms`);
  const onBoundary=e=>{if(['receipt:after','prepared:after','consume:after','replace_last:after','decided:after','history:after','success_state:after','proof:after','completion:after','gate_release:after'].includes(e.phase))stage(e.phase);};
  stage('first rollback starting');
  const cause=Object.assign(Error('rollback connection fixture'),{code:'EIO'});
  const io={...fs,rename:async(from,to)=>{
    await fs.rename(from,to);
    if(!fired&&to===join(f.root,'data/songs.csv')){fired=true;throw cause;}
  }};
  await assert.rejects(createCanonicalApplyService({root:f.root,io,onBoundary}).submitApplyRequest(f.payload,f.context),e=>e.cause===cause);
  assert.equal(fired,true);stage('first rollback finished');
  const rollback=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  assert.equal(rollback.generation,2);assert.equal(rollback.pending_transaction,null);assert.equal(rollback.history.count,0);
  const plans=createApplyPlanService({root:f.root}),plan=await plans.generateApplyPlan({decision_id:f.decision.decision_id});
  await plans.saveApplyPlan(plan);stage('new Plan saved');
  for(const mapping of plan.payload.planned_id_mappings){
    assert.ok(Number(mapping.planned_id.slice(1))>rollback.high_water_marks[mapping.namespace]);
  }
  const service=createCanonicalApplyService({root:f.root,onBoundary});
  const approval=await service.approveApplyPlan({approval_id:newApprovalId(),intended_request_id:newRequestId(),
    plan_id:plan.plan_id,plan_hash:plan.plan_hash},f.context);
  stage('new Approval saved');
  const payload={...f.payload,request_id:approval.intended_request_id,approval_id:approval.approval_id,
    approval_hash:approvalHash(approval),plan_id:plan.plan_id,plan_hash:plan.plan_hash};
  const response=await service.submitApplyRequest(payload,f.context);assert.equal(response.readiness,'cleanup_required');assert.ok(response.result);stage('new success returned');
  const after=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  assert.equal(after.generation,4);assert.equal(after.pending_transaction,null);assert.equal(after.history.count,1);
  assert.deepEqual(after.allocation_events.slice(0,rollback.allocation_events.length),rollback.allocation_events);
  for(const key of Object.keys(after.high_water_marks))assert.ok(after.high_water_marks[key]>=rollback.high_water_marks[key]);
  assert.deepEqual((await service.submitApplyRequest(f.payload,f.context)).result,null);
  assert.deepEqual((await service.submitApplyRequest(payload,f.context)).result,response.result);
  assert.equal((await fs.readdir(join(f.root,'staging/apply-history'))).length,1);
  await readValidatedCanonicalSnapshot(f.root);stage('reader and both retries verified');
});

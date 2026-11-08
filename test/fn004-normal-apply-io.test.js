import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {createCanonicalApplyService as createApprovalRequestService} from '../src/fn004-apply-application.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';
import {readApplyHistory} from '../src/fn004-history-runtime.js';
import {createApplyPlanService} from '../src/fn004-plan-application.js';

describe('6E normal dispatch I/O and fail-closed guards',{concurrency:2},()=>{
for(const kind of ['consume-before','consume-after','mixed-replace-after','last-replace-after'])test(`6E ${kind}: original typed failure survives safe terminalization`,{timeout:900000},async t=>{
  const f=await normalApplyFixture(t,{newEntities:kind==='mixed-replace-after'}),cause=Object.assign(Error('injected normal commit rename EIO'),{code:'EIO'});
  let fired=false,lastPath;
  const io={...fs,rename:async(from,to)=>{
    const hit=!fired&&(kind.startsWith('consume')?to===join(f.root,'staging/fn004-state.json'):
      to===join(f.root,kind==='mixed-replace-after'?'data/songs.csv':lastPath??'not-yet-known'));
    if(hit&&kind==='consume-before'){fired=true;throw cause;}
    await fs.rename(from,to);if(hit){fired=true;throw cause;}
  }};
  const service=createApprovalRequestService({root:f.root,io,onBoundary:async e=>{
    if(e.phase==='prepared:after'){
      const dirs=await fs.readdir(join(f.root,'staging/transactions'));
      const intent=JSON.parse(await fs.readFile(join(f.root,'staging/transactions',dirs[0],'intent.json')));
      lastPath=intent.payload.changed_paths.at(-1);
    }
  }});
  await assert.rejects(service.submitApplyRequest(f.payload,f.context),error=>{
    assert.equal(fired,true);assert.equal(error.cause,cause);assert.equal(error.phase,'publish');
    assert.equal(error.published,kind!=='consume-before');assert.equal(typeof error.path,'string');
    assert.equal(error.recovery_error,undefined,error.recovery_error?.stack);return true;
  });
  const request=JSON.parse(await fs.readFile(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)));
  const beforeRetry=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  const retry=createApprovalRequestService({root:f.root,onBoundary:()=>{throw Error('IO retry dispatched');},clock:()=>{throw Error('IO retry generated time');}});
  const response=await retry.submitApplyRequest(f.payload,f.context);
  const success=kind==='last-replace-after';assert.equal(response.result!==null,success);assert.equal(response.readiness,'initialized');
  assert.deepEqual(response.artifact,request);assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),beforeRetry);
  const snapshot=await readCanonicalSnapshot(f.root);assert.equal(snapshot.validation.ok,true);
  if(!success)assert.deepEqual(snapshot.manifest,f.snapshot.manifest);
  const proof=JSON.parse(await fs.readFile(join(f.root,`staging/transaction-proofs/${request.receipt.transaction_id}.json`)));
  assert.equal(proof.payload.phase,success?'COMPLETED':'ROLLED_BACK');
  assert.equal(proof.payload.diagnostics.some(d=>d.code==='PERSISTENCE_WRITE_FAILED'),true);
  await readValidatedCanonicalSnapshot(f.root);
  if(kind==='mixed-replace-after'){
    // A rollback proof establishes the burned IDs/current state independently;
    // the legacy success-only reader must retain its old refusal boundary.
    await assert.rejects(readApplyHistory({root:f.root}),{code:'STATE_TRANSITION_PROOF_REQUIRED'});
    const plan=await createApplyPlanService({root:f.root}).generateApplyPlan({decision_id:f.decision.decision_id});
    assert.equal(plan.payload.id_state_precondition.state_hash,proof.payload.after_state.state_hash);
    assert.notDeepEqual(plan.payload.id_state_precondition.high_water_marks,f.plan.payload.id_state_precondition.high_water_marks);
  }
});

test('6E unknown bytes after consumption are preserved, never restored or terminalized',{timeout:900000},async t=>{
  const f=await normalApplyFixture(t),path=join(f.root,'data/works.csv');let unknown;
  const service=createApprovalRequestService({root:f.root,onBoundary:async e=>{
    if(e.phase==='consume:after'){unknown=Buffer.concat([await fs.readFile(path),Buffer.from('unknown')]);await fs.writeFile(path,unknown);}
  }});
  await assert.rejects(service.submitApplyRequest(f.payload,f.context));assert.ok(unknown);
  assert.deepEqual(await fs.readFile(path),unknown);
  const state=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  assert.notEqual(state.pending_transaction,null);assert.equal(state.generation,f.state.generation+1);
  await assert.rejects(fs.stat(join(f.root,`staging/transaction-proofs/${state.pending_transaction}.json`)),{code:'ENOENT'});
  assert.ok(await fs.stat(join(f.root,'staging/.fn004.lock')));
});
});

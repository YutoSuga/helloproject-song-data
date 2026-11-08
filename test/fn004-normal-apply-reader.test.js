import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';
import {createApplyPlanService} from '../src/fn004-plan-application.js';
import {createApprovalRequestService} from '../src/fn004-approval-application.js';
import {withCanonicalGate,assertGateOwnership} from '../src/fn004-gate.js';
import {createBootstrapService} from '../src/fn004-bootstrap.js';
import {createDecisionService} from '../src/fn004-decision-application.js';
import {createPersistence} from '../src/persistence.js';
import {inspectRuntimeState} from '../src/fn004-runtime-state.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';

test('6E internal composition keeps the existing acceptance-only default until 6F',async t=>{
  const f=await normalApplyFixture(t),before=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  const response=await createApprovalRequestService({root:f.root}).submitApplyRequest(f.payload,f.context);
  assert.equal(response.readiness,'recovery_required');assert.equal(response.result,null);
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),before);
  await assert.rejects(fs.stat(join(f.root,`staging/transactions/${response.artifact.receipt.transaction_id}/owner.json`)),{code:'ENOENT'});
});

test('6E terminal readiness requires Completion and exact cleanup, then evaluates response under the original lease',{timeout:900000},async t=>{
  const f=await normalApplyFixture(t),store=await createPersistence(f.root),observations=[];
  await withCanonicalGate({root:f.root,fn:async gate=>{
    const service=createCanonicalApplyService({root:f.root,onBoundary:async e=>{
      if(!['proof:after','completion:after','response:before'].includes(e.phase))return;
      await assertGateOwnership(gate,f.root);
      const runtime=await inspectRuntimeState(store,{gate});observations.push([e.phase,runtime.readiness]);
      await assert.rejects(readValidatedCanonicalSnapshot(f.root,{gate}),{code:'RECOVERY_REQUIRED'});
      if(e.phase==='response:before')await assert.rejects(createApplyPlanService({root:f.root}).checkApplyPlan(f.plan.plan_id,{gate}),{code:'RECOVERY_REQUIRED'});
    }});
    const response=await service.submitApplyRequest(f.payload,{...f.context,gate});assert.equal(response.readiness,'cleanup_required');
  }});
  assert.deepEqual(observations,[['proof:after','recovery_required'],['completion:after','cleanup_required'],['response:before','cleanup_required']]);
  await readValidatedCanonicalSnapshot(f.root);
  const status=await createBootstrapService().inspectBootstrapStatus({root:f.root});
  assert.equal(status.status,'READY');assert.equal(status.readiness,'initialized');
  assert.equal(Object.hasOwn(status,'terminal_context'),false);
  await createDecisionService({root:f.root}).buildDecisionRegistry();
});

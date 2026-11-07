import test from 'node:test';
import assert from 'node:assert/strict';
import {commitFixture,rollbackFixture,recoveryDiscovery,exitedProbe,uuid} from './fixtures/transaction-evidence.js';
import {prepareRecoverySnapshot} from '../src/fn004-recovery-snapshot.js';
import {classifyRecoverySnapshot} from '../src/fn004-recovery-classifier.js';
import {hashState} from '../src/fn004-state.js';

const path=`staging/.fn004-fn004-state.json.tmp-${uuid}`;
async function classify(f,options){
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({binding:f.binding,
    discovery:recoveryDiscovery(f,options),git_audit:f.git_audit,probe:exitedProbe(f.process)}));
}
test('6E state temp before consumption is exact unpublished evidence, never proof of consumed IDs',async()=>{
  const f=commitFixture(),options={journal:f.journal.slice(0,3),intent:f.intent,
    extra:{[path]:f.intent.payload.expected_consumed_state}};
  const o=await classify(f,options);assert.deepEqual(o.allowed_actions,['rollback']);
  assert.equal(o.readiness,'recovery_required');
  const wrong=structuredClone(f.intent.payload.expected_consumed_state);
  wrong.pending_transaction='tx_00000000-0000-4000-8000-000000000099';wrong.state_hash=hashState(wrong);
  for(const invalid of [wrong,f.after]){
    const rejected=await classify(f,{...options,extra:{[path]:invalid}});
    assert.deepEqual(rejected.allowed_actions,[]);assert.ok(rejected.diagnostics.some(d=>d.code==='INTEGRITY_CONFLICT'));
  }
});
test('6E success state temp before rename binds exact decision outcome, without pretending state advanced',async()=>{
  const f=commitFixture(),o=await classify(f,{journal:f.journal.slice(0,7),intent:f.intent,target:true,
    state:f.intent.payload.expected_consumed_state,extra:{[path]:f.after,[`staging/apply-history/${f.binding.apply_id}.json`]:f.record}});
  assert.deepEqual(o.allowed_actions,['finalize_success']);assert.equal(o.readiness,'recovery_required');
});
test('6E rollback state temp before rename retains consumed high-water and requires actual restore',async()=>{
  const f=rollbackFixture(),o=await classify(f,{journal:f.journal.slice(0,-1),intent:f.intent,
    state:f.intent.payload.expected_consumed_state,extra:{[path]:f.after}});
  assert.deepEqual(o.allowed_actions,['rollback']);assert.equal(o.readiness,'recovery_required');
});

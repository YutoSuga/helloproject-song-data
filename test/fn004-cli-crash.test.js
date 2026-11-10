import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {cli,tty,cliFixture,evidenceHashes} from './fixtures/canonical-cli.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';

describe('6F actual TTY process kill and public CLI-only restart',{concurrency:2},()=>{
 for(const boundary of ['receipt:before','receipt:after','owner:before','owner:after','preparing:after','prepared:after',
  'consume:before','consume:after','replace:before','replace:after','decided:before','decided:after','history:after',
  'success_state:after','proof:after','completion:after','gate_release:before','gate_release:after']) {
 test(`6F CLI SIGKILL ${boundary}`,{timeout:1800000},async t=>{
  const f=await cliFixture(t);
  const killed=await tty(f.root,f.args,{mode:'kill',target:boundary});
  assert.equal(killed.killed,true,JSON.stringify(killed));assert.equal(killed.code,-9);
  const approvals=await fs.readdir(join(f.root,'staging/apply-approvals'));
  const created=approvals.filter(name=>name!==f.binding.approval_id+'.json'&&name.endsWith('.json'));
  assert.equal(created.length,1);
  const approval=JSON.parse(await fs.readFile(join(f.root,'staging/apply-approvals',created[0])));
  const requestId=approval.intended_request_id;
  const inventory=await evidenceHashes(f.root);
  if(boundary==='receipt:before'){
   await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${requestId}.json`)),{code:'ENOENT'});
   assert.equal((await cli(f.root,['recovery','inspect','--request',requestId])).code,1);
   assert.deepEqual(await evidenceHashes(f.root),inventory);return;
  }
  const requestPath=join(f.root,`staging/apply-requests/${requestId}.json`),receipt=await fs.readFile(requestPath),r=JSON.parse(receipt).receipt;
  const inspected=await cli(f.root,['recovery','inspect','--request',requestId]);assert.equal(inspected.code,0,JSON.stringify(inspected));
  const observation=inspected.data.data;
  assert.deepEqual(await evidenceHashes(f.root),inventory);
  if(['receipt:after','owner:before'].includes(boundary)){
   assert.deepEqual(observation.allowed_actions,[]);assert.equal(observation.classification,'manual_stop');
   assert.equal((await cli(f.root,['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',observation.observed_state_hash,'--action','abort'])).code,6);
   assert.deepEqual(await evidenceHashes(f.root),inventory);return;
  }
  const stateBefore=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  if(observation.allowed_actions.length){
   const command=['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',observation.observed_state_hash,'--action',observation.allowed_actions[0]];
   const wrongHash=await cli(f.root,command.map(v=>v===observation.observed_state_hash?'0'.repeat(64):v));assert.equal(wrongHash.code,6);
   assert.deepEqual(await evidenceHashes(f.root),inventory);
   const action=observation.allowed_actions[0];
   const wrongAction=await cli(f.root,command.map(v=>v===action?(action==='abort'?'rollback':'abort'):v));assert.equal(wrongAction.code,6);
   assert.deepEqual(await evidenceHashes(f.root),inventory);
   const resumed=await cli(f.root,command);assert.ok([0,11].includes(resumed.code),JSON.stringify(resumed));
   assert.equal(resumed.data.data.observation.readiness,'initialized');
   assert.equal((await cli(f.root,command)).code,6);
  } else assert.equal(observation.readiness,'initialized');
  const stateAfter=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
  assert.deepEqual(stateAfter.high_water_marks,stateBefore.high_water_marks);assert.deepEqual(stateAfter.allocation_events,stateBefore.allocation_events);
  assert.equal(stateAfter.pending_transaction,null);
  assert.equal((await readCanonicalSnapshot(f.root)).validation.ok,true);
  assert.deepEqual(await fs.readFile(requestPath),receipt);
  const final=await cli(f.root,['result','--request',requestId]);assert.ok([0,11].includes(final.code),JSON.stringify(final));
  assert.equal(final.data.readiness,'initialized');
 });
 }
});

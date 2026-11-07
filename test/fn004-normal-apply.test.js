import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {normalApplyFixture as fixture} from './fixtures/normal-apply.js';
import {createCanonicalApplyService as createApprovalRequestService} from '../src/fn004-apply-application.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';
import {CANONICAL_TABLES} from '../src/canonical-schema.js';

for(const options of [{},{newEntities:true},{noop:true}])test(`6E real initial submit completes and same Request never redispatches ${JSON.stringify(options)}`,{timeout:900000},async t=>{
 const f=await fixture(t,options),phases=[],events=[];
 const service=createApprovalRequestService({root:f.root,onBoundary:e=>{phases.push(e.phase);events.push({...e});}});
 const response=await service.submitApplyRequest(f.payload,f.context);
 assert.equal(response.readiness,'cleanup_required',JSON.stringify(response));assert.ok(response.result);
 const r=response.artifact.receipt,read=path=>fs.readFile(join(f.root,path),'utf8').then(JSON.parse);
 const state=await read('staging/fn004-state.json');
 assert.equal(state.generation,f.state.generation+2);assert.equal(state.pending_transaction,null);assert.equal(state.history.count,1);
 const proof=await read(`staging/transaction-proofs/${r.transaction_id}.json`);
 assert.deepEqual(events.filter(e=>e.phase==='replace:after').map(e=>e.path),proof.payload.intent.payload.changed_paths);
 assert.ok(phases.indexOf('consume:after')<phases.indexOf('decided:after'));
 if(proof.payload.intent.payload.changed_paths.length)assert.ok(phases.indexOf('consume:after')<phases.indexOf('replace:before'));
 assert.equal(proof.payload.phase,'COMPLETED');assert.equal(proof.payload.history.record_hash,response.result.record_hash);
 const after=await readCanonicalSnapshot(f.root);assert.equal(after.validation.ok,true);
 for(const table of CANONICAL_TABLES)if(!proof.payload.intent.payload.changed_paths.includes(table.path))
   assert.deepEqual(after.rawBytes[table.path],f.snapshot.rawBytes[table.path]);
 assert.ok(phases.includes('receipt:after'));assert.ok(phases.includes('owner:after'));assert.ok(phases.includes('consume:after'));
 assert.ok(phases.includes('response:before'));assert.ok(phases.includes('response:after'));
 assert.ok(phases.indexOf('response:after')<phases.indexOf('gate_release:before'));
 assert.equal(phases.filter(p=>p==='owner:after').length,1);
 const bytes=await fs.readFile(join(f.root,'staging/fn004-state.json'));
 const retry=createApprovalRequestService({root:f.root,clock:()=>{throw Error('retry allocated time');},
   execute:()=>{throw Error('retry dispatched');}});
 const again=await retry.submitApplyRequest(f.payload,f.context);assert.equal(again.readiness,'initialized');assert.deepEqual(again.artifact,response.artifact);assert.deepEqual(again.result,response.result);
 assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),bytes);
 await readValidatedCanonicalSnapshot(f.root);
});

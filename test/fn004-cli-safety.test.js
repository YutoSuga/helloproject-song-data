import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {cli,tty,cliFixture,evidenceHashes} from './fixtures/canonical-cli.js';

test('6F public stale/wrong Plan and current source validation reject before Approval/Receipt',{timeout:900000},async t=>{
 const f=await cliFixture(t),before=await evidenceHashes(f.root);
 const wrong=await tty(f.root,f.args.map(v=>v===f.plan.plan_hash?'f'.repeat(64):v));
 assert.equal(wrong.code,8);assert.equal(wrong.answered,false);assert.deepEqual(await evidenceHashes(f.root),before);
 const candidates=structuredClone(f.candidates);candidates.candidates[0].title='new source facts';
 await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify(candidates));
 const changed=await evidenceHashes(f.root);
 const validation=await cli(f.root,['decision','validate',f.decision.decision_id,'--revision',String(f.decision.revision)]);
 assert.equal(validation.code,3,JSON.stringify(validation));assert.equal(validation.data.diagnostics[0].code,'CANDIDATE_FINGERPRINT_MISMATCH');
 assert.equal((await cli(f.root,['plan','check',f.plan.plan_id])).code,4);
 const stale=await tty(f.root,f.args);assert.equal(stale.code,4);assert.equal(stale.answered,false);
 assert.deepEqual(await evidenceHashes(f.root),changed);
 await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify({schema_version:1,candidates:{}}));
 const corrupt=await evidenceHashes(f.root);
 assert.equal((await cli(f.root,['decision','template','--candidate',f.decision.scope.candidate_ids[0]])).code,3);
 assert.equal((await cli(f.root,['decision','validate',f.decision.decision_id,'--revision',String(f.decision.revision)])).code,3);
 assert.deepEqual(await evidenceHashes(f.root),corrupt);
});

test('6F public adapters preserve metadata-race STOP without unlocking or dispatching',{timeout:900000},async t=>{
 const f=await cliFixture(t),path=join(f.root,'staging/.fn004.lock');
 // Exact observed incomplete-publication window from the existing gate race
 // regression. 6F does not modify acquireGate or reinterpret malformed metadata.
 await fs.writeFile(path,'');const before=await evidenceHashes(f.root);
 for(const args of [['status'],['plan','show',f.plan.plan_id],['result','--request',f.binding.request_id],
  ['recovery','inspect','--request',f.binding.request_id],['recovery','run','--transaction',f.binding.transaction_id,'--expect-state-hash','f'.repeat(64),'--action','abort']]){
  const r=await cli(f.root,args);assert.equal(r.code,8,JSON.stringify(r));assert.equal(r.data.error.code,args[0]==='recovery'?'PERSISTENCE_PARSE_FAILED':'GATE_CORRUPT');
  assert.deepEqual(await evidenceHashes(f.root),before);
 }
 const apply=await tty(f.root,f.args);assert.equal(apply.code,8);assert.equal(apply.answered,false);
 assert.deepEqual(await evidenceHashes(f.root),before);
});

test('6F actual OS permission failure maps to 9 and external malformed input remains non-mutating',{timeout:900000},async t=>{
 const f=await cliFixture(t),path=join(f.root,'external.json');await fs.writeFile(path,'{}');
 const before=await evidenceHashes(f.root);await fs.chmod(path,0);
 try {const r=await cli(f.root,['decision','import','--input',path]);assert.equal(r.code,9,JSON.stringify(r));assert.equal(r.data.error.code,'PERSISTENCE_READ_FAILED');}
 finally {await fs.chmod(path,0o600);}
 assert.deepEqual(await evidenceHashes(f.root),before);
});

test('6F kill during Recovery retirement: next public run cleans without recreating Proof',{timeout:1800000},async t=>{
 const f=await cliFixture(t);
 assert.equal((await tty(f.root,f.args,{mode:'kill',target:'prepared:after'})).code,-9);
 const names=(await fs.readdir(join(f.root,'staging/apply-requests'))).filter(n=>n.endsWith('.json'));
 assert.equal(names.length,1);const request=JSON.parse(await fs.readFile(join(f.root,'staging/apply-requests',names[0]))),r=request.receipt;
 const inspect=await cli(f.root,['recovery','inspect','--request',r.request_id]);assert.equal(inspect.code,0);
 const o=inspect.data.data,args=['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',o.observed_state_hash,'--action',o.allowed_actions[0]];
 const stopped=await tty(f.root,args,{mode:'kill',target:'retiring:after'});assert.equal(stopped.code,-9);assert.equal(stopped.killed,true);
 const proofPath=join(f.root,`staging/transaction-proofs/${r.transaction_id}.json`),proof=await fs.readFile(proofPath);
 const latest=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(latest.allowed_actions,['cleanup']);
 const result=await cli(f.root,['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',latest.observed_state_hash,'--action','cleanup']);
 assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.data.data.observation.readiness,'initialized');
 assert.deepEqual(await fs.readFile(proofPath),proof);
 const archive=join(f.root,`staging/recovery-ownership/${r.transaction_id}`);
 const anchor=JSON.parse(await fs.readFile(join(archive,'anchor.json')));
 assert.deepEqual(anchor.payload.operator,r.actor);
 const claims=(await fs.readdir(archive,{recursive:true})).filter(n=>/claims.*\.json$/.test(n));
 assert.equal(claims.length>0,true);
 for(const file of claims)assert.deepEqual(JSON.parse(await fs.readFile(join(archive,file))).payload.operator,r.actor);
});

test('6F actual SIGINT before confirmation cancels; after Receipt retains gate and evidence',{timeout:900000},async t=>{
 const f=await cliFixture(t),before=await evidenceHashes(f.root);
 const cancelled=await tty(f.root,f.args,{answer:'\u0003'});assert.equal(cancelled.code,10,JSON.stringify(cancelled));
 assert.deepEqual(await evidenceHashes(f.root),before);
 const stopped=await tty(f.root,f.args,{mode:'kill',target:'receipt:after',signal:'SIGINT'});
 assert.equal(stopped.code,-2,JSON.stringify(stopped));assert.equal(stopped.killed,true);
 const names=(await fs.readdir(join(f.root,'staging/apply-requests'))).filter(n=>n.endsWith('.json'));assert.equal(names.length,1);
 assert.equal((await fs.readFile(join(f.root,'staging/.fn004.lock'))).length>0,true);
 const r=JSON.parse(await fs.readFile(join(f.root,'staging/apply-requests',names[0]))).receipt;
 const observation=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.equal(observation.classification,'manual_stop');assert.deepEqual(observation.allowed_actions,[]);
});

for(const mode of ['io','io-history'])test(`6F actual CLI syscall ${mode}: original error and proven effect are distinct`,{timeout:1800000},async t=>{
 const f=await cliFixture(t);
 const result=await tty(f.root,f.args,{mode});
 assert.equal(result.code,mode==='io'?11:7,JSON.stringify(result));
 assert.equal(result.data.error.code,'PERSISTENCE_WRITE_FAILED');
 assert.ok(result.data.error.cause_codes.includes('EIO'));
 const requestId=result.data.error.request_id;assert.match(requestId,/^[0-9a-f-]{36}$/);
 const observation=(await cli(f.root,['recovery','inspect','--request',requestId])).data.data;
 if(mode==='io')assert.equal(observation.readiness,'initialized');
 else {
  assert.equal(result.data.canonical_effect,'applied');assert.deepEqual(observation.allowed_actions,['finalize_success']);
  const resumed=await cli(f.root,['recovery','run','--transaction',observation.binding.transaction_id,'--expect-state-hash',observation.observed_state_hash,'--action','finalize_success']);
  assert.equal(resumed.code,0,JSON.stringify(resumed));assert.equal(resumed.data.data.observation.readiness,'initialized');
 }
 const before=await evidenceHashes(f.root);const readonly=await cli(f.root,['result','--request',requestId]);
 assert.equal(readonly.code,mode==='io'?11:0,JSON.stringify(readonly));assert.deepEqual(await evidenceHashes(f.root),before);
});

test('6F actual CLI refuses UNKNOWN bytes after consumption; no forced restore',{timeout:1800000},async t=>{
 const f=await cliFixture(t);
 assert.equal((await tty(f.root,f.args,{mode:'kill',target:'consume:after'})).code,-9);
 const names=(await fs.readdir(join(f.root,'staging/apply-requests'))).filter(n=>n.endsWith('.json'));
 const r=JSON.parse(await fs.readFile(join(f.root,'staging/apply-requests',names[0]))).receipt;
 const path=join(f.root,'data/works.csv');await fs.appendFile(path,'UNKNOWN');
 const before=await evidenceHashes(f.root);
 const inspect=await cli(f.root,['recovery','inspect','--request',r.request_id]);assert.equal(inspect.code,0,JSON.stringify(inspect));
 const o=inspect.data.data;assert.equal(o.readiness,'blocked');assert.deepEqual(o.allowed_actions,[]);
 const run=await cli(f.root,['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',o.observed_state_hash,'--action','rollback']);
 assert.equal(run.code,6);assert.deepEqual(await evidenceHashes(f.root),before);
});

test('6F Recovery resolves only exact retained originals, without relying on Intent',{timeout:900000},async t=>{
 const f=await cliFixture(t);
 const boot=join(f.root,'staging/fn004-bootstrap.json'),original=await fs.readFile(boot);
 await fs.unlink(boot);
 const missing=await cli(f.root,['recovery','inspect','--request',f.binding.request_id]);
 assert.equal(missing.code,1,JSON.stringify(missing));assert.equal(missing.data.error.code,'PERSISTENCE_NOT_FOUND');
 assert.equal(missing.data.error.path,'staging/fn004-bootstrap.json');
 await fs.writeFile(boot,original);
 await fs.writeFile(join(f.root,`staging/apply-requests/${randomUUID()}.json`),JSON.stringify(f.request));
 const before=await evidenceHashes(f.root);
 const conflicting=await cli(f.root,['recovery','inspect','--request',f.binding.request_id]);
 assert.equal(conflicting.code,8,JSON.stringify(conflicting));assert.equal(conflicting.data.error.code,'INTEGRITY_CONFLICT');
 assert.deepEqual(await evidenceHashes(f.root),before);
});

test('6F CLI known-mixed semantic failure preserves diagnostics and actually rolls back',{timeout:1800000},async t=>{
 const f=await cliFixture(t,{newEntities:true});
 const stopped=await tty(f.root,f.args,{mode:'kill',target:'replace:after|data/songs.csv'});
 assert.equal(stopped.code,-9);assert.equal(stopped.killed,true);
 assert.equal((await readCanonicalSnapshot(f.root)).validation.ok,false);
 const name=(await fs.readdir(join(f.root,'staging/apply-requests'))).find(n=>n.endsWith('.json'));
 const requestPath=join(f.root,'staging/apply-requests',name),raw=await fs.readFile(requestPath),r=JSON.parse(raw).receipt;
 const stateBefore=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
 const observed=await cli(f.root,['recovery','inspect','--request',r.request_id]);assert.equal(observed.code,0,JSON.stringify(observed));
 const o=observed.data.data;assert.equal(o.readiness,'recovery_required');assert.deepEqual(o.allowed_actions,['rollback']);
 for(const code of ['RECOVERY_REQUIRED','CANONICAL_INVALID','PRIMARY_ARTIST_MISSING'])assert.ok(o.diagnostics.some(d=>d.code===code));
 const resumed=await cli(f.root,['recovery','run','--transaction',r.transaction_id,'--expect-state-hash',o.observed_state_hash,'--action','rollback']);
 assert.equal(resumed.code,11,JSON.stringify(resumed));assert.equal(resumed.data.readiness,'initialized');
 const final=await readCanonicalSnapshot(f.root);assert.equal(final.validation.ok,true);assert.deepEqual(final.manifest,f.snapshot.manifest);
 const state=JSON.parse(await fs.readFile(join(f.root,'staging/fn004-state.json')));
 assert.deepEqual(state.high_water_marks,stateBefore.high_water_marks);assert.deepEqual(state.allocation_events,stateBefore.allocation_events);
 assert.ok(Object.keys(state.high_water_marks).some(k=>state.high_water_marks[k]>f.state.high_water_marks[k]));
 assert.deepEqual(await fs.readFile(requestPath),raw);
});

test('6F Receipt publication failure exposes intended identity without claiming acceptance',{timeout:900000},async t=>{
 const f=await cliFixture(t);
 const state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
 const result=await tty(f.root,f.args,{mode:'io-request'});
 assert.equal(result.code,1,JSON.stringify(result));assert.equal(result.data.error.code,'PERSISTENCE_WRITE_FAILED');
 assert.equal(result.data.error.published,false);assert.equal(result.data.error.request_id,undefined);
 const intended=result.data.error.intended_request_id;assert.match(intended,/^[0-9a-f-]{36}$/);
 assert.equal(result.stderr.includes('Accepted Request:'),false);
 await assert.rejects(fs.stat(join(f.root,`staging/apply-requests/${intended}.json`)),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
 assert.deepEqual((await readCanonicalSnapshot(f.root)).manifest,f.snapshot.manifest);
});

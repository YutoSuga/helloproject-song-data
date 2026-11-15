import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {fixture,command} from './fixtures/recovery-runtime.js';
import {transactionFixture,recoveryDiscovery,exitedProbe,rehash} from './fixtures/transaction-evidence.js';
import {sha256} from '../src/canonical-hash.js';
import {createPersistence} from '../src/persistence.js';
import {acquireGate,releaseGate,withCanonicalGate,GATE_PATH} from '../src/fn004-gate.js';
import {inspectRuntimeState} from '../src/fn004-runtime-state.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';
import {createFailureRecoveryService} from '../src/fn004-failure-recovery.js';
import {prepareRecoverySnapshot} from '../src/fn004-recovery-snapshot.js';
import {classifyRecoverySnapshot} from '../src/fn004-recovery-classifier.js';
import {collectRecoverySnapshot} from '../src/fn004-recovery-collection.js';
import {matchesRecoveryObservation} from '../src/fn004-recovery-observation.js';
import {validateIntent} from '../src/fn004-transaction-evidence.js';
import {readValidatedCanonicalSnapshot} from '../src/fn004-repository.js';

const candidate=()=>`staging/.fn004-gate-candidate.tmp-${randomUUID()}`;
for(const raw of [Buffer.alloc(0),Buffer.from('{partial'),Buffer.from([0xff])])
 test(`GP10 genesis ignores only nonauthoritative candidate content (${raw.length} bytes)`,async t=>{
  const f=await normalApplyFixture(t),path=candidate();await fs.writeFile(join(f.root,path),raw);
  const state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  await withCanonicalGate({root:f.root,fn:async gate=>{
    const runtime=await inspectRuntimeState(await createPersistence(f.root),{gate});
    assert.equal(runtime.status,'READY');assert.equal(runtime.readiness,'initialized');
  }});
  assert.deepEqual(await fs.readFile(join(f.root,path)),raw);
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
 });

for(const kind of ['symlink','directory'])test(`GP10 ${kind} candidate is unsafe even on the genesis fast path`,async t=>{
 const f=await normalApplyFixture(t),path=join(f.root,candidate());
 if(kind==='directory')await fs.mkdir(path);else await fs.symlink(join(f.root,'staging/fn004-state.json'),path);
 await assert.rejects(withCanonicalGate({root:f.root,fn:async gate=>inspectRuntimeState(await createPersistence(f.root),{gate})}),{code:'PATH_UNSAFE'});
 assert.ok(await fs.lstat(path));
});

test('GP10 candidate listing IO failure is not an empty/READY inventory',async t=>{
 const f=await normalApplyFixture(t),cause=Object.assign(Error('list failure'),{code:'EIO'});
 const io={...fs,readdir:async p=>{if(p===join(f.root,'staging'))throw cause;return fs.readdir(p);}};
 await assert.rejects(withCanonicalGate({root:f.root,fn:async gate=>inspectRuntimeState(await createPersistence(f.root),{gate,io})}),
   e=>e.code==='PERSISTENCE_READ_FAILED'&&e.cause===cause);
});

test('GP10 a final-linked orphan candidate is neither a lease nor cleanup work',async t=>{
 const f=await normalApplyFixture(t),path=candidate(),old=await acquireGate({root:f.root});
 await fs.link(join(f.root,GATE_PATH),join(f.root,path));const raw=await fs.readFile(join(f.root,path));
 await releaseGate(old);const fresh=await acquireGate({root:f.root});assert.notEqual(fresh.lock_id,old.lock_id);
 const runtime=await inspectRuntimeState(await createPersistence(f.root),{gate:fresh});
 assert.equal(runtime.readiness,'initialized');await releaseGate(fresh);
 assert.deepEqual(await fs.readFile(join(f.root,path)),raw);
});

test('GP13 paused candidate permits normal Apply and readonly retry without duplicate dispatch/ID/History',async t=>{
 const f=await normalApplyFixture(t);let resume,reached,dispatches=0;
 const paused=new Promise(r=>{reached=r;}),ready=new Promise(r=>{resume=r;});
 const pending=acquireGate({root:f.root,io:{...fs,open:async(p,flags,...args)=>{
   const h=await fs.open(p,flags,...args);if(flags!=='wx')return h;
   return new Proxy(h,{get(target,key){if(key==='writeFile')return async raw=>{reached();await ready;return h.writeFile(raw);};
     const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 }}});await paused;
 const service=createCanonicalApplyService({root:f.root,onBoundary:e=>{if(e.phase==='receipt:after')dispatches++;}});
 try {const result=await service.submitApplyRequest(f.payload,f.context);assert.ok(result.result);}
 finally{resume();await releaseGate(await pending);}
 const state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
 const receipt=await fs.readFile(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`));
 const histories=await fs.readdir(join(f.root,'staging/apply-history'));
 const again=await service.submitApplyRequest(f.payload,f.context);assert.ok(again.result);
 assert.equal(dispatches,1);assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
 assert.deepEqual(await fs.readFile(join(f.root,`staging/apply-requests/${f.payload.request_id}.json`)),receipt);
 assert.deepEqual(await fs.readdir(join(f.root,'staging/apply-history')),histories);assert.equal(histories.length,1);
});

function addCandidate(d,path,raw){d.rawBytes[path]=raw;d.files.push({path,kind:'file',byte_length:raw.length,sha256:sha256(raw)});d.files.sort((a,b)=>a.path<b.path?-1:1);return d;}
test('GP11 raw candidate addition/change/removal affects Observation v2 and stale commands',async()=>{
 const f=transactionFixture(),path=candidate();
 const observe=async raw=>{
   const d=recoveryDiscovery(f);if(raw!==null)addCandidate(d,path,raw);
   return classifyRecoverySnapshot(await prepareRecoverySnapshot({binding:f.binding,discovery:d,git_audit:f.git_audit,probe:exitedProbe(f.process)}));
 };
 const plain=await observe(null),added=await observe(Buffer.from('{')),changed=await observe(Buffer.from('complete'));
 for(const [before,after] of [[plain,added],[added,changed],[changed,plain]]){
   assert.notEqual(before.observed_state_hash,after.observed_state_hash);
   assert.equal(matchesRecoveryObservation(command(f.binding,before),after),false);
 }
 let pass=0;
 const raced=classifyRecoverySnapshot(await collectRecoverySnapshot('/fixture',f.binding,{
   discover:async()=>pass++?recoveryDiscovery(f):addCandidate(recoveryDiscovery(f),path,Buffer.from('{')),
   audit:async()=>f.git_audit,probeOwner:async owner=>exitedProbe(owner)
 }));
 assert.equal(raced.evidence.consistency,'raced');assert.deepEqual(raced.allowed_actions,[]);
});

for(const location of ['inputs','backup_refs','temp_refs'])test(`GP10 candidate cannot become ${location} authority even with matching hashes`,()=>{
 const f=transactionFixture({newEntities:true}),intent=structuredClone(f.intent),path=candidate();
 if(location==='inputs')intent.payload.inputs.plan.path=path;
 else intent.payload[location][0].path=path;
 rehash(intent);
 assert.throws(()=>validateIntent(intent,{owner:f.owner,inputs:f.inputs}),{code:'INTEGRITY_CONFLICT'});
});

test('GP11/14 candidate stale token blocks mutation; fresh abort/retirement excludes orphan from cleanup',async t=>{
 const {root,binding}=await fixture(t,'abort'),service=await createFailureRecoveryService(root),before=await service.inspect(binding);
 const state=await fs.readFile(join(root,'staging/fn004-state.json')),gate=await fs.readFile(join(root,GATE_PATH));
 const path=candidate(),raw=Buffer.from('{orphan');await fs.writeFile(join(root,path),raw);
 await assert.rejects(service.run({binding,command:command(binding,before)}),{code:'RECOVERY_REQUIRED'});
 assert.deepEqual(await fs.readFile(join(root,'staging/fn004-state.json')),state);
 assert.deepEqual(await fs.readFile(join(root,GATE_PATH)),gate);
 const fresh=await service.inspect(binding);assert.deepEqual(fresh.allowed_actions,['abort']);
 const done=await service.run({binding,command:command(binding,fresh)});assert.equal(done.observation.readiness,'initialized');
 assert.deepEqual(await fs.readFile(join(root,path)),raw);
 assert.equal((await readValidatedCanonicalSnapshot(root)).validation.ok,true);
});

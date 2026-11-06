import test, {describe} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,command} from './fixtures/recovery-runtime.js';
import {createSuccessRecoveryService} from '../src/fn004-success-recovery.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {hashState} from '../src/fn004-state.js';

// Every case owns an isolated repository and real worker processes.
describe('6D success runtime', {concurrency:2},()=>{

for(const mode of ['decided','history','alltarget','success-noop','success-noop-exception','success-lag','success-candidate','success-state','success-completed'])test(`6D ${mode}: exact original success record, state and terminalization`,async t=>{
  const {root,binding}=await fixture(t,mode),service=await createSuccessRecoveryService(root);
  const before=(await readCanonicalSnapshot(root)).manifest,state=JSON.parse(await fs.readFile(join(root,'staging/fn004-state.json')));
  const o=await service.inspect(binding);assert.deepEqual(o.allowed_actions,[mode==='success-completed'?'finish_terminal':'finalize_success']);
  const result=await service.run({binding,command:command(binding,o)});
  assert.equal(result.observation.readiness,'initialized');assert.deepEqual(result.observation.allowed_actions,[]);
  assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before);
  const history=JSON.parse(await fs.readFile(join(root,`staging/apply-history/${binding.apply_id}.json`)));
  const proof=JSON.parse(await fs.readFile(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)));
  const completion=JSON.parse(await fs.readFile(join(root,`staging/apply-requests/completions/${binding.request_id}.json`)));
  const after=JSON.parse(await fs.readFile(join(root,'staging/fn004-state.json')));
  assert.equal(proof.payload.phase,'COMPLETED');assert.deepEqual(proof.payload.history,history);
  assert.deepEqual(after,proof.payload.after_state);assert.deepEqual(after.high_water_marks,state.high_water_marks);
  assert.deepEqual(after.allocation_events,state.allocation_events);assert.equal(after.generation,state.generation+(['success-state','success-completed'].includes(mode)?0:1));
  assert.equal(after.pending_transaction,null);assert.equal(after.history.head_hash,history.record_hash);
  assert.deepEqual(completion.payload.result,{apply_id:binding.apply_id,record_hash:history.record_hash});
  await assert.rejects(service.run({binding,command:command(binding,o)}),{code:'RECOVERY_REQUIRED'});
});

async function pausedChild(t,root,args) {
  const child=fork(new URL('./fixtures/recovery-runtime-child.js',import.meta.url),args,{stdio:['ignore','ignore','pipe','ipc']});
  let error='';child.stderr.on('data',c=>error+=c);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(error);})]);
  return {child,message,kill:async()=>{const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');}};
}
test('original live owner finalizes after decision without Recovery takeover or ID/canonical writes',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-success-original-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const child=await pausedChild(t,root,['setup-normal',root,'decided']);
  assert.equal(child.message.result.observation.readiness,'initialized');
  const b=child.message.binding;
  const proof=JSON.parse(await fs.readFile(join(root,`staging/transaction-proofs/${b.transaction_id}.json`)));
  assert.equal(proof.payload.authority.recovery,null);
  await assert.rejects(fs.stat(join(root,'staging/recovery-ownership')),{code:'ENOENT'});
  await child.kill();
});

for(const boundary of ['decided:after','history:after','success_state:after','completed:after','proof:after','completion:after','retiring:after'])test(`6D SIGKILL ${boundary}: restart reuses decision/History/proof and seals ownership`,{timeout:900000},async t=>{
  const {root,binding}=await fixture(t,boundary==='decided:after'?'alltarget':'decided');
  const worker=await pausedChild(t,root,['run-success',root,JSON.stringify(binding),boundary]);
  assert.equal(worker.message.boundary,boundary);await worker.kill();
  const path=join(root,`staging/apply-history/${binding.apply_id}.json`),proofPath=join(root,`staging/transaction-proofs/${binding.transaction_id}.json`);
  let history,proof;try{history=await fs.readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  try{proof=await fs.readFile(proofPath);}catch(e){if(e.code!=='ENOENT')throw e;}
  const before=(await readCanonicalSnapshot(root)).manifest,service=await createSuccessRecoveryService(root),o=await service.inspect(binding);
  const result=await service.run({binding,command:command(binding,o)});
  assert.equal(result.observation.readiness,'initialized');assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before);
  if(history)assert.equal((await fs.readFile(path)).equals(history),true);
  if(proof)assert.equal((await fs.readFile(proofPath)).equals(proof),true);
  assert.deepEqual(await fs.readdir(join(root,`staging/recovery-ownership/${binding.transaction_id}/claims`)),['000001.json']);
});

for(const fault of ['target-sync','target-source-sync','consumption-sync','decision-sync','terminal-sync','history-link-before','history-link-after','history-readback','state-rename-after','state-confirm-sync','completion-readback'])test(`6D I/O ${fault}: retained typed evidence, process exit and forward-only restart`,{timeout:900000},async t=>{
  const {root,binding}=await fixture(t,fault.startsWith('target-')?'alltarget':fault==='consumption-sync'?'success-noop-exception':fault==='terminal-sync'?'success-completed':fault==='state-confirm-sync'?'success-state':'decided');
  if(fault==='target-source-sync')await fs.mkdir(join(root,`staging/transactions/${binding.transaction_id}/temp/data`),{recursive:true});
  const before=(await readCanonicalSnapshot(root)).manifest;
  const worker=await pausedChild(t,root,['run-success',root,JSON.stringify(binding),`success-fault:${fault}`]);
  assert.equal(worker.message.injected,true);assert.equal(worker.message.error.io_code,'EIO');
  assert.equal(worker.message.error.published,fault!=='history-link-before');
  if(['state-confirm-sync','terminal-sync'].includes(fault))await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
  if(fault.startsWith('target-')||fault==='consumption-sync'){
    const directory=join(root,`staging/transactions/${binding.transaction_id}/journal`);
    for(const name of await fs.readdir(directory))assert.notEqual(JSON.parse(await fs.readFile(join(directory,name))).payload.phase,'COMMIT_DECIDED');
    await assert.rejects(fs.stat(join(root,`staging/apply-history/${binding.apply_id}.json`)),{code:'ENOENT'});
  }
  assert.equal(typeof worker.message.error.path,'string');await worker.kill();
  const service=await createSuccessRecoveryService(root),o=await service.inspect(binding);
  assert.ok(['finalize_success','finish_terminal','cleanup'].includes(o.allowed_actions[0]),JSON.stringify(o));
  assert.equal((await service.run({binding,command:command(binding,o)})).observation.readiness,'initialized');
  assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before);
});

test('normal owner SIGKILL after COMPLETED resumes only finish_terminal under successor authority',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-success-normal-kill-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const worker=await pausedChild(t,root,['setup-normal',root,'decided','completed:after']);
  const binding=worker.message.binding;await worker.kill();
  const service=await createSuccessRecoveryService(root),o=await service.inspect(binding);
  assert.deepEqual(o.allowed_actions,['finish_terminal']);
  assert.equal((await service.run({binding,command:command(binding,o)})).observation.readiness,'initialized');
});

test('6D SIGKILL during partial History temp: typed STOP preserves partial evidence and consumed state', {timeout:900000},async t=>{
  const {root,binding}=await fixture(t,'decided'),before=(await readCanonicalSnapshot(root)).manifest;
  const state=await fs.readFile(join(root,'staging/fn004-state.json'));
  const worker=await pausedChild(t,root,['run-success',root,JSON.stringify(binding),'success-fault:history-partial-kill']);
  assert.equal(worker.message.boundary,'history-partial');await worker.kill();
  const directory=join(root,'staging/apply-history'),names=await fs.readdir(directory);
  assert.equal(names.length,1);assert.ok(names[0].startsWith('.fn004-'));
  const partial=await fs.readFile(join(directory,names[0]));assert.equal(partial.length,8);
  const service=await createSuccessRecoveryService(root);
  await assert.rejects(service.inspect(binding),{code:'PERSISTENCE_PARSE_FAILED'});
  assert.equal((await fs.readFile(join(directory,names[0]))).equals(partial),true);
  assert.equal((await fs.readFile(join(root,'staging/fn004-state.json'))).equals(state),true);
  assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before);
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
});

for(const kind of ['unknown','mixed','state-contradiction','History-corrupt','History-conflict','Intent-corrupt','Completion-only'])test(`6D ${kind}: stale success command cannot mutate or manufacture terminal evidence`,async t=>{
  const {root,binding}=await fixture(t,'decided'),service=await createSuccessRecoveryService(root),o=await service.inspect(binding);
  const read=p=>fs.readFile(join(root,p)),write=(p,v)=>fs.writeFile(join(root,p),v);
  if(kind==='unknown')await fs.appendFile(join(root,'data/songs.csv'),'\n');
  if(kind==='mixed')await write('data/songs.csv',await read(`staging/transactions/${binding.transaction_id}/backup/data/songs.csv`));
  if(kind==='state-contradiction'){const s=JSON.parse(await read('staging/fn004-state.json'));s.pending_transaction=null;s.state_hash=hashState(s);await write('staging/fn004-state.json',JSON.stringify(s));}
  if(kind.startsWith('History-')){
    await fs.mkdir(join(root,'staging/apply-history'),{recursive:true});
    if(kind==='History-corrupt')await write(`staging/apply-history/${binding.apply_id}.json`,'{');
    else {
      const journal=await fs.readdir(join(root,`staging/transactions/${binding.transaction_id}/journal`));
      let r;for(const name of journal){const e=JSON.parse(await read(`staging/transactions/${binding.transaction_id}/journal/${name}`));if(e.payload.history)r=e.payload.history.record;}
      r.metadata.published_at='2026-10-26T00:00:00Z';await write(`staging/apply-history/${binding.apply_id}.json`,JSON.stringify(r));
    }
  }
  if(kind==='Intent-corrupt')await write(`staging/transactions/${binding.transaction_id}/intent.json`,'{');
  if(kind==='Completion-only'){await fs.mkdir(join(root,'staging/apply-requests/completions'),{recursive:true});await write(`staging/apply-requests/completions/${binding.request_id}.json`,'{}');}
  const before=await Promise.all(['data/songs.csv','staging/fn004-state.json'].map(read));
  await assert.rejects(service.run({binding,command:command(binding,o)}));
  assert.deepEqual(await Promise.all(['data/songs.csv','staging/fn004-state.json'].map(read)),before);
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
  await assert.rejects(fs.stat(join(root,'staging/recovery-ownership')),{code:'ENOENT'});
});
});

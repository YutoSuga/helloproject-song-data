import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fixture, command } from './fixtures/recovery-runtime.js';
import { createFailureRecoveryService } from '../src/fn004-failure-recovery.js';
import { readCanonicalSnapshot } from '../src/canonical-snapshot.js';

test('R80-H01: last restore sync failure must be reconfirmed after SIGKILL before terminalization', {timeout:180000}, async t => {
  const {root,binding}=await fixture(t,'mixed');
  const child=fork(new URL('./fixtures/recovery-runtime-child.js',import.meta.url),
    ['run',root,JSON.stringify(binding),'last_restore_sync_failure'],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',c=>stderr+=c);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(stderr);})]);
  assert.deepEqual(message,{error:{code:'PERSISTENCE_SYNC_FAILED',phase:'directory_sync',published:true},injected:true});
  const journalRoot=join(root,`staging/transactions/${binding.transaction_id}/journal`);
  const journalNames=(await fs.readdir(journalRoot)).sort();
  const failure=JSON.parse(await fs.readFile(join(journalRoot,journalNames.at(-1))));
  assert.equal(failure.payload.phase,'RECOVERY_REQUIRED');
  assert.equal(failure.payload.error.io_code,'EIO','R80-M02: io_code must retain the native errno through persistence wrappers');
  const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
  const manifest=(await readCanonicalSnapshot(root)).manifest;
  const original=JSON.parse(await fs.readFile(join(root,`staging/transactions/${binding.transaction_id}/owner.json`))).payload.original_manifest;
  assert.deepEqual(manifest,original);
  let synced=false,sourceSynced=false;
  const io={...fs,open:async(path,...args)=>{
    const handle=await fs.open(path,...args);
    if(![join(root,'data'),join(root,`staging/transactions/${binding.transaction_id}/restore/data`)].includes(String(path)))return handle;
    return {close:()=>handle.close(),sync:async()=>{await handle.sync();
      if(String(path)===join(root,'data'))synced=true;else sourceSynced=true;
    }};
  }};
  const service=await createFailureRecoveryService(root,{io,onBoundary:async e=>{
    if(e.phase==='failure_state:before'||e.phase==='proof:before'){
      assert.equal(synced,true,'All-Original readback alone is not durable restore proof');
      assert.equal(sourceSynced,true,'The cross-directory rename source also needs a durable removal');
    }
  }}),o=await service.inspect(binding);
  assert.deepEqual(o.allowed_actions,['rollback']);
  assert.equal((await service.run({binding,command:command(binding,o)})).observation.readiness,'initialized');
  assert.equal(synced,true);
  assert.equal(sourceSynced,true);
});

test('R80-H01: failed original durability reconfirmation preserves consumed state and cannot publish Proof', async t => {
  const {root,binding}=await fixture(t,'mixed');let confirming=false,injected=false;
  const state=await fs.readFile(join(root,'staging/fn004-state.json'));
  const io={...fs,open:async(path,...args)=>{
    const handle=await fs.open(path,...args);
    if(!confirming||!String(path).startsWith(join(root,'data')+'/'))return handle;
    return {close:()=>handle.close(),sync:async()=>{injected=true;throw Object.assign(new Error('original sync'),{code:'EIO'});}};
  }};
  const service=await createFailureRecoveryService(root,{io,onBoundary:async e=>{if(e.phase==='rollback_confirm:before')confirming=true;}});
  const o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>e.code==='PERSISTENCE_SYNC_FAILED'&&
    e.phase==='file_sync'&&e.published===true&&e.cause.code==='EIO'&&e.path.startsWith('data/'));
  assert.equal(injected,true);
  assert.equal((await fs.readFile(join(root,'staging/fn004-state.json'))).equals(state),true);
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
  const names=(await fs.readdir(join(root,`staging/transactions/${binding.transaction_id}/journal`))).sort();
  const last=JSON.parse(await fs.readFile(join(root,`staging/transactions/${binding.transaction_id}/journal`,names.at(-1))));
  assert.equal(last.payload.phase,'RECOVERY_REQUIRED');assert.equal(last.payload.resume_phase,'ROLLING_BACK');
});

for(const fault of ['before','after','unresolved'])test(`R80-M01: ${fault} unlink failure preserves observed publication status`, async t=>{
  const {root,binding}=await fixture(t,'abort');
  const relative=`staging/transactions/${binding.transaction_id}/backup/data/works.csv`,path=join(root,relative);
  await fs.mkdir(join(root,`staging/transactions/${binding.transaction_id}/backup/data`),{recursive:true});
  await fs.copyFile(join(root,'data/works.csv'),path);
  let injected=false;
  const io={...fs,unlink:async target=>{
    if(String(target)!==path)return fs.unlink(target);
    injected=true;
    if(fault!=='before')await fs.unlink(target);
    throw Object.assign(new Error('unlink result'),{code:'EIO'});
  },lstat:async(target,...args)=>{
    if(fault==='unresolved'&&injected&&String(target)===path)throw Object.assign(new Error('readback unavailable'),{code:'EIO'});
    return fs.lstat(target,...args);
  }};
  const service=await createFailureRecoveryService(root,{io}),o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&
    e.path===relative&&e.phase==='publish'&&e.cause.code==='EIO'&&
    e.published===(fault==='before'?false:fault==='after'?true:null));
  assert.equal(injected,true);
  assert.equal(await fs.readFile(join(root,'staging/.fn004-recovery.lock'),'utf8').then(()=>true),true);
});

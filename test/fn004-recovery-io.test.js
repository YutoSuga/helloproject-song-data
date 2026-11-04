import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, command } from './fixtures/recovery-runtime.js';
import { createFailureRecoveryService } from '../src/fn004-failure-recovery.js';
import { readCanonicalSnapshot } from '../src/canonical-snapshot.js';

for(const artifact of ['.fn004-recovery.lock','anchor.json','/journal/','transaction-proofs','/completions/','/retirements/'])test(`ownership/terminal ${artifact} I/O publication failure is typed and never restores unknown data`,async t=>{
  const {root,binding}=await fixture(t,'abort');let injected=false;
  const io={...fs,link:async(from,to)=>{
    if(!injected&&to.includes(artifact)){injected=true;throw Object.assign(new Error('injected link'),{code:'EIO'});}
    return fs.link(from,to);
  }};
  const service=await createFailureRecoveryService(root,{io}),o=await service.inspect(binding),before=await readCanonicalSnapshot(root);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='publish'&&
    e.published===false&&e.cause.code==='EIO'&&typeof e.path==='string');
  assert.equal(injected,true);assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before.manifest);
});
for(const fault of ['rename','rename_after','readback'])test(`R78-M02 rollback ${fault} preserves cause/path/phase/published and durable failure evidence`,async t=>{
  const {root,binding}=await fixture(t,'mixed');let injected=false,renamed=false;
  const io={...fs,rename:async(from,to)=>{
    if(to.startsWith(join(root,'data')+'/')){
      if(fault==='rename'&&!injected){injected=true;throw Object.assign(new Error('rename'),{code:'EIO'});}
      renamed=true;
    }
    await fs.rename(from,to);
    if(fault==='rename_after'&&renamed&&!injected){injected=true;throw Object.assign(new Error('rename returned after publication'),{code:'EIO'});}
  },readFile:async(path,...args)=>{
    if(fault==='readback'&&renamed&&!injected&&String(path).startsWith(join(root,'data')+'/')){
      injected=true;throw Object.assign(new Error('readback'),{code:'EIO'});
    }
    return fs.readFile(path,...args);
  }};
  const service=await createFailureRecoveryService(root,{io}),o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>
    e.code===(fault==='readback'?'PERSISTENCE_READ_FAILED':'PERSISTENCE_WRITE_FAILED')&&e.cause.code==='EIO'&&
    e.phase===(fault==='readback'?null:'publish')&&e.published===(fault!=='rename')&&e.path.startsWith('data/'));
  assert.equal(injected,true);
  const names=(await fs.readdir(join(root,`staging/transactions/${binding.transaction_id}/journal`))).sort();
  const last=JSON.parse(await fs.readFile(join(root,`staging/transactions/${binding.transaction_id}/journal`,names.at(-1))));
  assert.equal(last.payload.phase,'RECOVERY_REQUIRED');assert.equal(last.payload.resume_phase,'ROLLING_BACK');
  assert.equal(last.payload.error.io_code,'EIO');
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
});

test('successor claim publication failure retains the original full ownership prefix',async t=>{
  const {fork}=await import('node:child_process'),{once}=await import('node:events');
  const {root,binding}=await fixture(t,'abort');
  const child=fork(new URL('./fixtures/recovery-runtime-child.js',import.meta.url),['run',root,JSON.stringify(binding),'anchor:after'],
    {stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',c=>errors+=c);
  const [m]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(errors);})]);
  assert.equal(m.boundary,'anchor:after');const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
  const path=join(root,`staging/recovery-ownership/${binding.transaction_id}/anchor.json`),before=await fs.readFile(path);
  const io={...fs,link:async(from,to)=>{if(to.includes('/claims/'))throw Object.assign(new Error('claim'),{code:'EIO'});return fs.link(from,to);}};
  const service=await createFailureRecoveryService(root,{io}),o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='publish'&&e.published===false&&e.cause.code==='EIO');
  assert.equal((await fs.readFile(path)).equals(before),true);
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}/claims/000001.json`)),{code:'ENOENT'});
});

test('unresolved rename result remains published=null when immediate byte observation fails',async t=>{
  const {root,binding}=await fixture(t,'mixed');let renamed=false;
  const io={...fs,rename:async(from,to)=>{
    await fs.rename(from,to);
    if(to.startsWith(join(root,'data')+'/')){renamed=true;throw Object.assign(new Error('rename result lost'),{code:'EIO'});}
  },readFile:async(path,...args)=>{
    if(renamed&&String(path).startsWith(join(root,'data')+'/'))throw Object.assign(new Error('observation unavailable'),{code:'EIO'});
    return fs.readFile(path,...args);
  }};
  const service=await createFailureRecoveryService(root,{io}),o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&
    e.phase==='publish'&&e.published===null&&e.cause.code==='EIO');
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
});

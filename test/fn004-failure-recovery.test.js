import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFailureRecoveryService } from '../src/fn004-failure-recovery.js';
import { acquireGate, releaseGate } from '../src/fn004-gate.js';
import { readCanonicalSnapshot } from '../src/canonical-snapshot.js';

import { fixture, command } from './fixtures/recovery-runtime.js';
for(const mode of ['receipt','abort','prepared','intentlag','noop','unconsumed','mixed','relation']) test(`6C ${mode}: actual dead owner to failure proof/completion and sealed permanent archive`,async t=>{
  const {root,binding}=await fixture(t,mode),service=await createFailureRecoveryService(root);
  const before=await service.inspect(binding);
  assert.deepEqual(before.allowed_actions,[['abort','receipt','prepared','intentlag'].includes(mode)?'abort':'rollback']);
  if(mode==='mixed')assert.ok(before.diagnostics.some(d=>d.code==='PRIMARY_ARTIST_MISSING'));
  const state=JSON.parse(await fs.readFile(join(root,'staging/fn004-state.json')));
  const result=await service.run({binding,command:command(binding,before)});
  assert.equal(result.observation.readiness,'initialized');assert.deepEqual(result.observation.allowed_actions,[]);
  const after=await readCanonicalSnapshot(root);assert.equal(after.validation.ok,true);
  const proof=JSON.parse(await fs.readFile(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)));
  assert.deepEqual(after.manifest,proof.payload.final_manifest);
  const end=JSON.parse(await fs.readFile(join(root,'staging/fn004-state.json')));
  if(['noop','unconsumed'].includes(mode))assert.deepEqual(end,state);
  assert.deepEqual(end.high_water_marks,state.high_water_marks);assert.deepEqual(end.allocation_events,state.allocation_events);
  await assert.rejects(service.run({binding,command:command(binding,before)}),{code:'RECOVERY_REQUIRED'});
  assert.ok((await fs.readdir(join(root,`staging/recovery-ownership/${binding.transaction_id}`))).includes('anchor.json'));
  const ordinary=await acquireGate({root});await releaseGate(ordinary);
});

for (const boundary of ['restore:after','restore_last:after','rollback_validation:after','failure_state:after','proof:after','completion:after','retiring:after','gate_release:after','retired:after']) {
  test(`SIGKILL ${boundary}: restart advances permanent successor and reuses terminal evidence`, { timeout:900000 }, async t => {
    const {root,binding}=await fixture(t,boundary.startsWith('restore')||boundary.startsWith('rollback_validation')||boundary.startsWith('failure_state')?'relation':'abort');
    const child=fork(new URL('./fixtures/recovery-runtime-child.js',import.meta.url),['run',root,JSON.stringify(binding),boundary],
      {stdio:['ignore','ignore','pipe','ipc']});
    let error='';child.stderr.on('data',c=>error+=c);
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
    const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(error);})]);
    assert.equal(message.boundary,boundary);
    const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
    const archive=join(root,`staging/recovery-ownership/${binding.transaction_id}`);
    const originalAnchor=await fs.readFile(join(archive,'anchor.json'));
    const proofPath=join(root,`staging/transaction-proofs/${binding.transaction_id}.json`);
    let proof;try{proof=await fs.readFile(proofPath);}catch(e){if(e.code!=='ENOENT')throw e;}
    const service=await createFailureRecoveryService(root),o=await service.inspect(binding);
    assert.deepEqual(o.allowed_actions,[boundary.startsWith('restore')||boundary.startsWith('rollback_validation')||boundary.startsWith('failure_state')?'rollback':boundary==='proof:after'?'finish_terminal':'cleanup']);
    if(boundary==='restore:after')assert.ok(o.diagnostics.some(d=>d.code==='PRIMARY_ARTIST_MISSING'));
    const result=await service.run({binding,command:command(binding,o)});
    assert.equal(result.observation.readiness,'initialized');
    assert.equal((await fs.readFile(join(archive,'anchor.json'))).equals(originalAnchor),true);
    assert.deepEqual(await fs.readdir(join(archive,'claims')),['000001.json']);
    if(proof)assert.equal((await fs.readFile(proofPath)).equals(proof),true);
    assert.equal((await readCanonicalSnapshot(root)).validation.ok,true);
  });
}

test('stale inspect token refuses ownership publication and preserves canonical',async t=>{
  const {root,binding}=await fixture(t,'abort'),service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  const path=join(root,'staging/song-candidates.json'),source=await fs.readFile(path);
  await fs.writeFile(path,Buffer.concat([source,Buffer.from('\n')]));
  await assert.rejects(service.run({binding,command:command(binding,o)}),{code:'RECOVERY_REQUIRED'});
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}`)),{code:'ENOENT'});
});

for(const corruption of ['unknown','state-before','nonprefix'])test(`executor refuses ${corruption} without touching canonical or creating ownership`,async t=>{
  const {root,binding}=await fixture(t,'mixed');
  const tx=join(root,`staging/transactions/${binding.transaction_id}`);
  if(corruption==='unknown')await fs.appendFile(join(root,'data/songs.csv'),'\n');
  else if(corruption==='state-before')await fs.copyFile(join(tx,'backup/fn004-state.json'),join(root,'staging/fn004-state.json'));
  else await fs.copyFile(join(tx,'backup/data/works.csv'),join(root,'data/works.csv'));
  const bytes=await fs.readFile(join(root,'data/songs.csv')),service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  assert.equal(o.readiness,'blocked');assert.deepEqual(o.allowed_actions,[]);
  await assert.rejects(service.run({binding,command:{...command(binding,o),action:'rollback'}}),{code:'RECOVERY_REQUIRED'});
  assert.equal((await fs.readFile(join(root,'data/songs.csv'))).equals(bytes),true);
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}`)),{code:'ENOENT'});
});
test('TOCTOU after ownership but before semantic journal publication rejects changed source',async t=>{
  const {root,binding}=await fixture(t,'abort');let changed=false;
  const service=await createFailureRecoveryService(root,{onBoundary:async e=>{
    if(e.phase==='journal:before'&&!changed){changed=true;await fs.appendFile(join(root,'staging/song-candidates.json'),'\n');}
  }}),o=await service.inspect(binding);
  await assert.rejects(service.run({binding,command:command(binding,o)}),{code:'RECOVERY_REQUIRED'});
  assert.equal(changed,true);
  assert.deepEqual(await fs.readdir(join(root,`staging/transactions/${binding.transaction_id}/journal`)),['000001.json']);
  await assert.rejects(fs.stat(join(root,`staging/transaction-proofs/${binding.transaction_id}.json`)),{code:'ENOENT'});
});

for(const mode of ['alltarget','decided','history'])test(`${mode}: valid success-side observation is never dispatched or rolled back by 6C`,async t=>{
  const {root,binding}=await fixture(t,mode),service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  assert.deepEqual(o.allowed_actions,['finalize_success']);
  const before=(await readCanonicalSnapshot(root)).manifest,state=await fs.readFile(join(root,'staging/fn004-state.json'));
  await assert.rejects(service.run({binding,command:command(binding,o)}),{code:'RECOVERY_REQUIRED'});
  assert.deepEqual((await readCanonicalSnapshot(root)).manifest,before);
  assert.equal((await fs.readFile(join(root,'staging/fn004-state.json'))).equals(state),true);
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}`)),{code:'ENOENT'});
});

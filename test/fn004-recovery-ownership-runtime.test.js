import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fixture, command } from './fixtures/recovery-runtime.js';
import { createFailureRecoveryService } from '../src/fn004-failure-recovery.js';
import { probeRecoveryOwner } from '../src/fn004-recovery-process.js';

test('actual live current owner and stale-PID-only observation never grant takeover',async t=>{
  const {root,binding}=await fixture(t,'abort',true),service=await createFailureRecoveryService(root);
  const o=await service.inspect(binding);assert.equal(o.classification,'active');assert.deepEqual(o.allowed_actions,[]);
  await assert.rejects(service.run({binding,command:{...command(binding,o),action:'abort'}}),{code:'RECOVERY_REQUIRED'});
  const uncertain=await createFailureRecoveryService(root,{probeOwner:async owner=>({...await probeRecoveryOwner(owner),status:'unverifiable'})});
  assert.deepEqual((await uncertain.inspect(binding)).allowed_actions,[]);
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}`)),{code:'ENOENT'});
});
async function crash(t,root,binding,boundary){
  const child=fork(new URL('./fixtures/recovery-runtime-child.js',import.meta.url),['run',root,JSON.stringify(binding),boundary],
    {stdio:['ignore','ignore','pipe','ipc']});
  let error='';child.stderr.on('data',c=>error+=c);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(error);})]);
  assert.equal(message.boundary,boundary);const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
}
test('H-01: B retirement crash then C claim crash then D keeps the entire prefix and uses sequence 2',async t=>{
  const {root,binding}=await fixture(t,'abort');
  await crash(t,root,binding,'retiring:after');
  const archive=join(root,`staging/recovery-ownership/${binding.transaction_id}`);
  const anchor=await fs.readFile(join(archive,'anchor.json'));
  await crash(t,root,binding,'claim:after');
  const first=await fs.readFile(join(archive,'claims/000001.json'));
  const service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  assert.deepEqual(o.allowed_actions,['cleanup']);
  assert.equal((await service.run({binding,command:command(binding,o)})).observation.readiness,'initialized');
  assert.equal((await fs.readFile(join(archive,'anchor.json'))).equals(anchor),true);
  assert.equal((await fs.readFile(join(archive,'claims/000001.json'))).equals(first),true);
  assert.deepEqual(await fs.readdir(join(archive,'claims')),['000001.json','000002.json']);
  const second=JSON.parse(await fs.readFile(join(archive,'claims/000002.json')));
  assert.equal(second.payload.previous_claim_hash,JSON.parse(first).hash);
  const {acquireGate,releaseGate}=await import('../src/fn004-gate.js');
  const gate=await acquireGate({root});await releaseGate(gate);
  const oldPath=join(archive,'retirements/000000.retiring.json');
  const old=JSON.parse(await fs.readFile(oldPath));old.payload.terminal_proof_hash='0'.repeat(64);
  const {evidenceHashV1}=await import('../src/fn004-evidence-hash.js');old.hash=evidenceHashV1(old.kind,old.payload);
  await fs.writeFile(oldPath,JSON.stringify(old));
  await assert.rejects(acquireGate({root}),{code:'GATE_CORRUPT'});

});
test('unanchored barrier after real crash is manual STOP, never reconstructed',async t=>{
  const {root,binding}=await fixture(t,'abort');await crash(t,root,binding,'barrier:after');
  const service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  assert.deepEqual(o.allowed_actions,[]);
  await assert.rejects(service.run({binding,command:{...command(binding,o),action:'abort'}}),{code:'RECOVERY_REQUIRED'});
  await assert.rejects(fs.stat(join(root,`staging/recovery-ownership/${binding.transaction_id}/anchor.json`)),{code:'ENOENT'});
});

test('owned classifier input stays pure after capability revocation; stale capability cannot adopt a gate',async t=>{
  const {root,binding}=await fixture(t,'abort'),service=await createFailureRecoveryService(root),o=await service.inspect(binding);
  const { acquireRecoveryAuthority, refreshRecoveryAuthority, revokeRecoveryAuthority, recoverySessionDetails }=await import('../src/fn004-recovery-authority.js');
  const { classifyRecoverySnapshot }=await import('../src/fn004-recovery-classifier.js');
  const { asOwnedRecoverySnapshot }=await import('../src/fn004-recovery-snapshot.js');
  const { adoptRecoveryGate }=await import('../src/fn004-gate.js');
  const cap=await acquireRecoveryAuthority(root,binding,command(binding,o)),snapshot=await refreshRecoveryAuthority(cap);
  const result=classifyRecoverySnapshot(snapshot);assert.deepEqual(result.allowed_actions,['abort']);
  const view=recoverySessionDetails(cap);assert.throws(()=>{view.active=false;},TypeError);
  assert.throws(()=>{view.head.payload.owner.process_id=1;},TypeError);
  const copy=view.discovery;copy.rawBytes['staging/.fn004.lock'].fill(0);
  assert.notDeepEqual(copy.rawBytes['staging/.fn004.lock'],recoverySessionDetails(cap).discovery.rawBytes['staging/.fn004.lock']);
  assert.throws(()=>asOwnedRecoverySnapshot(snapshot,{}),{code:'INTEGRITY_CONFLICT'});
  revokeRecoveryAuthority(cap);assert.deepEqual(classifyRecoverySnapshot(snapshot),result);
  await assert.rejects(adoptRecoveryGate(cap),{code:'INTEGRITY_CONFLICT'});
});

test('normal acquisition refuses an unsealed archive even when its barrier was lost',async t=>{
  const {root,binding}=await fixture(t,'abort');await crash(t,root,binding,'retiring:after');
  await fs.unlink(join(root,'staging/.fn004-recovery.lock'));
  const {acquireGate}=await import('../src/fn004-gate.js');
  await assert.rejects(acquireGate({root}),{code:'GATE_CORRUPT'});
});

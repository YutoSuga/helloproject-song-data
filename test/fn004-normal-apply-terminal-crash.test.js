import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {normalApplyFixture} from './fixtures/normal-apply.js';
import {command} from './fixtures/recovery-runtime.js';
import {createCanonicalApplyService} from '../src/fn004-apply-application.js';
import {createFailureRecoveryService} from '../src/fn004-failure-recovery.js';
import {createSuccessRecoveryService} from '../src/fn004-success-recovery.js';

for(const boundary of ['receipt:after','gate_release:before','gate_release:after'])test(`6E SIGKILL ${boundary}: no inferred dispatch or semantic re-execution`,{timeout:900000},async t=>{
  const f=await normalApplyFixture(t),child=fork(new URL('./fixtures/normal-apply-child.js',import.meta.url),
    [f.root,JSON.stringify(f.payload),JSON.stringify(f.context),boundary],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',c=>stderr+=c);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(stderr);})]);
  assert.equal(message.boundary,boundary,JSON.stringify(message));
  const exit=once(child,'exit');child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');
  const binding=message.binding,state=await fs.readFile(join(f.root,'staging/fn004-state.json'));
  const request=await fs.readFile(join(f.root,`staging/apply-requests/${binding.request_id}.json`));
  const recovery=await (boundary==='receipt:after'?createFailureRecoveryService:createSuccessRecoveryService)(f.root);
  const o=await recovery.inspect(binding);
  if(boundary==='receipt:after'){
    assert.deepEqual(o.allowed_actions,[]);assert.equal(o.classification,'manual_stop');
    await assert.rejects(fs.stat(join(f.root,`staging/transactions/${binding.transaction_id}/owner.json`)),{code:'ENOENT'});
    await assert.rejects(recovery.run({binding,command:{...command(binding,o),action:'abort'}}));
  }else if(boundary==='gate_release:before'){
    assert.deepEqual(o.allowed_actions,['cleanup']);
    assert.equal((await recovery.run({binding,command:command(binding,o)})).observation.readiness,'initialized');
  }else {
    assert.deepEqual(o.allowed_actions,[]);assert.equal(o.readiness,'initialized');
  }
  assert.deepEqual(await fs.readFile(join(f.root,'staging/fn004-state.json')),state);
  assert.deepEqual(await fs.readFile(join(f.root,`staging/apply-requests/${binding.request_id}.json`)),request);
  if(boundary!=='receipt:after')assert.ok((await createCanonicalApplyService({root:f.root}).submitApplyRequest(f.payload,f.context)).result);
});

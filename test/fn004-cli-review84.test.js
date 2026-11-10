import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resultDocument} from '../src/canonical-cli-output.js';
import {parseCanonicalArguments,CliArgumentError} from '../src/canonical-cli-arguments.js';
import {DECLARATION_STATEMENT} from '../src/fn004-state.js';
import {readCanonicalSnapshot} from '../src/canonical-snapshot.js';
import {serializeCanonicalTable} from '../src/fn004-target-materialization.js';
import {cli,tty,cliFixture,evidenceHashes,cliPath} from './fixtures/canonical-cli.js';

// Test-only human pause: the production CLI has no hook or answer-file option.
async function changeDuringPrompt(root,args,change){
 const answer=join(root,'review84-answer.txt');
 const path=fileURLToPath(new URL('./fixtures/canonical-cli-pty.py',import.meta.url));
 const child=spawn('python3',[path,JSON.stringify({root,argv:[process.execPath,cliPath,...args,'--json'],answer_file:answer})]);
 const closed=once(child,'close');let stdout='',stderr='',prompt=false,error,changing;
 child.stdout.on('data',b=>stdout+=b);
 child.stderr.on('data',b=>{
  stderr+=b;
  if(!prompt&&stderr.includes('TRUSTED_PROMPT')){
   prompt=true;changing=(async()=>{
    try{await change();}catch(e){error=e;}
    await fs.writeFile(answer,error?'n\n':'y\n');
   })();
  }
 });
 const [code]=await closed;if(changing)await changing;if(error)throw error;
 assert.equal(code,0,stderr);assert.equal(prompt,true,stdout+stderr);
 const result=JSON.parse(stdout);return {...result,data:JSON.parse(result.stdout)};
}

test('R84 review Request result and repository readiness remain independent axes',()=>{
 for(const command of ['apply','result'])for(const readiness of ['recovery_required','cleanup_required']){
  const response={artifact:{},result:{apply_id:'apply',record_hash:'hash'},readiness,
   diagnostics:[{code:'RECOVERY_REQUIRED'}]};
  const result=resultDocument(command,{response});
  assert.equal(result.exit,7);
  assert.equal(result.dto.canonical_effect,'applied');
  assert.equal(result.dto.readiness,readiness);
  assert.deepEqual(result.dto.data.response,response);
  assert.deepEqual(result.dto.diagnostics,response.diagnostics);
 }
 for(const command of ['apply','result']){
  const result=resultDocument(command,{response:{result:{apply_id:'apply',record_hash:'hash'},
   readiness:'initialized',diagnostics:[]}});
  assert.equal(result.exit,0);
  assert.equal(result.dto.outcome,command==='apply'?'completed':'already_applied');
 }
});

test('R84 review History publication cannot bypass retained gate or pending retirement in public result',
 {timeout:1800000},async t=>{
 const f=await cliFixture(t);
 const stopped=await tty(f.root,f.args,{mode:'kill',target:'history:after'});
 assert.equal(stopped.code,-9);assert.equal(stopped.killed,true);
 const names=(await fs.readdir(join(f.root,'staging/apply-requests'))).filter(n=>n.endsWith('.json'));
 assert.equal(names.length,1);
 const r=JSON.parse(await fs.readFile(join(f.root,'staging/apply-requests',names[0]))).receipt;
 const before=await evidenceHashes(f.root);
 const pending=await cli(f.root,['result','--request',r.request_id]);
 assert.equal(pending.code,5,JSON.stringify(pending));
 assert.equal(pending.data.error.code,'GATE_BUSY');
 assert.notEqual(pending.data.readiness,'initialized');
 assert.deepEqual(await evidenceHashes(f.root),before);
 const o=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(o.allowed_actions,['finalize_success']);
 const run=await tty(f.root,['recovery','run','--transaction',r.transaction_id,
  '--expect-state-hash',o.observed_state_hash,'--action','finalize_success'],
  {mode:'kill',target:'gate_release:after'});
 assert.equal(run.code,-9);assert.equal(run.killed,true);
 const terminal=await evidenceHashes(f.root);
 const cleanup=await cli(f.root,['result','--request',r.request_id]);
 assert.ok([5,6,7,8].includes(cleanup.code),JSON.stringify(cleanup));
 assert.notEqual(cleanup.data.readiness,'initialized');
 if(cleanup.code===7)assert.equal(cleanup.data.data.response.result.apply_id,r.apply_id);
 assert.deepEqual(await evidenceHashes(f.root),terminal);
 const next=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(next.allowed_actions,['cleanup']);
 const cleaned=await cli(f.root,['recovery','run','--transaction',r.transaction_id,
  '--expect-state-hash',next.observed_state_hash,'--action','cleanup']);
 assert.equal(cleaned.code,0,JSON.stringify(cleaned));
 const final=await cli(f.root,['result','--request',r.request_id]);
 assert.equal(final.code,0);assert.equal(final.data.readiness,'initialized');
 assert.equal(final.data.outcome,'already_applied');
 const completed=await evidenceHashes(f.root);
 assert.equal(completed['staging/fn004-state.json'],terminal['staging/fn004-state.json']);
 assert.equal(completed[`staging/apply-history/${r.apply_id}.json`],terminal[`staging/apply-history/${r.apply_id}.json`]);
});

test('R84 review stale inspect token cannot restore UNKNOWN bytes or acquire a successor',
 {timeout:900000},async t=>{
 const f=await cliFixture(t);
 assert.equal((await tty(f.root,f.args,{mode:'kill',target:'prepared:after'})).code,-9);
 const name=(await fs.readdir(join(f.root,'staging/apply-requests'))).find(n=>n.endsWith('.json'));
 const r=JSON.parse(await fs.readFile(join(f.root,'staging/apply-requests',name))).receipt;
 const old=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(old.allowed_actions,['abort']);
 await fs.appendFile(join(f.root,'data/works.csv'),'UNKNOWN');
 const before=await evidenceHashes(f.root);
 const result=await cli(f.root,['recovery','run','--transaction',r.transaction_id,
  '--expect-state-hash',old.observed_state_hash,'--action','abort']);
 assert.equal(result.code,6,JSON.stringify(result));
 assert.deepEqual(await evidenceHashes(f.root),before);
 assert.equal(Object.keys(before).some(p=>p.startsWith('staging/recovery-ownership/')),false);
});

test('R84 review private authority, seam and bypass options never reach services',()=>{
 for(const flag of ['--actor','--root','--io','--probe-owner','--on-boundary','--services-factory','--force','--skip-validation'])
  assert.throws(()=>parseCanonicalArguments(['apply','--plan','ap_'+'a'.repeat(64),'--expect-plan-hash','a'.repeat(64),flag,'value']),CliArgumentError);
});

test('R84 review Apply revalidates after human confirmation without holding the gate',
 {timeout:900000},async t=>{
 const f=await cliFixture(t);let expected;
 const result=await changeDuringPrompt(f.root,f.args,async()=>{
  await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
  const source=structuredClone(f.candidates);source.candidates[0].title+=' changed while waiting';
  await fs.writeFile(join(f.root,'staging/song-candidates.json'),JSON.stringify(source));
  expected=await evidenceHashes(f.root);
 });
 assert.equal(result.code,4,JSON.stringify(result));assert.equal(result.answered,true);
 assert.deepEqual(await evidenceHashes(f.root),expected);
 assert.equal(Object.keys(expected).some(p=>p.startsWith('staging/apply-requests/')),false);
});

test('R84 review bootstrap rechecks audited bytes after human confirmation and publishes nothing stale',
 {timeout:900000},async t=>{
 const f=await cliFixture(t);await fs.rm(join(f.root,'staging'),{recursive:true});
 const declaration={schema_version:1,namespaces:f.state.high_water_marks,statement:DECLARATION_STATEMENT,evidence:[]};
 const path=join(f.root,'review84-declaration.json');await fs.writeFile(path,JSON.stringify(declaration));
 const check=await cli(f.root,['init','--check','--external-declaration',path]);assert.equal(check.code,0);
 let expected;
 const result=await changeDuringPrompt(f.root,['init','--external-declaration',path,'--expect-audit-hash',check.data.data.audit_hash],async()=>{
  await assert.rejects(fs.stat(join(f.root,'staging/.fn004.lock')),{code:'ENOENT'});
  const snapshot=await readCanonicalSnapshot(f.root);snapshot.tables.works[0].notes+=' independent audit change';
  await fs.writeFile(join(f.root,'data/works.csv'),serializeCanonicalTable('works',snapshot.tables.works));
  assert.equal((await readCanonicalSnapshot(f.root)).validation.ok,true);
  expected=await evidenceHashes(f.root);
 });
 assert.equal(result.code,4,JSON.stringify(result));assert.equal(result.data.error.code,'BOOTSTRAP_AUDIT_MISMATCH');
 assert.deepEqual(await evidenceHashes(f.root),expected);
 await assert.rejects(fs.stat(join(f.root,'staging/fn004-state.json')),{code:'ENOENT'});
 await assert.rejects(fs.stat(join(f.root,'staging/fn004-bootstrap.json')),{code:'ENOENT'});
});

for(const corrupt of [false,true])test(`R84-M02 Recovery I/O failure ${corrupt?'rejects newly UNKNOWN bytes':'preserves a freshly proven committed effect'}`,
 {timeout:1800000},async t=>{
 const f=await cliFixture(t);
 const killed=await tty(f.root,f.args,{mode:'kill',target:'decided:after'});
 assert.equal(killed.code,-9);assert.equal(killed.killed,true);
 const requests=join(f.root,'staging/apply-requests');
 const names=(await fs.readdir(requests)).filter(n=>n.endsWith('.json'));assert.equal(names.length,1);
 const requestPath=join(requests,names[0]),receipt=await fs.readFile(requestPath),r=JSON.parse(receipt).receipt;
 const statePath=join(f.root,'staging/fn004-state.json'),consumedBytes=await fs.readFile(statePath),consumed=JSON.parse(consumedBytes);
 const journal=join(f.root,`staging/transactions/${r.transaction_id}/journal`);
 const entries=await Promise.all((await fs.readdir(journal)).map(async n=>JSON.parse(await fs.readFile(join(journal,n)))));
 const record=entries.find(e=>e.payload.phase==='COMMIT_DECIDED').payload.history.record;
 const before=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(before.allowed_actions,['finalize_success']);
 const failed=await tty(f.root,['recovery','run','--transaction',r.transaction_id,
  '--expect-state-hash',before.observed_state_hash,'--action','finalize_success'],{mode:corrupt?'io-history-unknown':'io-history'});
 assert.equal(failed.data.error.code,'PERSISTENCE_WRITE_FAILED');assert.equal(failed.data.error.phase,'publish');
 assert.equal(failed.data.error.published,false);assert.ok(failed.data.error.cause_codes.includes('EIO'));
 assert.equal(failed.data.error.path,`staging/apply-history/${r.apply_id}.json`);
 assert.deepEqual(await fs.readFile(requestPath),receipt);assert.deepEqual(await fs.readFile(statePath),consumedBytes);
 const evidence=await evidenceHashes(f.root);
 const after=(await cli(f.root,['recovery','inspect','--request',r.request_id])).data.data;
 assert.deepEqual(await evidenceHashes(f.root),evidence);
 if(corrupt){
  assert.equal(failed.code,1,JSON.stringify(failed));assert.equal(failed.data.canonical_effect,'unknown');
  assert.equal(after.readiness,'blocked');assert.deepEqual(after.allowed_actions,[]);
  assert.ok((await fs.readFile(join(f.root,'data/works.csv'),'utf8')).endsWith('UNKNOWN'));
  const refused=await cli(f.root,['recovery','run','--transaction',r.transaction_id,
   '--expect-state-hash',after.observed_state_hash,'--action','finalize_success']);
  assert.equal(refused.code,6);assert.deepEqual(await evidenceHashes(f.root),evidence);return;
 }
 assert.equal(failed.code,7,JSON.stringify(failed));assert.equal(failed.data.canonical_effect,'applied');
 assert.equal(failed.data.readiness,'recovery_required');assert.deepEqual(after.allowed_actions,['finalize_success']);
 const resumed=await cli(f.root,['recovery','run','--transaction',r.transaction_id,
  '--expect-state-hash',after.observed_state_hash,'--action','finalize_success']);
 assert.equal(resumed.code,0,JSON.stringify(resumed));assert.equal(resumed.data.readiness,'initialized');
 assert.deepEqual(await fs.readdir(join(f.root,'staging/apply-history')),[r.apply_id+'.json']);
 assert.deepEqual(JSON.parse(await fs.readFile(join(f.root,`staging/apply-history/${r.apply_id}.json`))),record);
 const finalState=JSON.parse(await fs.readFile(statePath));assert.equal(finalState.generation,consumed.generation+1);
 assert.deepEqual(finalState.high_water_marks,consumed.high_water_marks);assert.deepEqual(finalState.allocation_events,consumed.allocation_events);
 const completed=await evidenceHashes(f.root),result=await cli(f.root,['result','--request',r.request_id]);
 assert.equal(result.code,0);assert.equal(result.data.data.response.result.apply_id,r.apply_id);
 assert.deepEqual(await evidenceHashes(f.root),completed);assert.deepEqual(await fs.readFile(requestPath),receipt);
});

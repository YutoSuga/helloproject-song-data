import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { acquireGate, releaseGate, GATE_PATH } from '../src/fn004-gate.js';
import { isGateCandidate } from '../src/fn004-gate-candidate.js';
import { discoverEvidence } from '../src/fn004-evidence-discovery.js';
import { validateEvidenceNamespace } from '../src/fn004-evidence-namespace.js';
import { createPersistence } from '../src/persistence.js';
import { inspectRuntimeState } from '../src/fn004-runtime-state.js';

const boundaries = ['before_temp_create', 'after_temp_create', 'during_temp_write',
  'metadata_complete_before_sync', 'after_file_sync', 'before_link', 'after_link',
  'after_directory_sync', 'after_candidate_unlink', 'before_response', 'owned_no_domain',
  'release_before_unlink', 'release_after_unlink', 'release_after_directory_sync'];

for (const boundary of boundaries) test(`GP08 real SIGKILL/restart at ${boundary}`, { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-gp-kill-'));
  await fs.mkdir(join(root, 'staging'));
  const child = fork(new URL('./fixtures/gate-publication-child.js', import.meta.url),
    ['--gate-publication-child', root, boundary], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
    await fs.rm(root, { recursive: true, force: true });
  });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const reached = await new Promise((resolve, reject) => {
    child.on('message', m => m.type === 'boundary' ? resolve(m) : reject(new Error(m.message)));
    child.once('exit', (code, signal) => reject(new Error(`Before boundary: ${code}/${signal}: ${stderr}`)));
  });
  assert.equal(reached.boundary, boundary);
  if (boundary === 'during_temp_write') {
    // GP02: another real process may win while the earlier candidate is
    // incomplete. It must never see a partial final or adopt that candidate.
    const competing = await acquireGate({root});
    assert.equal(JSON.parse(await fs.readFile(join(root,GATE_PATH))).process_id,process.pid);
    await releaseGate(competing);
  }
  const exited = once(child, 'exit'); child.kill('SIGKILL');
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  const discovered = await discoverEvidence(root); validateEvidenceNamespace(discovered.files);
  const candidates = discovered.files.filter(f => f.kind === 'file' && isGateCandidate(f.path));
  const final = discovered.files.find(f => f.path === GATE_PATH && f.kind === 'file');
  assert.equal(discovered.files.some(f => f.path.includes('/owner.json') || f.path.includes('/completions/')), false);
  if (final) {
    assert.equal(discovered.documents[GATE_PATH].process_id, child.pid);
    await assert.rejects(acquireGate({ root }), { code: 'GATE_BUSY' });
    assert.deepEqual(await fs.readFile(join(root, GATE_PATH)), discovered.rawBytes[GATE_PATH]);
  } else {
    const next = await acquireGate({ root });
    const state = await inspectRuntimeState(await createPersistence(root), { gate: next });
    assert.equal(state.status, 'BOOTSTRAP_REQUIRED'); // Fresh lease is not bootstrap/domain proof.
    await releaseGate(next);
  }
  for (const file of candidates) assert.deepEqual(await fs.readFile(join(root, file.path)), discovered.rawBytes[file.path]);
});

test('GP03 two independent completed publishers race one exclusive hard link', {timeout:60000}, async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-gp-link-race-'));await fs.mkdir(join(root,'staging'));
  const children=[0,1].map(()=>fork(new URL('./fixtures/gate-publication-child.js',import.meta.url),
    ['--gate-link-race-child',root],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']}));
  t.after(async()=>{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended;}
    await fs.rm(root,{recursive:true,force:true});
  });
  const results=children.map(child=>new Promise((resolve,reject)=>{
    child.on('message',m=>{if(m.type==='result')resolve(m);});
    child.once('error',reject);
  }));
  await Promise.all(children.map(child=>new Promise((resolve,reject)=>{
    child.on('message',m=>{if(m.type==='prepared')resolve();});child.once('exit',()=>reject(Error('Exited before link')));
  })));
  children.forEach(child=>child.send('go'));
  const outcomes=await Promise.all(results);assert.equal(outcomes.filter(x=>x.outcome==='acquired').length,1);
  assert.equal(outcomes.filter(x=>x.outcome==='GATE_BUSY').length,1);
  const winner=outcomes.findIndex(x=>x.outcome==='acquired');
  assert.equal(JSON.parse(await fs.readFile(join(root,GATE_PATH))).process_id,children[winner].pid);
  const ended=once(children[winner],'exit');children[winner].send('release');assert.deepEqual(await ended,[0,null]);
  assert.deepEqual(await fs.readdir(join(root,'staging')),[]);
});

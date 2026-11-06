import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireGate } from '../../src/fn004-gate.js';
import { sha256 } from '../../src/canonical-hash.js';
import { commitFixture, transactionFixture, append, recoveryDiscovery } from './transaction-evidence.js';

// Keep the IPC handle referenced while paused. An unsettled top-level await
// alone may exit naturally and is not a substitute for a real SIGKILL.
if (process.send && ['setup', 'setup-normal', 'run', 'run-success'].includes(process.argv[2])) process.on('message', () => {});

if (['setup','setup-normal'].includes(process.argv[2])) {
  const root = process.argv[3], mode = process.argv[4];
  const abortMode = ['abort','receipt','prepared','intentlag'].includes(mode);
  const successMode=['alltarget','decided','history'].includes(mode)||mode.startsWith('success-');
  const liveGate=await acquireGate({ root, operation: 'apply' });
  const raw = await fs.readFile(join(root, 'staging/.fn004.lock'));
  const stat = await fs.stat(join(root, 'staging/.fn004.lock'), { bigint: true });
  const gate = { metadata: JSON.parse(raw), byte_length: raw.length, sha256: sha256(raw), device: stat.dev.toString(), inode: stat.ino.toString() };
  const f = mode === 'abort' || mode === 'receipt' ? transactionFixture({ gate }) : commitFixture({ gate, newEntities: !['noop','unconsumed','success-noop','success-noop-exception'].includes(mode), noop: ['noop','success-noop','success-noop-exception'].includes(mode) });
  let journal = mode === 'receipt' ? [] : ['abort','intentlag'].includes(mode) ? [f.genesis] : mode === 'prepared' ? f.journal.slice(0,2) : ['noop','unconsumed'].includes(mode) ? f.journal.slice(0,3) : f.journal.slice(0,4);
  let P = [];
  if (!abortMode && !['noop','unconsumed'].includes(mode)) {
    P = f.intent.payload.changed_paths.slice(0, f.intent.payload.changed_paths.indexOf(successMode ? f.intent.payload.changed_paths.at(-1) : mode === 'mixed' ? 'data/songs.csv' : 'data/song_artists.csv') + 1);
    journal.push(append(f.consumed, { replaced_paths: P }));
  }
  if(mode==='decided'||mode==='history')journal=f.journal.slice(0,mode==='decided'?6:7);
  if(mode.startsWith('success-'))journal=f.journal.slice(0,mode==='success-completed'?8:mode==='success-state'?7:mode==='success-lag'?3:['success-candidate','success-noop-exception'].includes(mode)?5:6);
  const d = recoveryDiscovery(f, { journal, intent: ['abort','receipt'].includes(mode) ? null : f.intent,
    state: ['success-state','success-completed'].includes(mode) ? f.after : abortMode || ['noop','unconsumed'].includes(mode) ? f.state : f.intent.payload.expected_consumed_state,
    omit: P.map(path => `staging/transactions/${f.binding.transaction_id}/temp/${path}`) });
  if(['history','success-state','success-completed'].includes(mode))d.rawBytes[`staging/apply-history/${f.binding.apply_id}.json`]=Buffer.from(JSON.stringify(f.record));
  if(mode==='success-candidate')d.rawBytes[`staging/transactions/${f.binding.transaction_id}/temp/apply-history.json`]=Buffer.from(JSON.stringify(f.record));
  for (const [path, bytes] of Object.entries(d.rawBytes)) {
    if (path === 'staging/.fn004.lock') continue;
    await fs.mkdir(join(root, path.slice(0,path.lastIndexOf('/'))), { recursive:true }); await fs.writeFile(join(root,path),bytes);
  }
  for (const args of [['init','-q','-b','main'],['add','data'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','original'],
    ['update-ref','refs/remotes/origin/main','HEAD']]) execFileSync('git',['-C',root,...args]);
  for (const path of P) await fs.writeFile(join(root,path),f.targetRawBytes[path]);
  if(process.argv[2]==='setup-normal') {
    const {createSuccessRecoveryService}=await import('../../src/fn004-success-recovery.js');
    const boundary=process.argv[5];
    const service=await createSuccessRecoveryService(root,{onBoundary:async e=>{
      if(e.phase===boundary){process.send({binding:f.binding,boundary});await new Promise(()=>{});}
    }});
    const result=await service.finalize({gate:liveGate,binding:f.binding});
    process.send({binding:f.binding,result});
  } else process.send({ binding:f.binding });
  await new Promise(() => {});
} else if (['run','run-success'].includes(process.argv[2])) {
  const createService=process.argv[2]==='run-success' ?
    (await import('../../src/fn004-success-recovery.js')).createSuccessRecoveryService :
    (await import('../../src/fn004-failure-recovery.js')).createFailureRecoveryService;
  const root = process.argv[3], binding = JSON.parse(process.argv[4]), boundary = process.argv[5];
  let lastRestore = false, injected = false;
  const successFault=boundary?.startsWith('success-fault:')?boundary.slice(14):null;
  let activePhase=null;
  const historyPath=join(root,`staging/apply-history/${binding.apply_id}.json`);
  const cause=Object.assign(new Error('success publication fault'),{code:'EIO'});
  const faultIo = successFault ? {...fs,
    open:async(path,...args)=>{
      const h=await fs.open(path,...args);
      if(successFault==='history-partial-kill'&&activePhase==='history:before'&&String(path).includes('/.fn004-apply_')) {
        return {close:()=>h.close(),sync:()=>h.sync(),writeFile:async bytes=>{
          await h.writeFile(bytes.subarray(0,8));await h.sync();
          process.send({boundary:'history-partial'});await new Promise(()=>{});
        }};
      }
      if(!(successFault==='decision-sync'&&activePhase==='decision_confirm:before'&&String(path).includes('/journal/')&&String(path).endsWith('.json')||
        successFault==='target-sync'&&activePhase==='target_confirm:before'&&String(path).startsWith(join(root,'data/'))||
        successFault==='target-source-sync'&&activePhase==='target_confirm:before'&&path===join(root,`staging/transactions/${binding.transaction_id}/temp/data`)||
        successFault==='consumption-sync'&&activePhase==='consumption_confirm:before'&&path===join(root,'staging/fn004-state.json')||
        successFault==='terminal-sync'&&activePhase==='terminal_journal_confirm:before'&&String(path).includes('/journal/')&&String(path).endsWith('.json')||
        successFault==='state-confirm-sync'&&activePhase==='success_state_confirm:before'&&path===join(root,'staging/fn004-state.json')))return h;
      return {close:()=>h.close(),sync:async()=>{if(!injected){injected=true;throw cause;}await h.sync();}};
    },
    link:async(from,to)=>{
      if(to===historyPath&&successFault==='history-link-before'&&!injected){injected=true;throw cause;}
      await fs.link(from,to);
      if(to===historyPath&&successFault==='history-link-after'&&!injected){injected=true;throw cause;}
    },
    rename:async(from,to)=>{
      await fs.rename(from,to);
      if(to===join(root,'staging/fn004-state.json')&&successFault==='state-rename-after'&&!injected){injected=true;throw cause;}
    },
    readFile:async(path,...args)=>{
      if(!injected&&(successFault==='history-readback'&&activePhase==='history:before'&&path===historyPath||
        successFault==='completion-readback'&&activePhase==='completion:before'&&String(path).endsWith(`/completions/${binding.request_id}.json`))) {
        try{await fs.stat(path);}catch(e){if(e.code==='ENOENT')return fs.readFile(path,...args);throw e;}
        injected=true;throw cause;
      }
      return fs.readFile(path,...args);
    }
  } : boundary === 'last_restore_sync_failure' ? { ...fs,
    rename: async (from,to) => { await fs.rename(from,to); if(to === join(root,'data/works.csv')) lastRestore = true; },
    open: async (path,...args) => {
      const handle = await fs.open(path,...args);
      if (String(path) !== join(root,'data')) return handle;
      return { close: () => handle.close(), sync: async () => {
        if(lastRestore && !injected) { injected = true; throw Object.assign(new Error('last restore directory sync'),{code:'EIO'}); }
        await handle.sync();
      } };
    } } : fs;
  const service = await createService(root, { io: faultIo, onBoundary: async e => {
    activePhase=e.phase;
    if(e.phase === boundary || boundary === 'restore_last:after' && e.phase === 'restore:after' && e.path === 'data/works.csv') {
      process.send({ boundary }); await new Promise(() => {});
    }
  } });
  const o = await service.inspect(binding);
  try {
    const result = await service.run({ binding, command:{ schema_version:2, request_id:binding.request_id,transaction_id:binding.transaction_id,
      expected_observed_state_hash:o.observed_state_hash,action:o.allowed_actions[0] } });
    process.send({ result });
  } catch(error) {
    if(boundary !== 'last_restore_sync_failure'&&!successFault) throw error;
    process.send({ error: {code:error.code,phase:error.phase,published:error.published,...(successFault?{path:error.path,io_code:error.cause?.code}: {})}, injected });
    await new Promise(() => {});
  }
}

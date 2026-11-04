import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireGate } from '../../src/fn004-gate.js';
import { sha256 } from '../../src/canonical-hash.js';
import { commitFixture, transactionFixture, append, recoveryDiscovery } from './transaction-evidence.js';

// Keep the IPC handle referenced while paused. An unsettled top-level await
// alone may exit naturally and is not a substitute for a real SIGKILL.
if (process.send && ['setup', 'run'].includes(process.argv[2])) process.on('message', () => {});

if (process.argv[2] === 'setup') {
  const root = process.argv[3], mode = process.argv[4];
  const abortMode = ['abort','receipt','prepared','intentlag'].includes(mode);
  const successMode=['alltarget','decided','history'].includes(mode);
  await acquireGate({ root, operation: 'apply' });
  const raw = await fs.readFile(join(root, 'staging/.fn004.lock'));
  const stat = await fs.stat(join(root, 'staging/.fn004.lock'), { bigint: true });
  const gate = { metadata: JSON.parse(raw), byte_length: raw.length, sha256: sha256(raw), device: stat.dev.toString(), inode: stat.ino.toString() };
  const f = mode === 'abort' || mode === 'receipt' ? transactionFixture({ gate }) : commitFixture({ gate, newEntities: !['noop','unconsumed'].includes(mode), noop: mode==='noop' });
  let journal = mode === 'receipt' ? [] : ['abort','intentlag'].includes(mode) ? [f.genesis] : mode === 'prepared' ? f.journal.slice(0,2) : ['noop','unconsumed'].includes(mode) ? f.journal.slice(0,3) : f.journal.slice(0,4);
  let P = [];
  if (!abortMode && !['noop','unconsumed'].includes(mode)) {
    P = f.intent.payload.changed_paths.slice(0, f.intent.payload.changed_paths.indexOf(successMode ? f.intent.payload.changed_paths.at(-1) : mode === 'mixed' ? 'data/songs.csv' : 'data/song_artists.csv') + 1);
    journal.push(append(f.consumed, { replaced_paths: P }));
  }
  if(mode==='decided'||mode==='history')journal=f.journal.slice(0,mode==='decided'?6:7);
  const d = recoveryDiscovery(f, { journal, intent: ['abort','receipt'].includes(mode) ? null : f.intent,
    state: abortMode || ['noop','unconsumed'].includes(mode) ? f.state : f.intent.payload.expected_consumed_state,
    omit: P.map(path => `staging/transactions/${f.binding.transaction_id}/temp/${path}`) });
  if(mode==='history')d.rawBytes[`staging/apply-history/${f.binding.apply_id}.json`]=Buffer.from(JSON.stringify(f.record));
  for (const [path, bytes] of Object.entries(d.rawBytes)) {
    if (path === 'staging/.fn004.lock') continue;
    await fs.mkdir(join(root, path.slice(0,path.lastIndexOf('/'))), { recursive:true }); await fs.writeFile(join(root,path),bytes);
  }
  for (const args of [['init','-q','-b','main'],['add','data'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','original'],
    ['update-ref','refs/remotes/origin/main','HEAD']]) execFileSync('git',['-C',root,...args]);
  for (const path of P) await fs.writeFile(join(root,path),f.targetRawBytes[path]);
  process.send({ binding:f.binding });
  await new Promise(() => {});
} else if (process.argv[2] === 'run') {
  const { createFailureRecoveryService } = await import('../../src/fn004-failure-recovery.js');
  const root = process.argv[3], binding = JSON.parse(process.argv[4]), boundary = process.argv[5];
  const service = await createFailureRecoveryService(root, { onBoundary: async e => {
    if(e.phase === boundary || boundary === 'restore_last:after' && e.phase === 'restore:after' && e.path === 'data/works.csv') {
      process.send({ boundary }); await new Promise(() => {});
    }
  } });
  const o = await service.inspect(binding);
  const result = await service.run({ binding, command:{ schema_version:2, request_id:binding.request_id,transaction_id:binding.transaction_id,
    expected_observed_state_hash:o.observed_state_hash,action:o.allowed_actions[0] } });
  process.send({ result });
}

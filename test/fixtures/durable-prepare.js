import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireGate, releaseGate } from '../../src/fn004-gate.js';
import { sha256 } from '../../src/canonical-hash.js';
import { transactionFixture, recoveryDiscovery } from './transaction-evidence.js';

const exec = promisify(execFile);
export async function prepareFixture(t, options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-prepare-'));
  const gate = await acquireGate({ root, operation: 'apply' });
  let ownsGate=true;
  t.after(async () => { try { if(ownsGate)await releaseGate(gate); } finally { await fs.rm(root, { recursive: true, force: true }); } });
  const raw = await fs.readFile(join(root, 'staging/.fn004.lock')), stat = await fs.stat(join(root, 'staging/.fn004.lock'), { bigint: true });
  const witness = { metadata: JSON.parse(raw), byte_length: raw.length, sha256: sha256(raw), device: stat.dev.toString(), inode: stat.ino.toString() };
  const f = transactionFixture({ ...options, gate: witness });
  const initial = recoveryDiscovery(f, { journal: [] });
  for (const [path, bytes] of Object.entries(initial.rawBytes)) {
    if (path === 'staging/.fn004.lock') continue;
    await fs.mkdir(join(root, path.slice(0, path.lastIndexOf('/'))), { recursive: true });
    await fs.writeFile(join(root, path), bytes);
  }
  for (const args of [['init', '-q', '-b', 'main'], ['add', 'data'],
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'canonical'],
    ['update-ref', 'refs/remotes/origin/main', 'HEAD']]) await exec('git', ['-C', root, ...args]);
  const protectedPaths = [...Object.keys(f.snapshot.rawBytes), 'staging/fn004-state.json', 'staging/fn004-bootstrap.json',
    `staging/apply-requests/${f.binding.request_id}.json`];
  async function protectedHashes() {
    const entries = await Promise.all(protectedPaths.map(async path => [path, sha256(await fs.readFile(join(root, path)))]));
    return Object.fromEntries(entries);
  }
  const before = await protectedHashes();
  async function releaseFixtureGate(){if(ownsGate){await releaseGate(gate);ownsGate=false;}}
  if(options.releaseGate)await releaseFixtureGate();
  return { ...f, root, gate, releaseFixtureGate, before, protectedHashes, apply_time: f.genesis.payload.apply_time };
}

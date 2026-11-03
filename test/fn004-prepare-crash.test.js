import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { prepareFixture } from './fixtures/durable-prepare.js';
import { createTransactionPreparer } from '../src/fn004-durable-prepare.js';
import { discoverEvidence } from '../src/fn004-evidence-discovery.js';
import { prepareRecoverySnapshot } from '../src/fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
import { auditGitIds } from '../src/fn004-git-audit.js';
import { sha256 } from '../src/canonical-hash.js';
import { exitedProbe } from './fixtures/transaction-evidence.js';

async function observe(root, binding) {
  const discovery = await discoverEvidence(root), metadata = discovery.documents['staging/.fn004.lock'];
  const owner = Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
    'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, metadata[key]]));
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding, discovery, git_audit: await auditGitIds(root),
    probe: exitedProbe(owner) }));
}

for (const kind of ['intent', 'prepared']) for (const fault of ['partial_write', 'publish', 'directory_sync']) {
  test(`R78-M01: ${kind} ${fault} never disguises incomplete publication as a successful prepare`, async t => {
    const f = await prepareFixture(t); let injected = false, selectedFinal = null;
    const selected = (path, raw) => {
      if (kind === 'intent') return path.includes('/.fn004-intent.json.tmp-') || path.endsWith('/intent.json');
      try { return JSON.parse(raw).kind === 'fn004-journal' && JSON.parse(raw).payload.phase === 'PREPARED'; }
      catch { return false; }
    };
    const io = { ...fs, open: async (path, ...args) => {
      const handle = await fs.open(path, ...args);
      return { writeFile: async raw => {
        if (!injected && fault === 'partial_write' && selected(path, raw)) {
          injected = true; await handle.writeFile(raw.subarray(0, 9)); throw Object.assign(new Error('partial'), { code: 'EIO' });
        }
        return handle.writeFile(raw);
      }, sync: async () => {
        if (!injected && fault === 'directory_sync' && selectedFinal && path === selectedFinal.slice(0, selectedFinal.lastIndexOf('/'))) {
          injected = true; throw Object.assign(new Error('directory sync'), { code: 'EIO' });
        }
        return handle.sync();
      }, close: () => handle.close() };
    }, link: async (from, to) => {
      if (selected(to, await fs.readFile(from))) {
        if (!injected && fault === 'publish') { injected = true; throw Object.assign(new Error('link'), { code: 'EIO' }); }
        selectedFinal = to;
      }
      return fs.link(from, to);
    } };
    await assert.rejects((await createTransactionPreparer(f.root, { io })).prepare({ gate: f.gate, binding: f.binding, apply_time: f.apply_time }),
      error => error.code === 'PERSISTENCE_WRITE_FAILED' && error.phase ===
        ({ partial_write: 'temp_write', publish: 'publish', directory_sync: 'directory_sync' })[fault] &&
        error.published === (fault === 'directory_sync'));
    assert.equal(injected, true); assert.deepEqual(await f.protectedHashes(), f.before);
    await assert.rejects(fs.stat(join(f.root, 'staging/apply-history')), { code: 'ENOENT' });
    if (fault === 'partial_write') await assert.rejects(observe(f.root, f.binding), { code: 'PERSISTENCE_PARSE_FAILED' });
    else {
      const result = await observe(f.root, f.binding);
      assert.deepEqual(result.allowed_actions, fault === 'directory_sync' ? ['abort'] : []);
      assert.equal(result.classification, fault === 'directory_sync' ? 'abortable' : 'manual_stop');
      assert.equal(result.readiness, 'recovery_required');
    }
  });
}

for (const boundary of ['intent:after', 'prepared:after']) {
  test(`R78-M01: SIGKILL at ${boundary} retains the original gate and restart evidence`, { timeout: 60000 }, async t => {
    const child = fork(new URL('./fixtures/prepare-crash-child.js', import.meta.url), ['--prepare-crash-child', boundary],
      { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let root, stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (root) await fs.rm(root, { recursive: true, force: true }); });
    const reached = await new Promise((resolve, reject) => {
      child.on('message', message => { if (message.root) root = message.root;
        if (message.type === 'boundary') resolve(message); if (message.type === 'error') reject(new Error(message.message)); });
      child.once('exit', (code, signal) => reject(new Error(`Child exited before boundary: ${code}/${signal}: ${stderr}`)));
    });
    assert.equal(reached.boundary, boundary);
    const exited = once(child, 'exit'); child.kill('SIGKILL');
    assert.deepEqual(await exited, [null, 'SIGKILL']);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    for (const [path, hash] of Object.entries(reached.before)) assert.equal(sha256(await fs.readFile(join(root, path))), hash);
    assert.equal(JSON.parse(await fs.readFile(join(root, 'staging/.fn004.lock'))).process_id, child.pid);
    await assert.rejects(fs.stat(join(root, 'staging/apply-history')), { code: 'ENOENT' });
    const first = await observe(root, reached.binding), second = await observe(root, reached.binding);
    assert.deepEqual(first, second); assert.deepEqual(first.allowed_actions, ['abort']);
    const d = await discoverEvidence(root), journals = Object.values(d.documents).filter(value => value.kind === 'fn004-journal');
    assert.ok(d.documents[`staging/transactions/${reached.binding.transaction_id}/intent.json`]);
    assert.equal(journals.at(-1).payload.intent_hash === null, boundary === 'intent:after');
    assert.equal(journals.at(-1).payload.phase === 'PREPARED', boundary === 'prepared:after');
  });
}

for (const ioCode of ['EIO', 'ENOENT']) {
  test(`R78-M02: final backup readback ${ioCode} preserves typed failure and publication evidence`, async t => {
    const f = await prepareFixture(t), cause = Object.assign(new Error('readback fault'), { code: ioCode });
    let linked = false, injected = false;
    const io = { ...fs, link: async (from, to) => {
      await fs.link(from, to); if (to.endsWith('/backup/data/works.csv')) linked = true;
    }, readFile: async (path, ...args) => {
      if (linked && !injected && path.endsWith('/backup/data/works.csv')) { injected = true; throw cause; }
      return fs.readFile(path, ...args);
    } };
    await assert.rejects((await createTransactionPreparer(f.root, { io })).prepare({ gate: f.gate, binding: f.binding, apply_time: f.apply_time }),
      error => error.code === (ioCode === 'ENOENT' ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_READ_FAILED') &&
        error.path.endsWith('/backup/data/works.csv') && error.phase === null && error.published === true && error.cause === cause);
    assert.equal(injected, true); assert.deepEqual(await f.protectedHashes(), f.before);
    assert.deepEqual((await observe(f.root, f.binding)).allowed_actions, ['abort']);
    const d = await discoverEvidence(f.root);
    assert.equal(Object.values(d.documents).some(value => value.kind === 'fn004-journal' && value.payload.phase === 'PREPARED'), false);
  });
}

test('R78-M02: prepare filesystem metadata read preserves typed errno without guessing publication', async t => {
  const f = await prepareFixture(t), cause = Object.assign(new Error('stat fault'), { code: 'EIO' }); let injected = false;
  const io = { ...fs, stat: async (path, ...args) => {
    if (path.endsWith('/backup/data')) { injected = true; throw cause; }
    return fs.stat(path, ...args);
  } };
  await assert.rejects((await createTransactionPreparer(f.root, { io })).prepare({ gate: f.gate, binding: f.binding, apply_time: f.apply_time }),
    error => error.code === 'PERSISTENCE_READ_FAILED' && error.phase === null && error.published === null && error.cause === cause);
  assert.equal(injected, true); assert.deepEqual(await f.protectedHashes(), f.before);
  assert.deepEqual((await observe(f.root, f.binding)).allowed_actions, ['abort']);
});

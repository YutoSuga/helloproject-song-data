import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireGate, releaseGate } from '../src/fn004-gate.js';
import { createEvidencePublisher, evidencePath } from '../src/fn004-evidence-persistence.js';
import { discoverEvidence, discoverJournal } from '../src/fn004-evidence-discovery.js';
import { collectRecoverySnapshot } from '../src/fn004-recovery-collection.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
import { canonicalJson, sha256 } from '../src/canonical-hash.js';
import { transactionFixture, recoveryDiscovery, exitedProbe, bytes, rehash, uuid } from './fixtures/transaction-evidence.js';

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-evidence-'));
  const gate = await acquireGate({ root, operation: 'apply' });
  t.after(async () => { try { await releaseGate(gate); } finally { await fs.rm(root, { recursive: true, force: true }); } });
  const raw = await fs.readFile(join(root, 'staging/.fn004.lock')), stat = await fs.stat(join(root, 'staging/.fn004.lock'), { bigint: true });
  const witness = { metadata: JSON.parse(raw), byte_length: raw.length, sha256: sha256(raw), device: stat.dev.toString(), inode: stat.ino.toString() };
  const f = transactionFixture({ gate: witness });
  return { root, gate, f };
}

test('immutable evidence publisher uses the live gate and no-clobber persistence, never arbitrary paths', async t => {
  const { root, gate, f } = await fixture(t), publisher = await createEvidencePublisher(root);
  await assert.rejects(publisher.publish(f.owner, { gate: { ...gate }, context: { inputs: f.inputs } }), { code: 'GATE_OWNERSHIP_MISMATCH' });
  const options = { gate, context: { inputs: f.inputs } };
  assert.deepEqual(await publisher.publish(f.owner, options), f.owner);
  const path = join(root, evidencePath(f.owner)), before = await fs.stat(path, { bigint: true });
  assert.deepEqual(await publisher.publish(f.owner, options), f.owner);
  assert.equal((await fs.stat(path, { bigint: true })).ino, before.ino);
  const changed = structuredClone(f.owner); changed.payload.gate.metadata.operation = 'other';
  changed.payload.gate.byte_length = bytes(changed.payload.gate.metadata).length;
  changed.payload.gate.sha256 = sha256(bytes(changed.payload.gate.metadata)); rehash(changed);
  await assert.rejects(publisher.publish(changed, options), { code: 'INTEGRITY_CONFLICT' });
  assert.deepEqual(JSON.parse(await fs.readFile(path)), f.owner);
  await assert.rejects(publisher.publish({ kind: 'fn004-state', payload: {} }, options), { code: 'INTEGRITY_CONFLICT' });
  await assert.rejects(fs.stat(join(root, 'data')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(join(root, 'staging/fn004-state.json')), { code: 'ENOENT' });
});

test('publisher preserves partial/corrupt existing evidence and directory-sync failure details', async t => {
  const { root, gate, f } = await fixture(t), path = evidencePath(f.owner);
  await fs.mkdir(join(root, path.slice(0, path.lastIndexOf('/'))), { recursive: true });
  await fs.writeFile(join(root, path), '{');
  const publisher = await createEvidencePublisher(root);
  await assert.rejects(publisher.publish(f.owner, { gate, context: { inputs: f.inputs } }), { code: 'PERSISTENCE_PARSE_FAILED' });
  assert.equal(await fs.readFile(join(root, path), 'utf8'), '{');
  await fs.writeFile(join(root, path), bytes(f.owner));
  const failing = await createEvidencePublisher(root, { io: { ...fs, open: async (path, ...args) => {
    const handle = await fs.open(path, ...args);
    if (path === join(root, `staging/transactions/${f.binding.transaction_id}`)) {
      return { sync: async () => { throw Object.assign(new Error('injected directory sync'), { code: 'EIO' }); }, close: () => handle.close() };
    }
    return handle;
  } } });
  await assert.rejects(failing.publish(f.owner, { gate, context: { inputs: f.inputs } }), error => {
    assert.equal(error.code, 'PERSISTENCE_SYNC_FAILED'); assert.equal(error.phase, 'directory_sync');
    assert.equal(error.published, true); assert.equal(error.cause.cause.code, 'EIO'); return true;
  });
  assert.deepEqual(await publisher.publish(f.owner, { gate, context: { inputs: f.inputs } }), f.owner);
});

test('publication fault seam distinguishes complete unpublished temp from published immutable evidence', async t => {
  const { root, gate, f } = await fixture(t);
  const publisher = await createEvidencePublisher(root, { io: { ...fs, link: async () => {
    throw Object.assign(new Error('injected before publication'), { code: 'EIO' });
  } } });
  let failure;
  await assert.rejects(publisher.publish(f.owner, { gate, context: { inputs: f.inputs } }), error => {
    failure = error; return error.code === 'PERSISTENCE_WRITE_FAILED' && error.phase === 'publish' && error.published === false;
  });
  await assert.rejects(fs.stat(join(root, evidencePath(f.owner))), { code: 'ENOENT' });
  assert.equal(await fs.readFile(join(root, failure.temp), 'utf8'), canonicalJson(f.owner) + '\n');
  assert.deepEqual(await (await createEvidencePublisher(root)).publish(f.owner, { gate, context: { inputs: f.inputs } }), f.owner);
  // A caught throw keeps its full evidence. No sweep/rollback is hidden in the foundation.
  assert.equal(await fs.readFile(join(root, failure.temp), 'utf8'), canonicalJson(f.owner) + '\n');
});

test('readonly discovery sorts files, retains unknown entries/symlinks, and rejects invalid JSON rather than skipping it', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, 'staging')); await fs.writeFile(join(root, 'staging/z.txt'), 'unknown');
  await fs.symlink('/not-read', join(root, 'staging/link'));
  const d = await discoverEvidence(root);
  assert.deepEqual(d.files.map(f => f.path), d.files.map(f => f.path).sort());
  assert.equal(d.files.find(f => f.path === 'staging/link').kind, 'symlink');
  assert.equal(d.rawBytes['staging/z.txt'].toString(), 'unknown');
  for (const [text, code] of [['{', 'PERSISTENCE_PARSE_FAILED'], ['null', 'PERSISTENCE_ROOT_TYPE'],
    ['{"a":1,"a":2}', 'PERSISTENCE_PARSE_FAILED'], ['[]', 'PERSISTENCE_ROOT_TYPE']]) {
    await fs.writeFile(join(root, 'staging/bad.json'), text);
    await assert.rejects(discoverEvidence(root), { code });
  }
  await assert.rejects(discoverJournal(root, `tx_${uuid}\n`), { code: 'INTEGRITY_CONFLICT' });
});

test('two-pass collection refuses evidence/physical-owner races; unchanged collection is deterministic', async () => {
  const f = transactionFixture();
  const collect = async (change = false, physical = false) => {
    let pass = 0;
    return classifyRecoverySnapshot(await collectRecoverySnapshot('/fixture', f.binding, {
      discover: async () => {
        const d = recoveryDiscovery(f, { intent: change && pass > 0 ? f.intent : null });
        if (physical && pass > 0) d.identities['staging/.fn004.lock'].inode = '99';
        pass++; return d;
      }, audit: async () => f.git_audit, probeOwner: async owner => exitedProbe(owner)
    }));
  };
  assert.deepEqual((await collect()).allowed_actions, ['abort']);
  for (const r of [await collect(true), await collect(false, true)]) {
    assert.deepEqual(r.allowed_actions, []); assert.equal(r.evidence.consistency, 'raced');
  }
});

import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { assertGateOwnership } from './fn004-gate.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { validateOwner, transactionPaths, allocationRanges } from './fn004-transaction-evidence.js';
import { prepareRecoverySnapshot, recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { auditGitIds, inspectGitIdentity } from './fn004-git-audit.js';
import { materializeCanonicalTarget } from './fn004-target-materialization.js';
import { deriveConsumedState } from './fn004-state.js';
import { receiptHashProjectionV1 } from './fn004-approval-schema.js';
import { canonicalJson, sha256 } from './canonical-hash.js';
import { parseStrictJson } from './strict-json.js';
import { check, same } from './fn004-evidence-types.js';

const jsonBytes = value => Buffer.from(canonicalJson(value) + '\n');
export const prepareArtifactRef = (path, raw) => ({ path, byte_length: raw.length, sha256: sha256(raw) });

// Trusted internal foundation, not an executor/Request entrypoint. Only the
// original live lease can publish. Expected bytes are derived internally from
// immutable inputs; callers cannot supply arbitrary write paths or file bytes.
export async function createPrepareArtifactPublisher(root, source, { io = fs } = {}) {
  const store = await createPersistence(root, { io });
  const { gate, apply_time } = source;
  const owner = JSON.parse(canonicalJson(source.owner)), inputs = JSON.parse(canonicalJson(source.inputs));
  validateOwner(owner, inputs);
  const b = owner.payload.binding, paths = transactionPaths(b), stateBytes = Buffer.from(source.state_bytes);
  check(same(parseStrictJson(stateBytes), owner.payload.before_state), 'Original state backup is not the bound before state');
  const audit = await auditGitIds(store.root);
  async function guard() {
    await assertGateOwnership(gate, store.root);
    const identity = await inspectGitIdentity(store.root);
    check(identity.head === audit.git.audited_head && identity.format === audit.git.object_format,
      'Authoritative Git history changed during preparation');
    const d = await discoverEvidence(store.root, { io });
    const s = recoverySnapshotData(await prepareRecoverySnapshot({ binding: b, discovery: d, git_audit: audit, probe: null }));
    check(s.diagnostics.length === 0 && s.base.evidence.input_revalidation === 'valid', 'Prepare evidence is not fully verified');
    check(same(s.owner, owner) && same(s.state, owner.payload.before_state) &&
      same(s.canonical_manifest, owner.payload.original_manifest) && same(s.gate, owner.payload.gate),
      'Prepare requires the bound Owner, gate and original canonical/state');
    check(d.rawBytes['staging/fn004-state.json'].equals(stateBytes), 'State backup bytes differ from captured original');
    const request = d.documents[`staging/apply-requests/${b.request_id}.json`];
    check(same(receiptHashProjectionV1(request), inputs.request) && same(d.documents[`staging/apply-plans/${b.plan_id}.json`], inputs.plan) &&
      same(d.documents[`staging/apply-approvals/${b.approval_id}.json`], inputs.approval) &&
      d.documents['staging/decisions.json']?.revisions?.some(value => same(value, inputs.decision)), 'Original prepare inputs changed');
    check(!s.archive && !s.barrier && !s.proof && !s.proof_intent && !s.completion && !s.intent &&
      s.chain?.head?.payload.phase === 'PREPARING' && s.chain.entries[0].payload.apply_time === apply_time &&
      s.chain.entries.every(entry => entry.payload.authority.recovery === null),
      'Raw preparation requires initial PREPARING before Intent and retirement');
    return d;
  }
  await guard(); // apply_time is already durable before materialization.
  const materialized = await materializeCanonicalTarget({ owner, inputs, original: source.original, apply_time });
  const expected = new Map();
  for (const [path, raw] of Object.entries(materialized.original.rawBytes)) expected.set(`${paths.root}/backup/${path}`, raw);
  expected.set(`${paths.root}/backup/fn004-state.json`, stateBytes);
  for (const [key, path] of Object.entries(paths.inputs)) expected.set(path, jsonBytes(inputs[key]));
  for (const path of materialized.changed_paths) expected.set(`${paths.root}/temp/${path}`, materialized.target.rawBytes[path]);
  const refs = [...expected].map(([path, raw]) => prepareArtifactRef(path, raw));
  const ranges = allocationRanges(inputs.plan, owner.payload.before_state, b.transaction_id);
  const intentPayload = { binding: b, owner_hash: owner.hash, apply_time,
    original_manifest: owner.payload.original_manifest, target_manifest: materialized.target.manifest,
    before_state: owner.payload.before_state,
    expected_consumed_state: deriveConsumedState(owner.payload.before_state, b.transaction_id, ranges), allocation_ranges: ranges,
    changed_paths: materialized.changed_paths,
    backup_refs: refs.filter(ref => ref.path.startsWith(`${paths.root}/backup/`)).sort((a, b) => a.path < b.path ? -1 : 1),
    temp_refs: refs.filter(ref => ref.path.startsWith(`${paths.root}/temp/`)).sort((a, b) => a.path < b.path ? -1 : 1),
    inputs: Object.fromEntries(Object.entries(paths.inputs).map(([key, path]) => [key, refs.find(ref => ref.path === path)])) };
  async function publish(path) {
    check(expected.has(path), 'Write path is outside this prepared transaction');
    await guard();
    const raw = expected.get(path);
    const absolute = await store.resolvePath(path);
    const parent = path.slice(0, path.lastIndexOf('/'));
    await store.ensureDirectory(parent);
    const device = (await io.stat(await store.resolvePath('data'), { bigint: true })).dev.toString();
    check((await io.stat(await store.resolvePath(parent), { bigint: true })).dev.toString() === device, 'Prepare artifacts cross filesystem boundary');
    if (await store.exists(path)) {
      const existing = await io.readFile(absolute);
      check(existing.equals(raw), 'Immutable prepare artifact differs from bound source');
      let handle, phase = 'file_sync';
      try {
        handle = await io.open(absolute, 'r'); await handle.sync(); await handle.close(); handle = null;
        phase = 'directory_sync'; await store.syncDirectory(parent);
      } catch (cause) {
        if (handle) { try { await handle.close(); } catch { /* preserve original failure */ } }
        throw new RepositoryError('PERSISTENCE_SYNC_FAILED', 'Prepare artifact durability unconfirmed', { path, phase, published: true, cause });
      }
    } else await store.createBytesExclusive(path, raw);
    check((await io.readFile(absolute)).equals(raw), 'Prepare artifact readback differs');
    await guard();
    return prepareArtifactRef(path, raw);
  }
  return Object.freeze({ publish, paths: Object.freeze([...expected.keys()]),
    bytes: path => { check(expected.has(path), 'Unknown prepare artifact'); return Buffer.from(expected.get(path)); },
    intentPayload: () => structuredClone(intentPayload),
    original: () => ({ ...structuredClone(materialized.original), rawBytes: Object.fromEntries(Object.entries(materialized.original.rawBytes).map(([p, raw]) => [p, Buffer.from(raw)])) }) });
}

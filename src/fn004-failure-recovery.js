import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { acquireRecoveryAuthority, refreshRecoveryAuthority, recoverySessionDetails, revokeRecoveryAuthority,
  recoveryEnvelope } from './fn004-recovery-authority.js';
import { adoptRecoveryGate, assertGateOwnership, releaseGate, closeRetainedGate } from './fn004-gate.js';
import { collectRecoverySnapshot } from './fn004-recovery-collection.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { createEvidencePublisher, evidencePath } from './fn004-evidence-persistence.js';
import { terminalStateForEntry } from './fn004-journal-chain.js';
import { publisherTarget } from './fn004-evidence-namespace.js';
import { canonicalJson } from './canonical-hash.js';
import { failureProof, failureCompletion, retiringEvidence, retiredEvidence } from './fn004-failure-terminal.js';
import { probeRecoveryOwner } from './fn004-recovery-process.js';
import { auditGitIds } from './fn004-git-audit.js';
import { same, check } from './fn004-evidence-types.js';
import { RECOVERY_CODES, PERSISTENCE_PHASES } from './fn004-evidence-errors.js';
import { confirmExistingBytes } from './fn004-recovery-durability.js';

const rawJson = value => Buffer.from(canonicalJson(value) + '\n');
function nativeIoCode(error) {
  let cause = error.cause;
  const seen = new Set();
  while (cause instanceof RepositoryError && !seen.has(cause)) { seen.add(cause); cause = cause.cause; }
  return !(cause instanceof RepositoryError) && typeof cause?.code === 'string' ? cause.code : null;
}
async function durableUnlink(store, io, path) {
  let published = null, phase = 'publish';
  try {
    await io.unlink(await store.resolvePath(path)); published = true; phase = 'directory_sync';
    await store.syncDirectory(path.slice(0, path.lastIndexOf('/')));
  } catch (cause) {
    if (phase === 'publish') {
      try { published = !await store.exists(path); }
      catch { /* An unreadable outcome remains unknown, never unpublished. */ }
    }
    throw new RepositoryError(phase === 'directory_sync' ? 'PERSISTENCE_SYNC_FAILED' : 'PERSISTENCE_WRITE_FAILED',
      'Evidence removal did not establish durability', { path, phase, published, cause });
  }
}

// Failure-side internal application service only. Not connected to Request
// dispatch, public CLI, normal commit, ID consumption or success finalization.
export async function createFailureRecoveryService(root, { io = fs, audit = auditGitIds,
  probeOwner = probeRecoveryOwner, clock = () => new Date().toISOString(), onBoundary = async () => {} } = {}) {
  const store = await createPersistence(root, { io });
  const options = { io, audit, probeOwner, clock, onBoundary };
  async function inspect(binding) {
    binding = JSON.parse(canonicalJson(binding));
    return classifyRecoverySnapshot(await collectRecoverySnapshot(store.root, binding,
      { discover: async r => (await import('./fn004-evidence-discovery.js')).discoverEvidence(r, { io }), audit, probeOwner }));
  }
  return Object.freeze({ inspect, run: async ({ binding, command }) => {
    binding = JSON.parse(canonicalJson(binding)); command = JSON.parse(canonicalJson(command));
    const authority = await acquireRecoveryAuthority(store.root, binding, command, options);
    const session = recoverySessionDetails(authority), gate = await adoptRecoveryGate(authority);
    try {
    let snap = await refreshRecoveryAuthority(authority), s = recoverySnapshotData(snap);
    const decision = classifyRecoverySnapshot(snap);
    if (decision.allowed_actions[0] !== command.action) throw new RepositoryError('RECOVERY_REQUIRED', 'Action changed after ownership acquisition');
    check(!s.chain.decision && s.proof?.payload.phase !== 'COMPLETED', 'Success-side Recovery belongs to Slice 6D');
    const txRoot = `staging/transactions/${binding.transaction_id}`;
    const inputs = s.proof?.payload.inputs ?? {
      decision: session.discovery.documents['staging/decisions.json'].revisions.find(value => same(binding.decision,
        { decision_id: value.decision_id, revision: value.revision, content_hash: value.content_hash })),
      plan: session.discovery.documents[`staging/apply-plans/${binding.plan_id}.json`],
      approval: session.discovery.documents[`staging/apply-approvals/${binding.approval_id}.json`],
      request: { schema_version: 1, receipt: session.discovery.documents[`staging/apply-requests/${binding.request_id}.json`].receipt } };
    const owner = s.owner, intent = s.intent;
    const publisher = await createEvidencePublisher(store.root, { io });
    let ledger = session.discovery;
    const unchanged = (value, message) => { if (!value) throw new RepositoryError('RECOVERY_REQUIRED', message); };
    function compare(next, changes = new Map()) {
      const before = new Map(ledger.files.filter(f => f.kind !== 'missing').map(f => [f.path, f]));
      const actual = new Map(next.files.filter(f => f.kind !== 'missing').map(f => [f.path, f]));
      const dirs = new Set();
      for (const path of changes.keys()) {
        let dir = path.slice(0, path.lastIndexOf('/'));
        while (dir) { dirs.add(dir); dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''; }
      }
      for (const path of new Set([...before.keys(), ...actual.keys()])) {
        if (/^staging\/transactions\/tx_[0-9a-f-]{36}\/transaction\.json$/.test(path)) continue;
        if (/^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(path)) {
          unchanged(same(ledger.documents[path]?.receipt, next.documents[path]?.receipt) &&
            ledger.documents[path]?.receipt_hash === next.documents[path]?.receipt_hash, 'Immutable Receipt changed');
          continue;
        }
        if (changes.has(path)) {
          const raw = changes.get(path);
          check(raw === null ? !actual.has(path) : actual.get(path)?.kind === 'file' && next.rawBytes[path]?.equals(raw), 'Owned publication differs from expected bytes');
        } else if (before.has(path)) unchanged(same(before.get(path), actual.get(path)), 'Evidence changed outside owned operation');
        else unchanged(actual.get(path)?.kind === 'directory' && dirs.has(path), 'Unexpected evidence added during Recovery');
      }
    }
    async function refresh(changes = new Map()) {
      snap = await refreshRecoveryAuthority(authority); const discovery = session.discovery;
      compare(discovery, changes); ledger = discovery;
      s = recoverySnapshotData(snap); return s;
    }
    async function guard(action = null) {
      await assertGateOwnership(gate, store.root); await refresh();
      const current = classifyRecoverySnapshot(snap);
      if (action) check(current.allowed_actions[0] === action, 'Recovery action is no longer eligible');
      else check(current.allowed_actions.length === 1 ||
        ['RETIRING', 'RETIRED'].includes(s.archive.state) && s.proof && s.completion &&
        current.classification === 'active' && current.readiness === 'cleanup_required',
      'Fresh evidence no longer proves owned continuation');
      return s;
    }
    async function effect(phase, changes, fn, action = null) {
      const path = [...changes.keys()].find(path => path.startsWith('data/')) ?? changes.keys().next().value;
      await guard(action); await onBoundary({ phase: `${phase}:before`, path }); await guard(action);
      await fn(); await refresh(changes);
      await onBoundary({ phase: `${phase}:after`, path }); await guard();
    }
    async function publish(value, phase) {
      const context = { owner, inputs, intent, prefix: s.chain.entries, proof: s.proof,
        histories: s.histories };
      await effect(phase, new Map([[evidencePath(value), rawJson(value)]]), () => publisher.publish(value, { gate, context }));
    }
    const authorityPayload = () => ({ gate: owner.payload.gate,
      recovery: { anchor: session.anchor, claims: s.archive.chain } });
    async function journal(changes) {
      const previous = s.chain.head;
      check(previous, 'Receipt-only abort does not invent a journal');
      const p = { ...structuredClone(previous.payload), ...changes, authority: authorityPayload(),
        sequence: previous.payload.sequence + 1, previous_entry_hash: previous.hash, recorded_at: clock(), error: null };
      if (intent) Object.assign(p, { intent_hash: intent.hash, target_manifest: intent.payload.target_manifest,
        changed_paths: intent.payload.changed_paths, backup_refs: intent.payload.backup_refs, temp_refs: intent.payload.temp_refs });
      await publish(recoveryEnvelope('fn004-journal', p), 'journal');
    }
    try {
    if (intent && s.chain.head?.payload.intent_hash === null) {
      // A complete Intent may precede its journal binding. Confirm the exact
      // existing bytes and directory durability before referring to H.
      await effect('intent_confirm', new Map([[evidencePath(intent), rawJson(intent)]]),
        () => publisher.publish(intent, { gate, context: { owner, inputs } }), 'abort');
    }
    if (command.action === 'abort') {
      await guard('abort');
      if (s.chain.head?.payload.phase === 'RECOVERY_REQUIRED') await journal({ phase: s.chain.head.payload.resume_phase, resume_phase: null });
      if (s.chain.head) await journal({ phase: 'ABORTED', terminal_state: owner.payload.before_state });
    } else if (command.action === 'rollback') {
      await guard('rollback');
      if (s.chain.head.payload.phase === 'RECOVERY_REQUIRED') await journal({ phase: s.chain.head.payload.resume_phase, resume_phase: null });
      if (s.chain.head.payload.phase === 'COMMITTING') {
        const consumed = same(s.state, intent.payload.expected_consumed_state);
        const replaced = s.provenance.target_paths;
        if (s.chain.head.payload.id_consumed !== consumed || !same(s.chain.head.payload.replaced_paths, replaced)) {
          await journal({ id_consumed: consumed, replaced_paths: replaced });
        }
        await journal({ phase: 'ROLLING_BACK' });
      }
      for (const path of [...intent.payload.changed_paths].reverse()) {
        await guard('rollback');
        const current = ledger.rawBytes[path], backup = ledger.rawBytes[`${txRoot}/backup/${path}`];
        check(backup, 'Required original backup is missing');
        if (current.equals(backup)) continue;
        check(s.provenance.target_paths.includes(path), 'Restore requires a known target-only file');
        const restorePath = `${txRoot}/restore/${path}`;
        if (!ledger.rawBytes[restorePath]) await effect('restore_prepare', new Map([[restorePath, backup]]),
          () => store.createBytesExclusive(restorePath, backup), 'rollback');
        else {
          check(ledger.rawBytes[restorePath].equals(backup), 'Existing restore artifact conflicts');
          await effect('restore_confirm', new Map([[restorePath, backup]]),
            () => confirmExistingBytes(store, io, restorePath, backup), 'rollback');
        }
        await effect('restore', new Map([[restorePath, null], [path, backup]]), async () => {
          let phase = 'publish', published = null;
          try {
            await io.rename(await store.resolvePath(restorePath), await store.resolvePath(path)); published = true;
            phase = 'directory_sync'; await store.syncDirectory('data');
            await store.syncDirectory(`${txRoot}/restore/data`);
            phase = null;
            const raw = await io.readFile(await store.resolvePath(path));
            check(raw.equals(backup), 'Restored destination readback differs');
          } catch (cause) {
            if (phase === 'publish' && published === null) {
              // A syscall/adapter error may follow the rename itself. Observe
              // both paths rather than claiming that publication did not occur.
              try {
                const destination = await io.readFile(await store.resolvePath(path));
                let source = null;
                try { source = await io.readFile(await store.resolvePath(restorePath)); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
                if (destination.equals(backup) && source === null) published = true;
                else if (destination.equals(current) && source?.equals(backup)) published = false;
              } catch { /* unresolved publication remains null; keep original cause */ }
            }
            if (cause instanceof RepositoryError && ['INTEGRITY_CONFLICT', 'PATH_UNSAFE'].includes(cause.code)) {
              Object.assign(cause, { path, phase, published }); throw cause;
            }
            const code = phase === null ? cause.code === 'ENOENT' ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_READ_FAILED' :
              phase === 'directory_sync' ? 'PERSISTENCE_SYNC_FAILED' : 'PERSISTENCE_WRITE_FAILED';
            throw new RepositoryError(code,
              'Rollback replacement did not establish durability', { cause, path, phase, published });
          }
        }, 'rollback');
        await journal({ restored_paths: [...s.chain.head.payload.restored_paths, path] });
      }
      // A previous rename may have reached its destination while directory
      // sync failed. All-Original readback proves bytes, not their durability.
      // Reconfirm the existing original files before publishing terminal state.
      const originals = new Map(owner.payload.original_manifest.files.map(file =>
        [file.path, ledger.rawBytes[`${txRoot}/backup/${file.path}`]]));
      await effect('rollback_confirm', originals, async () => {
        for (const [path, raw] of originals) await confirmExistingBytes(store, io, path, raw);
        const directory = `${txRoot}/restore/data`;
        if (await store.exists(directory)) {
          try { await store.syncDirectory(directory); }
          catch (cause) { throw new RepositoryError('PERSISTENCE_SYNC_FAILED', 'Restore source directory durability is unconfirmed',
            { cause, path: directory, phase: 'directory_sync', published: true }); }
        }
      }, 'rollback');
      await onBoundary({ phase: 'rollback_validation:before' }); await guard('rollback');
      check(s.provenance.all_original && s.semantic_codes.length === 0 && same(s.canonical_manifest, owner.payload.original_manifest),
        'Rollback requires exact all-original and full semantic validation');
      await onBoundary({ phase: 'rollback_validation:after' }); await guard('rollback');
      const after = terminalStateForEntry({ ...s.chain.head.payload, phase: 'ROLLED_BACK' });
      if (!same(s.state, after)) await effect('failure_state', new Map([['staging/fn004-state.json', rawJson(after)]]),
        () => store.writeJsonAtomic('staging/fn004-state.json', after), 'rollback');
      await journal({ phase: 'ROLLED_BACK', terminal_state: after });
    }
    if (command.action !== 'cleanup') {
      await guard();
      if (!s.proof) {
        const value = s.proof_intent ?? failureProof({ binding, owner, inputs, intent, chain: s.chain,
          authority: authorityPayload(), ended_at: s.chain.head?.payload.recorded_at ?? clock(), histories: s.histories });
        await publish(value, 'proof');
      }
    }
    await effect('proof_confirm', new Map([[evidencePath(s.proof), ledger.rawBytes[evidencePath(s.proof)]]]),
      () => publisher.publish(s.proof, { gate, context: { histories: s.histories } }));
    if (!s.completion) await publish(failureCompletion(s.proof), 'completion');
    await effect('completion_confirm', new Map([[evidencePath(s.completion), ledger.rawBytes[evidencePath(s.completion)]]]),
      () => publisher.publish(s.completion, { gate, context: { proof: s.proof } }));
    // Shared failure-side terminal epilogue. Nothing before exact Proof and
    // Completion may clean up original evidence or begin retirement.
    await guard(); check(s.proof && s.completion && s.proof.payload.phase !== 'COMPLETED', 'Failure terminalization is incomplete');
    for (const file of [...ledger.files]) {
      if (file.kind !== 'file' || !(file.path.startsWith(`${txRoot}/backup/`) || file.path.startsWith(`${txRoot}/temp/`) ||
        file.path.startsWith(`${txRoot}/restore/`) || publisherTarget(file.path))) continue;
      await effect('cleanup', new Map([[file.path, null]]), async () => {
        await durableUnlink(store, io, file.path);
      });
    }
    await guard();
    const barrierPath = 'staging/.fn004-recovery.lock', barrierRaw = ledger.rawBytes[barrierPath];
    const archiveContext = () => ({ anchor: session.anchor, claims: s.archive.chain,
      retirements: Object.entries(ledger.documents).filter(([p]) => p.startsWith(`staging/recovery-ownership/${binding.transaction_id}/retirements/`) && !publisherTarget(p)).map(([,v]) => v), barrier: session.barrier });
    const retiring = retiringEvidence({ binding, session, snapshot: s, barrierRaw, archive: archiveContext(), at: clock() });
    await effect('retiring', new Map([[evidencePath(retiring), rawJson(retiring)]]), () => store.createJsonExclusive(evidencePath(retiring), retiring));
    await onBoundary({ phase: 'gate_release:before' }); await refresh();
    await releaseGate(gate);
    await refresh(new Map([['staging/.fn004.lock', null]]));
    await onBoundary({ phase: 'gate_release:after' }); await refresh();
    const retired = retiredEvidence({ binding, session, retiring, snapshot: s, archive: archiveContext(), at: clock() });
    await onBoundary({ phase: 'retired:before' }); await refresh();
    await store.createJsonExclusive(evidencePath(retired), retired);
    await refresh(new Map([[evidencePath(retired), rawJson(retired)]]));
    await onBoundary({ phase: 'retired:after' }); await refresh();
    check(s.archive.state === 'RETIRED' && s.gate === null, 'Retirement release conditions changed');
    await durableUnlink(store, io, barrierPath); revokeRecoveryAuthority(authority);
    const observation = await inspect(binding);
    return { schema_version: 2, request_id: binding.request_id, transaction_id: binding.transaction_id, action: command.action,
      outcome: command.action === 'abort' ? 'aborted' : command.action === 'rollback' ? 'rolled_back' : command.action === 'cleanup' ? 'cleaned' : s.proof.payload.phase === 'ABORTED' ? 'aborted' : 'rolled_back', observation };
    } catch (error) {
      // Record a recoverable IO failure only when fresh complete evidence still
      // proves the same nonterminal policy. Partial/unknown publication is never
      // skipped to append to an older prefix. Preserve the original throw.
      if (error instanceof RepositoryError && /^PERSISTENCE_/.test(error.code) && RECOVERY_CODES.includes(error.code)) {
        try {
          const current = await refreshRecoveryAuthority(authority), data = recoverySnapshotData(current);
          const head = data.chain?.head;
          if (head && ['abort', 'rollback'].includes(classifyRecoverySnapshot(current).allowed_actions[0])) {
            const value = recoveryEnvelope('fn004-journal', { ...structuredClone(head.payload), phase: 'RECOVERY_REQUIRED',
              resume_phase: head.payload.resume_phase ?? head.payload.phase, sequence: head.payload.sequence + 1,
              previous_entry_hash: head.hash, recorded_at: clock(), authority: { gate: owner.payload.gate,
                recovery: { anchor: session.anchor, claims: data.archive.chain } },
              error: { code: error.code, operation: command.action === 'rollback' ? 'rollback' : 'recover', path: error.path ?? null,
                persistence_phase: PERSISTENCE_PHASES.includes(error.phase) ? error.phase : null,
                published: typeof error.published === 'boolean' ? error.published : null, io_code: nativeIoCode(error) } });
            await publisher.publish(value, { gate, context: { owner, inputs, intent, prefix: data.chain.entries } });
          }
        } catch (recordError) { error.recovery_record_error = recordError; }
      }
      throw error;
    }
    } catch (error) {
      try { await closeRetainedGate(gate); }
      catch (closeError) { if (error && typeof error === 'object') error.retained_gate_close_error = closeError; }
      if (session.active) revokeRecoveryAuthority(authority);
      throw error;
    }
  } });
}

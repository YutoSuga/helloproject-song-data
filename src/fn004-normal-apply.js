import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { assertGateOwnership, closeRetainedGate } from './fn004-gate.js';
import { discoverEvidence } from './fn004-evidence-discovery.js';
import { createEvidencePublisher, evidencePath } from './fn004-evidence-persistence.js';
import { recoveryEnvelope } from './fn004-recovery-authority.js';
import { originalApplyAuthority } from './fn004-original-authority.js';
import { recoverySnapshotData } from './fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from './fn004-recovery-classifier.js';
import { createTransactionPreparer } from './fn004-durable-prepare.js';
import { createFailureRecoveryService } from './fn004-failure-recovery.js';
import { createSuccessRecoveryService } from './fn004-success-recovery.js';
import { replaceCanonicalBytes } from './fn004-recovery-durability.js';
import { canonicalJson } from './canonical-hash.js';
import { RECOVERY_CODES } from './fn004-evidence-errors.js';
import { check, same } from './fn004-evidence-types.js';

const raw = value => Buffer.from(canonicalJson(value) + '\n');
const rejected = new Set(['STALE_PLAN','DECISION_NOT_EFFECTIVE','CANDIDATE_FINGERPRINT_MISMATCH',
  'APPROVAL_INVALIDATED','APPROVAL_PLAN_MISMATCH']);

// Called only by the new-receipt branch, with the original live lease and the
// validated before snapshot captured in that same acceptance critical section.
// No retry/resume/public dispatch entry point is provided.
export async function executeAcceptedRequest({ root, gate, artifact, original, before_state, evaluateTerminal },
  { io = fs, clock = () => new Date().toISOString(), onBoundary = async () => {}, audit } = {}) {
  const store = await createPersistence(root, { io }), publisher = await createEvidencePublisher(root, { io });
  const r = structuredClone(artifact.receipt), binding = { ...r, bootstrap_hash: before_state.bootstrap_hash,
    receipt_hash: artifact.receipt_hash };
  delete binding.requested_at;
  const options = { io, clock, onBoundary, beforeOriginalRelease:evaluateTerminal, ...(audit ? { audit } : {}) };
  let ownerDurable = false;
  try {
    await assertGateOwnership(gate, store.root);
    const d = await discoverEvidence(store.root, { io }), p = 'staging/.fn004.lock', file = d.files.find(f => f.path === p);
    const witness = { metadata: d.documents[p], byte_length: file.byte_length, sha256: file.sha256, ...d.identities[p] };
    const inputs = { decision: d.documents['staging/decisions.json'].revisions.find(v => same(binding.decision,
      { decision_id:v.decision_id, revision:v.revision, content_hash:v.content_hash })),
      plan:d.documents[`staging/apply-plans/${r.plan_id}.json`], approval:d.documents[`staging/apply-approvals/${r.approval_id}.json`],
      request:{schema_version:1,receipt:r} };
    const owner = recoveryEnvelope('fn004-owner', { binding, gate:witness, before_state:structuredClone(before_state),
      original_manifest:structuredClone(original.manifest), accepted_at:r.requested_at });
    if(await store.exists(evidencePath(owner)))throw new RepositoryError('RECOVERY_REQUIRED','Normal dispatch cannot restart an existing Owner');
    await onBoundary({phase:'owner:before',path:evidencePath(owner)});
    await publisher.publish(owner, { gate, context:{inputs} }); ownerDurable = true;
    await onBoundary({phase:'owner:after',path:evidencePath(owner)});
    const rechecked=await originalApplyAuthority(root,binding,gate,options);
    const current=recoverySnapshotData(rechecked.snapshot); rechecked.revoke();
    if(current.base.evidence.input_revalidation!=='valid')throw new RepositoryError('STALE_PLAN','Accepted inputs changed before journal start');
    const apply_time = clock();
    await (await createTransactionPreparer(root, options)).prepare({ gate, binding, apply_time });
    await commitPrepared({ store, gate, binding, options });
    return await (await createSuccessRecoveryService(root, options)).finalize({ gate, binding });
  } catch (error) {
    // Only known domain/IO failures with a freshly proven owned action can
    // terminalize here. Unknown/partial evidence retains the gate for explicit
    // Recovery. No new Request, identity, ID allocation or restart is attempted.
    if (ownerDurable && error instanceof RepositoryError && RECOVERY_CODES.includes(error.code)) {
      try {
        const authority = await originalApplyAuthority(root, binding, gate, options);
        const o = classifyRecoverySnapshot(authority.snapshot), s = recoverySnapshotData(authority.snapshot);
        authority.revoke();
        const service = s.chain.decision || o.allowed_actions[0] === 'finalize_success' ?
          await createSuccessRecoveryService(root, options) : await createFailureRecoveryService(root, options);
        await service.finalize({ gate, binding, diagnostics:[{code:error.code}] });
        if (rejected.has(error.code)) return;
      } catch (recovery_error) { error.recovery_error = recovery_error; }
    }
    try { await closeRetainedGate(gate); }
    catch (close_error) { error.retained_gate_close_error = close_error; }
    throw error;
  }
}

async function commitPrepared({ store, gate, binding, options }) {
  const { io, clock, onBoundary } = options;
  const authority = await originalApplyAuthority(store.root, binding, gate, options), publisher = await createEvidencePublisher(store.root,{io});
  let ledger = authority.session.discovery, s = recoverySnapshotData(authority.snapshot);
  const owner = s.owner, intent = s.intent;
  const inputs = { decision:ledger.documents['staging/decisions.json'].revisions.find(v => same(binding.decision,
    {decision_id:v.decision_id,revision:v.revision,content_hash:v.content_hash})),
    plan:ledger.documents[`staging/apply-plans/${binding.plan_id}.json`], approval:ledger.documents[`staging/apply-approvals/${binding.approval_id}.json`],
    request:{schema_version:1,receipt:ledger.documents[`staging/apply-requests/${binding.request_id}.json`].receipt} };
  let head = s.chain.head;
  check(head?.payload.phase === 'PREPARED' && intent, 'Normal commit requires a fully prepared original transaction');
  async function guard(changes = new Map()) {
    const snapshot = await authority.refresh(), next = authority.session.discovery;
    const before = new Map(ledger.files.filter(f=>f.kind!=='missing').map(f=>[f.path,f]));
    const after = new Map(next.files.filter(f=>f.kind!=='missing').map(f=>[f.path,f]));
    for (const path of new Set([...before.keys(),...after.keys()])) {
      if (changes.has(path)) {
        const expected = changes.get(path);
        check(expected === null ? !after.has(path) : next.rawBytes[path]?.equals(expected), 'Owned commit publication differs');
      } else check(same(before.get(path)??null,after.get(path)??null) &&
        same(ledger.identities[path]??null,next.identities[path]??null), 'Evidence changed outside the owned commit');
    }
    s = recoverySnapshotData(snapshot);
    const allowedSemantic = s.provenance?.mixed ? s.semantic_codes : [];
    check(s.diagnostics.every(d=>allowedSemantic.includes(d.code)) && !s.proof && !s.completion && !s.archive &&
      !s.chain.decision && same(s.chain.head,head), 'Normal commit evidence/phase is contradictory');
    if(s.base.evidence.input_revalidation!=='valid') throw new RepositoryError('STALE_PLAN','Accepted inputs are no longer current');
    ledger = next; return s;
  }
  async function effect(phase, changes, fn) {
    const path = [...changes.keys()].find(p=>p.startsWith('data/')) ?? changes.keys().next().value;
    await guard(); await onBoundary({phase:`${phase}:before`,path}); await guard();
    await fn();
    try { await guard(changes); await onBoundary({phase:`${phase}:after`,path}); await guard(); }
    catch(error) {
      if(error instanceof RepositoryError && /^PERSISTENCE_/.test(error.code) && changes.has(error.path))
        Object.assign(error,{phase:error.phase??null,published:true});
      throw error;
    }
  }
  async function journal(changes, phase) {
    const entry = recoveryEnvelope('fn004-journal',{...structuredClone(head.payload),...changes,
      sequence:head.payload.sequence+1,previous_entry_hash:head.hash,recorded_at:clock(),error:null});
    // The expected head advances only with this exact immutable publication.
    await guard(); await onBoundary({phase:`${phase}:before`,path:evidencePath(entry)}); await guard();
    await publisher.publish(entry,{gate,context:{owner,intent,inputs,prefix:s.chain.entries}});
    head = entry;
    try {
      await guard(new Map([[evidencePath(entry),raw(entry)]]));
      await onBoundary({phase:`${phase}:after`,path:evidencePath(entry)}); await guard();
    } catch(error) {
      if(error instanceof RepositoryError && /^PERSISTENCE_/.test(error.code) && error.path===evidencePath(entry))
        Object.assign(error,{phase:error.phase??null,published:true});
      throw error;
    }
  }
  try {
    await guard();
    await journal({phase:'COMMITTING',consumed_state:intent.payload.expected_consumed_state},'committing');
    const statePath='staging/fn004-state.json';
    await effect('consume',new Map([[statePath,raw(intent.payload.expected_consumed_state)]]),
      ()=>store.writeJsonAtomic(statePath,intent.payload.expected_consumed_state));
    await journal({id_consumed:true},'consumed');
    for(const path of intent.payload.changed_paths) {
      const from=`staging/transactions/${binding.transaction_id}/temp/${path}`;
      const bytes=Buffer.from(ledger.rawBytes[from]), previous=Buffer.from(ledger.rawBytes[path]);
      await effect('replace',new Map([[from,null],[path,bytes]]),
        ()=>replaceCanonicalBytes(store,io,{from,path,bytes,previous}));
      if(path===intent.payload.changed_paths.at(-1))await onBoundary({phase:'replace_last:after',path});
      await journal({replaced_paths:[...head.payload.replaced_paths,path]},'replaced');
    }
    await onBoundary({phase:'commit_validation:before'}); await guard();
    check(s.semantic_codes.length===0 && same(s.canonical_manifest,intent.payload.target_manifest),
      'Actual whole canonical is not the fully validated target');
    await onBoundary({phase:'commit_validation:after'}); await guard();
  } finally { authority.revoke(); }
}

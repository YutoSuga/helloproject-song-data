import { canonicalJson, hashCanonicalJson, sha256 } from './canonical-hash.js';
import { parseStrictJson } from './strict-json.js';
import { RepositoryError } from './persistence.js';
import { readCanonicalSnapshotFromAdapter } from './canonical-snapshot.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { validateBootstrapRecord, validateFn004State, validateGitAuditIdentity, validateNamespaceMap } from './fn004-state.js';
import { validateApplyRequest, receiptHashProjectionV1, validateApproval, validateInvalidation, approvalHash } from './fn004-approval-schema.js';
import { buildDecisionRegistry } from './fn004-decision-lifecycle.js';
import { generatePlanFromTerminalInput } from './fn004-plan-generate.js';
import { validateOwner, validateIntent, validateEvidenceInputs, transactionPaths } from './fn004-transaction-evidence.js';
import { validateJournalChain, terminalStateForEntry, validateJournalCache } from './fn004-journal-chain.js';
import { validateTerminalProof, validateCompletion } from './fn004-terminal-evidence.js';
import { proveTerminalHistory } from './fn004-terminal-history.js';
import { validateOwnershipArchive } from './fn004-evidence-ownership.js';
import { evidencePath } from './fn004-evidence-persistence.js';
import { observationHashV2 } from './fn004-recovery-observation.js';
import { validateEvidenceNamespace, publisherTarget } from './fn004-evidence-namespace.js';
import { currentIdMaxima, ID_NAMESPACES } from './fn004-id-audit.js';
import { validateApplyPlan } from './fn004-plan-validator.js';
import { validatePreparedTargetBytes } from './fn004-prepared-target-validation.js';
import { validateOtherLocalEvidence } from './fn004-local-evidence-validation.js';
import { validateCandidates } from './prepare-reviews.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { materializeCanonicalTarget } from './fn004-target-materialization.js';
import { check, same, closed, binding as validateBinding, processOwner, gateWitness, TERMINAL_PHASES } from './fn004-evidence-types.js';

const clone = value => JSON.parse(canonicalJson(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
class RecoverySnapshot {
  #data;
  constructor(data) { this.#data = freeze(clone(data)); Object.freeze(this); }
  static read(snapshot) { return snapshot.#data; }
}
// Private-field validity is nominal input validation, not a cache of filesystem
// truth. Every value in the immutable input is derived afresh by the builder.
export const recoverySnapshotData = snapshot => RecoverySnapshot.read(snapshot);

const jsonFile = path => path.endsWith('.json') || path.endsWith('.lock') || /\.(?:json|lock)\.tmp-/.test(path);
const missing = path => new RepositoryError('PERSISTENCE_NOT_FOUND', 'Required evidence is absent', { path });

export async function prepareRecoverySnapshot({ binding: b, discovery, git_audit, probe, consistency = 'stable' }) {
  validateBinding(b);
  if (git_audit !== null && git_audit !== undefined) {
    closed(git_audit, ['git', 'maxima']);
    validateGitAuditIdentity(git_audit.git); validateNamespaceMap(git_audit.maxima);
  } else git_audit = null;
  const files = [...discovery.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const expected = [`staging/transactions/${b.transaction_id}/owner.json`, `staging/transactions/${b.transaction_id}/intent.json`,
    `staging/transactions/${b.transaction_id}/transaction.json`, `staging/transaction-proofs/${b.transaction_id}.json`,
    `staging/apply-requests/completions/${b.request_id}.json`, 'staging/.fn004.lock', 'staging/.fn004-recovery.lock',
    ...Object.values(transactionPaths(b).inputs)];
  for (const path of expected) if (!files.some(file => file.path === path)) files.push({ path, kind: 'missing', byte_length: null, sha256: null });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  check(new Set(files.map(file => file.path)).size === files.length, 'Duplicate discovered path');
  const docs = {}, bytes = discovery.rawBytes;
  check(Object.keys(bytes).every(path => files.some(file => file.path === path && file.kind === 'file')), 'Unindexed raw evidence bytes');
  for (const file of files) {
    if (file.kind !== 'file') continue;
    check(Buffer.isBuffer(bytes[file.path]) && bytes[file.path].length === file.byte_length &&
      sha256(bytes[file.path]) === file.sha256, 'Discovered bytes/hash mismatch');
    if (jsonFile(file.path)) {
      try {
        docs[file.path] = parseStrictJson(bytes[file.path]);
        if (docs[file.path] === null || typeof docs[file.path] !== 'object' || Array.isArray(docs[file.path])) {
          throw new RepositoryError('PERSISTENCE_ROOT_TYPE', 'Evidence JSON requires an object root', { path: file.path });
        }
      }
      catch (cause) {
        if (cause instanceof RepositoryError) throw cause;
        throw new RepositoryError(cause instanceof TypeError ? 'PERSISTENCE_INVALID_UTF8' : 'PERSISTENCE_PARSE_FAILED',
          'Invalid authoritative JSON evidence', { path: file.path, cause });
      }
    }
  }
  function required(path) { if (!Object.hasOwn(docs, path)) throw missing(path); return docs[path]; }
  const bootstrap = validateBootstrapRecord(required('staging/fn004-bootstrap.json'));
  check(bootstrap.bootstrap_hash === b.bootstrap_hash && bootstrap.payload.repository_instance_id === b.repository_instance_id,
    'Recovery repository identity mismatch');
  const requests = Object.entries(docs).filter(([path]) => /^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(path))
    .map(([path, value]) => { validateApplyRequest(value, path.split('/').at(-1).slice(0, -5)); return value; });
  const request = requests.find(value => value.receipt.request_id === b.request_id);
  if (!request) throw missing(`staging/apply-requests/${b.request_id}.json`);
  const root = `staging/transactions/${b.transaction_id}`, ownershipRoot = `staging/recovery-ownership/${b.transaction_id}`;
  const diagnostics = [];
  const add = code => { if (!diagnostics.some(value => value.code === code)) diagnostics.push({ code }); };
  function attempt(fn) {
    try { return fn(); }
    catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      if (/^PERSISTENCE_|^PATH_/.test(error.code)) throw error;
      add(error.code); return null;
    }
  }
  attempt(() => validateEvidenceNamespace(files));
  check(same(b, { ...Object.fromEntries(Object.entries(request.receipt).filter(([key]) => key !== 'requested_at')),
    bootstrap_hash: bootstrap.bootstrap_hash, receipt_hash: request.receipt_hash }), 'Receipt/Recovery Binding mismatch');
  const state = attempt(() => validateFn004State(required('staging/fn004-state.json')));
  const histories = Object.entries(docs).filter(([path]) => path.startsWith('staging/apply-history/') && path.endsWith('.json')).map(([, value]) => value);
  const terminalProofs = Object.entries(docs).filter(([path]) => path.startsWith('staging/transaction-proofs/') && path.endsWith('.json')).map(([, value]) => value);
  const profile = attempt(() => proveTerminalHistory({ bootstrap, records: histories, proofs: terminalProofs }));
  const owner = docs[`${root}/owner.json`] ?? null, intent = docs[`${root}/intent.json`] ?? null;
  const proof = docs[`staging/transaction-proofs/${b.transaction_id}.json`] ?? null;
  const completion = docs[`staging/apply-requests/completions/${b.request_id}.json`] ?? null;
  const store = required('staging/decisions.json');
  attempt(() => buildDecisionRegistry(store));
  const candidates = required('staging/song-candidates.json');
  validateCandidates(candidates);
  const inputs = attempt(() => ({ decision: (Array.isArray(store?.revisions) ? store.revisions : []).find(revision => same(b.decision,
    { decision_id: revision.decision_id, revision: revision.revision, content_hash: revision.content_hash })),
  plan: required(`staging/apply-plans/${b.plan_id}.json`), approval: required(`staging/apply-approvals/${b.approval_id}.json`),
  request: receiptHashProjectionV1(request) }));
  if (inputs) attempt(() => validateEvidenceInputs(b, inputs));
  for (const [path, value] of Object.entries(docs)) {
    if (publisherTarget(path)) continue;
    if (/^staging\/apply-plans\//.test(path)) attempt(() => {
      validateApplyPlan(value); check(path === `staging/apply-plans/${value.plan_id}.json`, 'Plan filename mismatch');
    });
    if (/^staging\/apply-approvals\/apr_/.test(path)) attempt(() => {
      validateApproval(value); check(path === `staging/apply-approvals/${value.approval_id}.json`, 'Approval filename mismatch');
      const plan = required(`staging/apply-plans/${value.plan_id}.json`);
      validateApplyPlan(plan);
      check(value.repository_instance_id === b.repository_instance_id && plan.payload.bootstrap_hash === b.bootstrap_hash &&
        plan.plan_hash === value.plan_hash && same(plan.payload.decision.identity, { decision_id: value.decision_id,
          revision: value.revision, content_hash: value.decision_content_hash }), 'Approval static binding mismatch');
    });
    if (path.startsWith('staging/apply-history/')) attempt(() => check(path === `staging/apply-history/${value?.payload?.apply_id}.json`, 'History filename mismatch'));
    if (path.startsWith('staging/transaction-proofs/')) attempt(() => check(path === `staging/transaction-proofs/${value?.payload?.binding?.transaction_id}.json`, 'Proof filename mismatch'));
    if (path.startsWith('staging/apply-approvals/invalidations/')) attempt(() => {
      validateInvalidation(value, path.split('/').at(-1).slice(0, -5));
      const approval = validateApproval(required(`staging/apply-approvals/${value.approval_id}.json`));
      check(value.approval_hash === approvalHash(approval) && value.repository_instance_id === approval.repository_instance_id,
        'Invalidation does not bind Approval');
      const accepted = requests.find(request => request.receipt.request_id === approval.intended_request_id);
      if (value.accepted_request === null) check(!accepted, 'Pre-accept Invalidation coexists with Receipt');
      else {
        if (!accepted) { add('RECOVERY_REQUIRED'); return; }
        check(accepted.receipt.approval_id === approval.approval_id && accepted.receipt.approval_hash === value.approval_hash &&
          same(value.accepted_request, { request_id: accepted.receipt.request_id, receipt_hash: accepted.receipt_hash }),
        'Invalidation does not bind exact Receipt');
      }
    });
  }
  const journalFiles = files.filter(file => file.path.startsWith(`${root}/journal/`) && !publisherTarget(file.path));
  const journal = journalFiles.map(file => docs[file.path]);
  const chain = owner ? attempt(() => {
    validateOwner(owner, inputs);
    const checked = validateJournalChain({ owner, intent, entries: journal, inputs });
    check(same(owner.payload.binding, b), 'Owner has a different Binding');
    for (const entry of checked.entries) check(docs[evidencePath(entry)] === entry, 'Noncanonical journal filename');
    for (const file of journalFiles) check(file.kind === 'file' && /\/journal\/[0-9]+\.json$/.test(file.path), 'Unknown journal artifact');
    return checked;
  }) : null;
  if (chain && docs[`${root}/transaction.json`]) attempt(() => validateJournalCache(docs[`${root}/transaction.json`],
    { owner, entries: chain.entries }));
  if (!owner && (journal.length || intent)) add('INTEGRITY_CONFLICT');
  const checkedProof = proof ? attempt(() => {
    validateTerminalProof(proof, { histories }); check(same(proof.payload.binding, b), 'Foreign proof');
    check(inputs !== null && same(proof.payload.inputs, inputs), 'Proof input snapshots differ from retained originals');
    if (owner) check(chain !== null && same(proof.payload.owner, owner) && same(proof.payload.journal, chain.entries) &&
      same(proof.payload.intent, intent), 'Proof differs from retained runtime evidence');
    return proof;
  }) : null;
  const checkedCompletion = completion ? attempt(() => validateCompletion(completion, proof)) : null;
  const barrier = docs['staging/.fn004-recovery.lock'] ?? null;
  const anchor = docs[`${ownershipRoot}/anchor.json`] ?? null;
  const claims = Object.entries(docs).filter(([path]) => path.startsWith(`${ownershipRoot}/claims/`) && !publisherTarget(path)).map(([, value]) => value);
  const retirements = Object.entries(docs).filter(([path]) => path.startsWith(`${ownershipRoot}/retirements/`) && !publisherTarget(path)).map(([, value]) => value);
  const ownBarrier = barrier && same(barrier.payload?.binding, b) ? barrier : null;
  const archive = anchor ? attempt(() => validateOwnershipArchive({ anchor, claims, retirements, barrier: ownBarrier })) : null;
  function validateKnownOwnershipPrefix(prefix) {
    if (prefix === null || prefix === undefined) return;
    if (!archive) { add('GATE_CORRUPT'); return; }
    attempt(() => {
      if (!(same(prefix.anchor, anchor) && prefix.claims.length <= archive.chain.length &&
        prefix.claims.every((claim, index) => same(claim, archive.chain[index])))) {
        throw new RepositoryError('GATE_CORRUPT', 'Archive regressed below retained ownership proof');
      }
    });
  }
  for (const entry of chain?.entries ?? []) validateKnownOwnershipPrefix(entry.payload.authority.recovery);
  validateKnownOwnershipPrefix(checkedProof?.payload.authority.recovery);
  if (archive) attempt(() => {
    if (anchor.payload.gate === null && (!checkedProof || !checkedCompletion)) throw new RepositoryError('GATE_CORRUPT', 'Gate-free ownership before terminalization');
    if (anchor.payload.gate !== null && chain && !same(anchor.payload.gate, owner.payload.gate)) throw new RepositoryError('GATE_CORRUPT', 'Anchor adopted a foreign canonical gate');
    for (const record of [anchor, ...claims, ...retirements]) check(docs[evidencePath(record)] === record, 'Noncanonical ownership filename');
    for (const record of retirements.filter(record => record.kind === 'fn004-recovery-retiring')) check(proof && completion &&
      record.payload.terminal_proof_hash === proof.hash && record.payload.completion_hash === completion.hash &&
      same(record.payload.terminal_journal, completion.payload.terminal_journal) &&
      record.payload.final_manifest_hash === proof.payload.final_manifest.manifest_hash &&
      record.payload.terminal_state_hash === proof.payload.after_state.state_hash, 'Retirement lacks exact semantic terminalization');
  });
  if (!anchor && (claims.length || retirements.length || ownBarrier)) add('GATE_CORRUPT');
  if (barrier && !ownBarrier) add('GATE_BUSY');
  let gate = null;
  if (docs['staging/.fn004.lock']) gate = attempt(() => {
    const identity = discovery.identities['staging/.fn004.lock'];
    const value = { metadata: docs['staging/.fn004.lock'], byte_length: bytes['staging/.fn004.lock'].length,
      sha256: sha256(bytes['staging/.fn004.lock']), ...identity };
    try { gateWitness(value); }
    catch (cause) { throw new RepositoryError('GATE_CORRUPT', 'Invalid current canonical gate', { cause }); }
    return value;
  });
  if (archive && ownBarrier) attempt(() => {
    const witness = { artifact: ownBarrier, byte_length: bytes['staging/.fn004-recovery.lock'].length,
      sha256: sha256(bytes['staging/.fn004-recovery.lock']), ...discovery.identities['staging/.fn004-recovery.lock'] };
    for (const record of retirements.filter(value => value.kind === 'fn004-recovery-retiring')) {
      if (!same(record.payload.barrier, witness)) throw new RepositoryError('GATE_OWNERSHIP_MISMATCH', 'Barrier physical identity changed');
    }
    if (archive.state === 'RETIRING' && gate && !same(archive.retiring.payload.canonical_gate, gate)) {
      throw new RepositoryError('GATE_OWNERSHIP_MISMATCH', 'Retiring gate physical identity changed');
    }
  });
  let relatedGate = gate !== null && chain !== null && same(gate, owner.payload.gate);
  if (archive && gate !== null && archive.state !== 'SEALED') {
    const expectedGate = archive.head.payload.gate;
    const currentProcess = Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
      'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, gate.metadata[key]]));
    relatedGate = expectedGate !== null ? same(expectedGate, gate) :
      gate.metadata.operation === 'recovery_cleanup' && same(currentProcess, archive.head.payload.owner);
  }
  if (gate && !relatedGate) add(checkedCompletion ? 'GATE_BUSY' : 'GATE_OWNERSHIP_MISMATCH');
  const canonical = await readCanonicalSnapshotFromAdapter({
    list: () => files.filter(file => /^data\/[^/]+$/.test(file.path) && file.kind !== 'missing').map(file => file.path.slice(5)),
    read: path => { if (!bytes[path]) throw Object.assign(new Error('Missing CSV'), { code: 'ENOENT' }); return bytes[path]; }
  });
  if (!canonical.validation.ok) {
    add('CANONICAL_INVALID'); canonical.validation.diagnostics.forEach(diagnostic => add(diagnostic.code));
  }
  if (state && canonical.validation.ok && git_audit) attempt(() => {
    const maxima = currentIdMaxima(canonical);
    if (!ID_NAMESPACES.every(namespace => state.high_water_marks[namespace] >= maxima[namespace] &&
      state.high_water_marks[namespace] >= git_audit.maxima[namespace] &&
      state.high_water_marks[namespace] >= bootstrap.payload.high_water_marks[namespace])) throw new RepositoryError('STATE_HIGH_WATER_INVALID', 'State high-water is below authoritative usage');
  });
  let original = null;
  if (chain && owner && canonical.manifest && same(canonical.manifest, owner.payload.original_manifest)) original = canonical;
  else if (chain && owner && CANONICAL_TABLES.every(table => bytes[`${root}/backup/${table.path}`])) {
    original = await readCanonicalSnapshotFromAdapter({ list: () => CANONICAL_TABLES.map(table => table.path.slice(5)),
      read: path => bytes[`${root}/backup/${path}`] });
    if (!original.validation.ok || !same(original.manifest, owner.payload.original_manifest)) add('INTEGRITY_CONFLICT');
  }
  if (chain && intent && original) {
    try { await validatePreparedTargetBytes({ owner, intent, inputs, original, rawBytes: bytes }); }
    catch (error) { if (!(error instanceof RepositoryError)) throw error; add(error.code); }
  }
  let revalidation = 'unavailable';
  if (chain && owner && inputs && original && state && profile) {
    try {
      const count = owner.payload.before_state.history.count;
      const records = profile.histories.filter(record => record.payload.sequence <= count);
      const proofs = terminalProofs.filter(value => value.payload.binding.transaction_id !== b.transaction_id &&
        value.payload.after_state.generation <= owner.payload.before_state.generation);
      const regenerated = generatePlanFromTerminalInput({ decision: inputs.decision, registry: buildDecisionRegistry(store),
        candidates, snapshot: original, state: owner.payload.before_state },
      { bootstrap, records, proofs }, { generated_at: inputs.plan.generated_at });
      revalidation = same(regenerated.payload, inputs.plan.payload) ? 'valid' : 'stale';
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      if (['CANDIDATE_FINGERPRINT_MISMATCH', 'DECISION_NOT_EFFECTIVE', 'ALREADY_APPLIED',
        'APPLIED_DECISION_REVISION_UNSUPPORTED', 'APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED'].includes(error.code)) revalidation = 'stale';
      else add(error.code);
    }
  }
  if (chain && owner && profile) attempt(() => {
    if (!profile.checkpoints.some(checkpoint => same(checkpoint, owner.payload.before_state))) {
      throw new RepositoryError('STATE_TRANSITION_PROOF_REQUIRED', 'Owner before state is not a proven checkpoint');
    }
  });
  const head = chain?.head?.payload ?? null, phase = head?.phase === 'RECOVERY_REQUIRED' ? head.resume_phase : head?.phase ?? null;
  let unboundTarget = null;
  if (chain && !intent && head?.target_manifest && original && inputs) {
    try {
      unboundTarget = await materializeCanonicalTarget({ owner, inputs, original, apply_time: head.apply_time });
      check(same(unboundTarget.target.manifest, head.target_manifest) && same(unboundTarget.changed_paths, head.changed_paths),
        'Pre-Intent computed target differs from saved Plan/original/time');
    } catch (error) { if (!(error instanceof RepositoryError)) throw error; add(error.code); }
  }
  const ownHistory = histories.filter(record => record?.payload?.transaction_id === b.transaction_id || record?.payload?.apply_id === b.apply_id);
  if (owner && chain) attempt(() => {
    const record = chain.decision?.record;
    check(record ? ownHistory.length <= 1 && ownHistory.every(actual => same(actual, record)) : ownHistory.length === 0,
      'History conflicts with journal decision stage');
    if (['HISTORY_COMMITTED', 'COMPLETED'].includes(phase)) check(ownHistory.length === 1, 'Published History is missing');
    if (!checkedCompletion) check(histories.length === owner.payload.before_state.history.count + ownHistory.length,
      'Unfinished transaction has an unexpected History suffix');
  });
  let proofIntent = null, unresolved = false;
  for (const file of files.filter(file => file.kind === 'file' && publisherTarget(file.path))) {
    const target = publisherTarget(file.path), value = docs[file.path];
    if (target === `${root}/transaction.json` && value && chain) attempt(() => validateJournalCache(value, { owner, entries: chain.entries }));
    else if (!jsonFile(target) && bytes[target]) attempt(() => check(bytes[file.path].equals(bytes[target]), 'Conflicting raw publisher temporary evidence'));
    else if (docs[target]) attempt(() => check(value && same(value, docs[target]), 'Conflicting publisher temporary evidence'));
    else if (target === `staging/transaction-proofs/${b.transaction_id}.json` && value) {
      const valid = attempt(() => {
        validateTerminalProof(value, { histories });
        check(chain && same(value.payload.binding, b) && same(value.payload.inputs, inputs) && same(value.payload.owner, owner) &&
          same(value.payload.journal, chain.entries) && same(value.payload.intent, intent), 'Proof publication intent differs from terminal facts');
        return value;
      });
      if (valid) { if (proofIntent && !same(proofIntent, valid)) add('INTEGRITY_CONFLICT'); proofIntent = valid; }
    } else if (target === `staging/apply-requests/completions/${b.request_id}.json` && value) {
      attempt(() => validateCompletion(value, proof));
    } else unresolved = true;
  }
  if (unresolved) add('RECOVERY_REQUIRED');
  validateKnownOwnershipPrefix(proofIntent?.payload.authority.recovery);
  const cleanupFiles = files.filter(file => file.kind !== 'missing' && file.kind !== 'directory' &&
    (file.path.startsWith(`${root}/backup/`) || file.path.startsWith(`${root}/temp/`) ||
      file.path.startsWith(`${root}/restore/`) || publisherTarget(file.path) !== null));
  if (archive?.retiring) {
    const releaseOnlyTargets = [archive.retiring, archive.retired].filter(Boolean).map(evidencePath);
    if (cleanupFiles.some(file => !releaseOnlyTargets.includes(publisherTarget(file.path)))) add('RECOVERY_REQUIRED');
  }
  if (chain && owner.payload.gate.metadata.root !== discovery.root &&
    (cleanupFiles.length || gate || archive && archive.state !== 'SEALED' || !checkedCompletion)) add('GATE_OWNERSHIP_MISMATCH');
  const beforeCompletion = checkedCompletion === null;
  if (owner && chain) attempt(() => {
    const refs = new Map();
    for (const entry of chain.entries) for (const ref of [...entry.payload.backup_refs, ...entry.payload.temp_refs]) refs.set(ref.path, ref);
    if (intent) for (const ref of [...intent.payload.backup_refs, ...intent.payload.temp_refs, ...Object.values(intent.payload.inputs)]) refs.set(ref.path, ref);
    for (const ref of refs.values()) {
      const raw = bytes[ref.path];
      if (raw) check(raw.length === ref.byte_length && sha256(raw) === ref.sha256, 'Referenced evidence bytes changed');
      else if (beforeCompletion) {
        const canonicalPath = ref.path.startsWith(`${root}/temp/data/`) ? ref.path.slice(`${root}/temp/`.length) : null;
        const renamed = canonicalPath && intent && canonical.manifest && same(canonical.manifest.files.find(file => file.path === canonicalPath),
          intent.payload.target_manifest.files.find(file => file.path === canonicalPath));
        const pastRename = canonicalPath && chain.entries.some(entry => entry.payload.replaced_paths.includes(canonicalPath) ||
          entry.payload.restored_paths.includes(canonicalPath));
        check(canonicalPath && (renamed || pastRename && ['ROLLING_BACK', 'ROLLED_BACK'].includes(phase)), 'Required prepare/restore evidence is missing');
      }
    }
    for (const [key, path] of Object.entries(transactionPaths(b).inputs)) if (docs[path]) check(same(docs[path], inputs[key]), 'Input copy differs from original');
    if (docs[`${root}/backup/fn004-state.json`]) {
      validateFn004State(docs[`${root}/backup/fn004-state.json`]);
      check(same(docs[`${root}/backup/fn004-state.json`], owner.payload.before_state), 'State backup differs from before state');
    }
    for (const file of cleanupFiles.filter(file => !publisherTarget(file.path))) {
      if (refs.has(file.path)) continue;
      if (file.path === `${root}/temp/apply-history.json`) {
        const record = validateHistoryRecord(docs[file.path]);
        check(intent && record.payload.transaction_id === b.transaction_id && record.payload.apply_id === b.apply_id &&
          same(record.plan_snapshot, inputs.plan) && same(record.decision_snapshot, inputs.decision) &&
          same(record.payload.before_manifest, owner.payload.original_manifest) &&
          same(record.payload.after_manifest, intent.payload.target_manifest) && record.payload.apply_time === head.apply_time &&
          (!chain.decision || same(record, chain.decision.record)), 'Temporary History differs from transaction facts');
        continue;
      }
      if (file.path === `${root}/backup/fn004-state.json`) check(same(docs[file.path], owner.payload.before_state), 'Unbound state backup differs');
      else if (file.path.startsWith(`${root}/backup/data/`)) {
        const expected = owner.payload.original_manifest.files.find(value => value.path === file.path.slice(`${root}/backup/`.length));
        check(expected && expected.byte_length === file.byte_length && expected.sha256 === file.sha256, 'Unbound backup differs from original');
      } else if (file.path.startsWith(`${root}/restore/data/`)) {
        const canonicalPath = file.path.slice(`${root}/restore/`.length);
        const expected = owner.payload.original_manifest.files.find(value => value.path === canonicalPath);
        check(intent && intent.payload.changed_paths.includes(canonicalPath) && ['ROLLING_BACK', 'ROLLED_BACK'].includes(phase) &&
          expected && expected.byte_length === file.byte_length && expected.sha256 === file.sha256, 'Restore evidence differs from rollback original');
      } else if (file.path.startsWith(`${root}/temp/data/`) && unboundTarget) {
        const path = file.path.slice(`${root}/temp/`.length), expected = unboundTarget.target.rawBytes[path];
        check(unboundTarget.changed_paths.includes(path) && expected && bytes[file.path].equals(expected), 'Unbound target temp differs from saved Plan');
      } else add('RECOVERY_REQUIRED');
    }
  });
  validateOtherLocalEvidence({ selected: b, requests, docs, files, rawBytes: bytes, histories, attempt, add });
  let effective = archive?.state === 'SEALED' ? null : archive?.head.payload.owner ?? null;
  if (!effective && archive?.state !== 'SEALED' && gate) {
    effective = Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
      'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, gate.metadata[key]]));
  }
  let ownerStatus = effective === null ? 'none' : 'unverifiable';
  if (effective && probe) {
    attempt(() => {
      closed(probe, ['owner', 'observer', 'status']);
      processOwner(probe.owner); processOwner(probe.observer);
      check(same(effective, probe.owner) && ['live', 'exited', 'unverifiable'].includes(probe.status), 'Foreign owner probe');
      const sameNamespace = effective.platform === 'linux' && effective.process_start_id !== null &&
        ['hostname', 'platform', 'boot_id', 'pid_namespace'].every(key => effective[key] !== null && effective[key] === probe.observer[key]);
      if (probe.status === 'exited' && !sameNamespace) throw new RepositoryError('RECOVERY_REQUIRED', 'Termination is unproven across host/boot/namespace');
      ownerStatus = probe.status;
    });
  }
  if (git_audit !== null) attempt(() => { validateGitAuditIdentity(git_audit.git); validateNamespaceMap(git_audit.maxima); });
  const evidence = { repository_instance_id: b.repository_instance_id, bootstrap_hash: b.bootstrap_hash,
    transaction_id: b.transaction_id, request_id: b.request_id, files, canonical_manifest: canonical.manifest,
    state_hash: state?.state_hash ?? null, history_head_hash: profile?.histories.at(-1)?.record_hash ?? (profile ? b.bootstrap_hash : null),
    git_audit: git_audit?.git ?? null, historical_maxima: git_audit?.maxima ?? null,
    journal_head: chain?.head ? { sequence: chain.head.payload.sequence, entry_hash: chain.head.hash } : null,
    journal_phase: chain?.head?.payload.phase ?? null, terminal_proof_hash: checkedProof?.hash ?? null,
    completion_hash: checkedCompletion?.hash ?? null, effective_owner: effective, owner_status: ownerStatus,
    input_revalidation: revalidation, consistency };
  const base = { schema_version: 2, binding: b, evidence, observed_state_hash: observationHashV2({ binding: b, evidence, requests }) };
  return new RecoverySnapshot({ base, diagnostics, owner, intent, chain, proof: checkedProof, proof_intent: proofIntent, completion: checkedCompletion,
    archive, barrier: ownBarrier, gate, state, cleanup_required: cleanupFiles.length > 0 || relatedGate || archive !== null && archive.state !== 'SEALED',
    canonical_manifest: canonical.manifest, original_manifest: chain ? owner.payload.original_manifest : null,
    histories: profile?.histories ?? [], profile_terminal: profile?.terminal ?? null,
    terminal_state: checkedProof?.payload.after_state ??
      (chain?.head && TERMINAL_PHASES.includes(chain.head.payload.phase) ? terminalStateForEntry(chain.head.payload) : null) });
}

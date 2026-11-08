import { discoverEvidence } from './fn004-evidence-discovery.js';
import { validateEvidenceNamespace, publisherTarget } from './fn004-evidence-namespace.js';
import { validateEvidenceCollections } from './fn004-evidence-collections.js';
import { validateOtherLocalEvidence } from './fn004-local-evidence-validation.js';
import { proveTerminalHistory } from './fn004-terminal-history.js';
import { validateApplyRequest } from './fn004-approval-schema.js';
import { validateFn004State, validateGitAuditIdentity, validateNamespaceMap } from './fn004-state.js';
import { currentIdMaxima, ID_NAMESPACES, exhaustedNamespaces } from './fn004-id-audit.js';
import { buildHistoryIndexes } from './fn004-history-projections.js';
import { assertGateOwnership } from './fn004-gate.js';
import { RepositoryError } from './persistence.js';
import { same, check } from './fn004-evidence-types.js';
import { buildDecisionRegistry } from './fn004-decision-lifecycle.js';
import { validateCandidates } from './prepare-reviews.js';
import {sha256} from './canonical-hash.js';

// Internal composite proof; never presented as a success-only-v1 result.
// The caller's actual live lease spans collection, domain proof and return.
export async function inspectTerminalRuntime(store, { gate, snapshot, historical, io }) {
  await assertGateOwnership(gate, store.root);
  const d = await discoverEvidence(store.root, io ? { io } : {});
  validateEvidenceNamespace(d.files);
  const docs = d.documents;
  if (docs['staging/decisions.json']) buildDecisionRegistry(docs['staging/decisions.json']);
  if (docs['staging/song-candidates.json']) validateCandidates(docs['staging/song-candidates.json']);
  const required = path => {
    if (!docs[path]) throw new RepositoryError('PERSISTENCE_NOT_FOUND', 'Required runtime original missing', { path });
    return docs[path];
  };
  const bootstrap = required('staging/fn004-bootstrap.json'), state = validateFn004State(required('staging/fn004-state.json'));
  validateGitAuditIdentity(historical.git); validateNamespaceMap(historical.maxima);
  check(snapshot.validation.ok && same(snapshot.manifest.files, d.files.filter(f => f.path.startsWith('data/') && f.kind === 'file')
    .map(({ path, byte_length, sha256 }) => ({ path, byte_length, sha256 }))), 'Canonical changed during runtime proof');
  const records = Object.entries(docs).filter(([p]) => p.startsWith('staging/apply-history/')&&!publisherTarget(p)).map(([,v]) => v);
  const proofs = Object.entries(docs).filter(([p]) => p.startsWith('staging/transaction-proofs/')&&!publisherTarget(p)).map(([,v]) => v);
  const profile = proveTerminalHistory({ bootstrap, records, proofs });
  const requests = Object.entries(docs).filter(([p]) => /^staging\/apply-requests\/[^/]+\.json$/.test(p))
    .map(([p,v]) => validateApplyRequest(v, p.split('/').at(-1).slice(0,-5)));
  const identity = { repository_instance_id: bootstrap.payload.repository_instance_id, bootstrap_hash: bootstrap.bootstrap_hash };
  const codes = new Set(), add = code => codes.add(code), attempt = fn => fn();
  validateEvidenceCollections({ docs, requests, binding: identity, required, attempt, add });
  validateOtherLocalEvidence({ selected: { request_id: null }, requests, docs, files: d.files, rawBytes: d.rawBytes,
    histories: profile.histories, attempt, add });
  // Only fully cleaned local packages authorize ordinary reads. Incomplete
  // publisher artifacts remain evidence, even if their basename is recognized.
  const publisherFiles=d.files.filter(f=>f.kind==='file'&&publisherTarget(f.path));
  const unknownPublisherTemps=publisherFiles.some(f=>!d.rawBytes[publisherTarget(f.path)]||
    !d.rawBytes[f.path].equals(d.rawBytes[publisherTarget(f.path)]));
  const bootstrapWork=d.files.some(f=>f.path.startsWith('staging/transactions/bootstrap_'));
  const lock=d.files.find(f=>f.path==='staging/.fn004.lock'&&f.kind==='file');
  const witness=lock?{metadata:docs[lock.path],byte_length:lock.byte_length,sha256:lock.sha256,...d.identities[lock.path]}:null;
  // Do not confuse a fresh reader's own common lease with the transaction's
  // still-unreleased original gate. The latter is pending terminal cleanup,
  // exactly as in the existing Recovery observation/classifier contract.
  const relatedGate=witness!==null&&proofs.some(proof=>same(proof.payload.owner.payload.gate,witness));
  if (publisherFiles.length || bootstrapWork || relatedGate || docs['staging/.fn004-recovery.lock']) add('RECOVERY_REQUIRED');
  // A verified terminal package with only exact, enumerated leftover bytes is
  // cleanup_required, not unfinished semantic work. Unknown/unbound temp bytes
  // remain recovery_required; this reader never deletes or adopts artifacts.
  const cleanupOnly=!unknownPublisherTemps&&!bootstrapWork&&!docs['staging/.fn004-recovery.lock']&&requests.length>0&&requests.every(request=>{
    const tx=request.receipt.transaction_id,proof=docs[`staging/transaction-proofs/${tx}.json`];
    if(!proof||!docs[`staging/apply-requests/completions/${request.receipt.request_id}.json`])return false;
    const preparation=proof.payload.intent?.payload??proof.payload.journal.at(-1)?.payload;
    const refs=new Map([...(preparation?.backup_refs??[]),...(preparation?.temp_refs??[])]
      .map(ref=>[ref.path,ref]));
    return d.files.filter(f=>f.kind==='file'&&['backup','temp','restore'].some(kind=>
      f.path.startsWith(`staging/transactions/${tx}/${kind}/`))).every(file=>{
      const path=file.path.replace(`/restore/`,'/backup/'),ref=refs.get(path);
      return ref&&file.byte_length===ref.byte_length&&file.sha256===ref.sha256&&
        sha256(d.rawBytes[file.path])===ref.sha256;
    });
  })&&same(state,profile.terminal)&&state.pending_transaction===null;
  if (codes.size && !(codes.size===1&&codes.has('RECOVERY_REQUIRED')&&cleanupOnly)) throw new RepositoryError([...codes].sort()[0], 'Local work is not terminal and clean',
    { diagnostics: [...codes].sort().map(code => ({ code })) });
  if (!same(state, profile.terminal) || state.pending_transaction !== null)
    throw new RepositoryError('STATE_TRANSITION_PROOF_REQUIRED', 'Composite proof does not establish current state');
  if (!ID_NAMESPACES.every(n => [bootstrap.payload.high_water_marks, currentIdMaxima(snapshot), historical.maxima]
    .every(m => state.high_water_marks[n] >= m[n])))
    throw new RepositoryError('STATE_HIGH_WATER_INVALID', 'State high-water is below proven usage');
  await assertGateOwnership(gate, store.root);
  return { status: 'READY', readiness: codes.size?'cleanup_required':'initialized', diagnostics: codes.size?[{code:'RECOVERY_REQUIRED'}]:[],
    existing_identity: { ...identity, state_hash: state.state_hash }, high_water_marks: state.high_water_marks,
    exhausted_namespaces: exhaustedNamespaces(state.high_water_marks),
    terminal_context: { profile: 'transaction-terminal-v1', bootstrap, records: profile.histories, proofs,
      indexes: buildHistoryIndexes(profile.histories, identity) } };
}

import { validateEvidenceInputs, transactionPaths } from './fn004-transaction-evidence.js';
import { validateJournalChain, validateJournalCache } from './fn004-journal-chain.js';
import { validateTerminalProof, validateCompletion } from './fn004-terminal-evidence.js';
import { validateOwnershipArchive } from './fn004-evidence-ownership.js';
import { evidencePath } from './fn004-evidence-persistence.js';
import { publisherTarget } from './fn004-evidence-namespace.js';
import { receiptHashProjectionV1 } from './fn004-approval-schema.js';
import { sha256 } from './canonical-hash.js';
import { check, same } from './fn004-evidence-types.js';
import { RepositoryError } from './persistence.js';

// Repository-wide local evidence guard. A different transaction's incomplete
// work is never silently ignored while deciding an action for the selected one.
export function validateOtherLocalEvidence({ selected, requests, docs, files, rawBytes, histories, attempt, add }) {
  const require = path => {
    if (!Object.hasOwn(docs, path)) throw new RepositoryError('PERSISTENCE_NOT_FOUND', 'Required local evidence missing', { path });
    return docs[path];
  };
  const transactions = new Set(requests.map(request => request.receipt.transaction_id));
  for (const file of files) {
    const match = /^staging\/(?:transactions|recovery-ownership)\/(tx_[^/]+)/.exec(file.path);
    if (match && !transactions.has(match[1])) add('INTEGRITY_CONFLICT');
  }
  for (const request of requests) {
    if (request.receipt.request_id === selected.request_id) continue;
    attempt(() => {
      const tx = request.receipt.transaction_id, root = `staging/transactions/${tx}`, archiveRoot = `staging/recovery-ownership/${tx}`;
      const proof = docs[`staging/transaction-proofs/${tx}.json`], completion = docs[`staging/apply-requests/completions/${request.receipt.request_id}.json`];
      if (!proof || !completion) { add('RECOVERY_REQUIRED'); return; }
      validateTerminalProof(proof, { histories }); validateCompletion(completion, proof);
      const b = proof.payload.binding;
      const decision = docs['staging/decisions.json']?.revisions?.find(value => same(b.decision,
        { decision_id: value.decision_id, revision: value.revision, content_hash: value.content_hash }));
      const inputs = { decision, plan: require(`staging/apply-plans/${b.plan_id}.json`),
        approval: require(`staging/apply-approvals/${b.approval_id}.json`), request: receiptHashProjectionV1(request) };
      validateEvidenceInputs(b, inputs);
      check(same(inputs, proof.payload.inputs), 'Other terminal proof differs from local immutable inputs');
      const owner = docs[`${root}/owner.json`], intent = docs[`${root}/intent.json`] ?? null;
      const entries = Object.entries(docs).filter(([path]) => path.startsWith(`${root}/journal/`) && !publisherTarget(path)).map(([, value]) => value);
      if (owner) {
        const chain = validateJournalChain({ owner, intent, entries, inputs });
        check(same(owner, proof.payload.owner) && same(intent, proof.payload.intent) && same(chain.entries, proof.payload.journal),
          'Other terminal runtime evidence differs from proof');
        for (const entry of entries) check(docs[evidencePath(entry)] === entry, 'Other journal filename mismatch');
        if (docs[`${root}/transaction.json`]) validateJournalCache(docs[`${root}/transaction.json`], { owner, entries });
        for (const [key, path] of Object.entries(transactionPaths(b).inputs)) {
          if (docs[path]) check(same(docs[path], inputs[key]), 'Other terminal input copy changed');
        }
      } else check(entries.length === 0 && intent === null && !files.some(file => file.path.startsWith(`${root}/`) && file.kind === 'file'),
        'Incomplete other runtime package without Owner');
      const barrier = docs['staging/.fn004-recovery.lock'];
      const ownBarrier = barrier && same(barrier.payload?.binding, b) ? barrier : null;
      const anchor = docs[`${archiveRoot}/anchor.json`];
      const claims = Object.entries(docs).filter(([path]) => path.startsWith(`${archiveRoot}/claims/`) && !publisherTarget(path)).map(([, value]) => value);
      const retirements = Object.entries(docs).filter(([path]) => path.startsWith(`${archiveRoot}/retirements/`) && !publisherTarget(path)).map(([, value]) => value);
      if (anchor) {
        const archive = validateOwnershipArchive({ anchor, claims, retirements, barrier: ownBarrier });
        if (archive.state !== 'SEALED') add('RECOVERY_REQUIRED');
        for (const value of [anchor, ...claims, ...retirements]) check(docs[evidencePath(value)] === value, 'Other ownership filename mismatch');
        for (const authority of [proof.payload.authority, ...proof.payload.journal.map(entry => entry.payload.authority)]) {
          const prefix = authority.recovery;
          check(prefix === null || same(prefix.anchor, anchor) && prefix.claims.length <= archive.chain.length &&
            prefix.claims.every((claim, index) => same(claim, archive.chain[index])), 'Other archive regressed below known ownership');
        }
        for (const value of retirements.filter(value => value.kind === 'fn004-recovery-retiring')) {
          const p = value.payload;
          check(p.terminal_proof_hash === proof.hash && p.completion_hash === completion.hash &&
            same(p.terminal_journal, completion.payload.terminal_journal) && p.final_manifest_hash === proof.payload.final_manifest.manifest_hash &&
            p.terminal_state_hash === proof.payload.after_state.state_hash, 'Other retirement terminal binding mismatch');
        }
      } else check(!claims.length && !retirements.length && !ownBarrier && proof.payload.authority.recovery === null &&
        proof.payload.journal.every(entry => entry.payload.authority.recovery === null), 'Other ownership package lacks known anchor');
      const refs = [...(intent?.payload.backup_refs ?? []), ...(intent?.payload.temp_refs ?? []), ...Object.values(intent?.payload.inputs ?? {})];
      for (const ref of refs) if (rawBytes[ref.path]) check(rawBytes[ref.path].length === ref.byte_length &&
        sha256(rawBytes[ref.path]) === ref.sha256, 'Other retained evidence differs from immutable reference');
      if (files.some(file => file.kind === 'file' && (file.path.startsWith(`${root}/backup/`) ||
        file.path.startsWith(`${root}/temp/`) || file.path.startsWith(`${root}/restore/`)))) add('RECOVERY_REQUIRED');
    });
  }
  for (const [path, completion] of Object.entries(docs)) {
    if (!/^staging\/apply-requests\/completions\/[^/]+\.json$/.test(path)) continue;
    attempt(() => {
      check(requests.some(request => request.receipt.request_id === completion.payload?.binding?.request_id), 'Completion without local Receipt');
      validateCompletion(completion, docs[`staging/transaction-proofs/${completion.payload.binding.transaction_id}.json`]);
      check(path === evidencePath(completion), 'Completion filename mismatch');
    });
  }
}

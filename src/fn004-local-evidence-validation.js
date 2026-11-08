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
      // Missing terminal evidence is legitimate unfinished work, but does not
      // excuse corruption in an already published Owner/Intent/Journal prefix.
      // Bind the prefix to original Receipt/genesis without relying on Intent
      // or on a terminal Proof that may not have been published yet.
      const {requested_at,...receipt}=request.receipt;
      const b = {...receipt,receipt_hash:request.receipt_hash,
        bootstrap_hash:require('staging/fn004-bootstrap.json').bootstrap_hash};
      const decision = docs['staging/decisions.json']?.revisions?.find(value => same(b.decision,
        { decision_id: value.decision_id, revision: value.revision, content_hash: value.content_hash }));
      const inputs = { decision, plan: require(`staging/apply-plans/${b.plan_id}.json`),
        approval: require(`staging/apply-approvals/${b.approval_id}.json`), request: receiptHashProjectionV1(request) };
      validateEvidenceInputs(b, inputs);
      const owner = docs[`${root}/owner.json`], intent = docs[`${root}/intent.json`] ?? null;
      const entries = Object.entries(docs).filter(([path]) => path.startsWith(`${root}/journal/`) && !publisherTarget(path)).map(([, value]) => value);
      let chain;
      if (owner) {
        chain = validateJournalChain({ owner, intent, entries, inputs });
        check(same(owner.payload.binding,b), 'Local Owner differs from original Receipt/genesis');
        for (const entry of entries) check(docs[evidencePath(entry)] === entry, 'Other journal filename mismatch');
        if (docs[`${root}/transaction.json`]) validateJournalCache(docs[`${root}/transaction.json`], { owner, entries });
        for (const [key, path] of Object.entries(transactionPaths(b).inputs)) {
          if (docs[path]) check(same(docs[path], inputs[key]), 'Other terminal input copy changed');
        }
      } else {
        check(entries.length === 0 && intent === null, 'Journal/Intent without published Owner');
        // Before any terminal proof, an incomplete Owner publication remains
        // unresolved evidence. Do not adopt/delete its temp or call it a valid
        // Owner. A retained terminal package must still be complete.
        if(proof) check(!files.some(file => file.path.startsWith(`${root}/`) && file.kind === 'file'),
          'Incomplete other runtime package without Owner');
      }
      const head=chain?.head?.payload;
      // Validate every reference independently: a lagging pre-Intent Journal
      // and a published Intent may name the same path. Never let one hide a
      // conflicting immutable reference from the other.
      const refs = [...(head?.backup_refs ?? []), ...(head?.temp_refs ?? []),
        ...(intent?.payload.backup_refs ?? []), ...(intent?.payload.temp_refs ?? []), ...Object.values(intent?.payload.inputs ?? {})];
      const byPath = new Map();
      for (const ref of refs) {
        const previous = byPath.get(ref.path);
        check(previous === undefined || same(previous, ref), 'Conflicting immutable references for one path');
        byPath.set(ref.path, ref); // Only identical duplicate refs may share this index.
        if (rawBytes[ref.path]) check(rawBytes[ref.path].length === ref.byte_length &&
          sha256(rawBytes[ref.path]) === ref.sha256, 'Other retained evidence differs from immutable reference');
      }
      if(owner) for(const file of files.filter(file=>file.kind==='file'&&!publisherTarget(file.path))) {
        if(file.path===`${root}/backup/fn004-state.json`)
          check(same(docs[file.path],owner.payload.before_state),'Unbound state backup differs from original');
        else if(file.path.startsWith(`${root}/backup/data/`)||file.path.startsWith(`${root}/restore/data/`)) {
          const restore=file.path.startsWith(`${root}/restore/`),path=file.path.slice(`${root}/${restore?'restore':'backup'}/`.length);
          const expected=owner.payload.original_manifest.files.find(value=>value.path===path);
          const phase=head?.phase==='RECOVERY_REQUIRED'?head.resume_phase:head?.phase;
          check(!restore||intent&&intent.payload.changed_paths.includes(path)&&['ROLLING_BACK','ROLLED_BACK'].includes(phase),
            'Restore artifact is not from a rollback phase');
          check(expected&&rawBytes[file.path].length===expected.byte_length&&sha256(rawBytes[file.path])===expected.sha256,
            'Unbound original artifact differs from original manifest');
        }
      }
      if(proof) {
        validateTerminalProof(proof, { histories });
        check(same(proof.payload.binding,b) && same(inputs, proof.payload.inputs), 'Other terminal proof differs from local immutable inputs');
        if(owner) check(same(owner, proof.payload.owner) && same(intent, proof.payload.intent) && same(chain.entries, proof.payload.journal),
          'Other terminal runtime evidence differs from proof');
      }
      if(completion) validateCompletion(completion, proof);
      if (!proof || !completion) { add('RECOVERY_REQUIRED'); return; }
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

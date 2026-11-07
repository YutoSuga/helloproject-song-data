import * as fs from 'node:fs/promises';
import { createPersistence, RepositoryError } from './persistence.js';
import { assertGateOwnership } from './fn004-gate.js';
import { canonicalJson } from './canonical-hash.js';
import { validateOwner, validateIntent, validateJournalEntry } from './fn004-transaction-evidence.js';
import { validateJournalChain } from './fn004-journal-chain.js';
import { validateTerminalProof, validateCompletion } from './fn004-terminal-evidence.js';
import { validateMutexAnchor, validateMutexClaim, validateMutexBarrier, validateMutexRetiring,
  validateMutexRetired, validateOwnershipArchive } from './fn004-evidence-ownership.js';
import { check, same } from './fn004-evidence-types.js';
import { readPublishedJson } from './fn004-recovery-durability.js';

export function evidencePath(value) {
  const p = value.payload, tx = p.binding.transaction_id, root = `staging/transactions/${tx}`;
  const sequence = number => String(number).padStart(6, '0');
  switch (value.kind) {
    case 'fn004-owner': return `${root}/owner.json`;
    case 'fn004-intent': return `${root}/intent.json`;
    case 'fn004-journal': return `${root}/journal/${sequence(p.sequence)}.json`;
    case 'fn004-terminal-proof': return `staging/transaction-proofs/${tx}.json`;
    case 'fn004-completion': return `staging/apply-requests/completions/${p.binding.request_id}.json`;
    case 'fn004-recovery-mutex': return `staging/recovery-ownership/${tx}/anchor.json`;
    case 'fn004-recovery-claim': return `staging/recovery-ownership/${tx}/claims/${sequence(p.sequence)}.json`;
    case 'fn004-recovery-barrier': return 'staging/.fn004-recovery.lock';
    case 'fn004-recovery-retiring': return `staging/recovery-ownership/${tx}/retirements/${sequence(p.owner.sequence)}.retiring.json`;
    case 'fn004-recovery-retired': return `staging/recovery-ownership/${tx}/retirements/${sequence(p.owner.sequence)}.retired.json`;
    default: check(false, 'Unknown evidence kind');
  }
}

export function validateEvidence(value, context = {}) {
  switch (value?.kind) {
    case 'fn004-owner': check(context.inputs, 'Owner publication requires verified inputs'); return validateOwner(value, context.inputs);
    case 'fn004-intent': check(context.owner && context.inputs, 'Intent publication requires Owner/inputs'); return validateIntent(value, context);
    case 'fn004-journal':
      check(context.owner && context.inputs && Array.isArray(context.prefix), 'Journal publication requires full prefix');
      validateJournalEntry(value);
      validateJournalChain({ ...context, intent: context.intent ?? null, entries: [...context.prefix, value] });
      return value;
    case 'fn004-terminal-proof': return validateTerminalProof(value, context);
    case 'fn004-completion': return validateCompletion(value, context.proof);
    case 'fn004-recovery-mutex': return validateMutexAnchor(value);
    case 'fn004-recovery-claim':
      validateMutexClaim(value);
      check(context.archive, 'Claim publication requires complete ownership context');
      validateOwnershipArchive({ ...context.archive, claims: [...context.archive.claims, value] });
      return value;
    case 'fn004-recovery-barrier': return validateMutexBarrier(value);
    case 'fn004-recovery-retiring':
    case 'fn004-recovery-retired': {
      (value.kind === 'fn004-recovery-retiring' ? validateMutexRetiring : validateMutexRetired)(value);
      check(context.archive && context.proof && context.completion, 'Retirement publication requires ownership and terminal context');
      validateTerminalProof(context.proof); validateCompletion(context.completion, context.proof);
      const archive = validateOwnershipArchive({ ...context.archive, retirements: [...context.archive.retirements, value] });
      const retiring = archive.retiring?.payload;
      check(retiring && retiring.terminal_proof_hash === context.proof.hash && retiring.completion_hash === context.completion.hash &&
        same(retiring.terminal_journal, context.completion.payload.terminal_journal) &&
        retiring.final_manifest_hash === context.proof.payload.final_manifest.manifest_hash &&
        retiring.terminal_state_hash === context.proof.payload.after_state.state_hash, 'Retirement terminal binding mismatch');
      return value;
    }
    default: check(false, 'Unsupported evidence schema/kind');
  }
}

// Low-level foundation only. No Request dispatch, takeover, phase orchestration,
// state write, canonical write, History publication or action handler calls this.
// The IO dependency is the same trusted injection seam used by persistence.
export async function createEvidencePublisher(root, { io = fs } = {}) {
  const store = await createPersistence(root, { io });
  return Object.freeze({ publish: async (value, { gate, context = {} } = {}) => {
    await assertGateOwnership(gate, store.root);
    const original = JSON.parse(canonicalJson(value));
    context = JSON.parse(canonicalJson(context));
    validateEvidence(original, context);
    const path = evidencePath(original);
    if (await store.exists(path)) {
      const existing = await store.readJson(path, { strict: true });
      validateEvidence(existing, context);
      check(same(existing, original), 'Immutable evidence identity has different content');
      // A previous attempt may have published complete bytes but failed sync.
      // Reconfirm durability of those same bytes, without rewriting the artifact.
      let handle, phase = 'file_sync';
      try {
        handle = await io.open(await store.resolvePath(path), 'r');
        await handle.sync(); await handle.close(); handle = null;
        phase = 'directory_sync'; await store.syncDirectory(path.slice(0, path.lastIndexOf('/')));
      } catch (cause) {
        if (handle) { try { await handle.close(); } catch { /* preserve original failure */ } }
        throw new RepositoryError('PERSISTENCE_SYNC_FAILED', 'Existing evidence durability unconfirmed',
          { path, phase, published: true, cause });
      }
    } else {
      await store.createJsonExclusive(path, original);
    }
    const reread = await readPublishedJson(store, path);
    validateEvidence(reread, context);
    check(same(reread, original), 'Evidence readback differs');
    await assertGateOwnership(gate, store.root);
    return reread;
  } });
}

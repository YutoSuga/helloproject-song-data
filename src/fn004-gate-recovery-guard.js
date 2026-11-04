import { RepositoryError } from './persistence.js';
import { readRecoveryArchive } from './fn004-recovery-archive.js';
import { validateTerminalProof, validateCompletion } from './fn004-terminal-evidence.js';
import { same, check, uuid } from './fn004-evidence-types.js';
import { validateBootstrapRecord } from './fn004-state.js';

// Readonly structural gate guard. Historical sealed manifests need not equal
// current canonical after a later legitimate edit/transaction. Domain reader
// state/History/canonical guards remain independently required.
export async function assertNormalRecoveryClear(store, io) {
  if (await store.exists('staging/.fn004-recovery.lock')) throw new RepositoryError('GATE_BUSY', 'Recovery barrier prevents normal gate acquisition');
  if (!await store.exists('staging/recovery-ownership')) return;
  try {
    const bootstrap = validateBootstrapRecord(await store.readJson('staging/fn004-bootstrap.json', { strict: true }));
    for (const tx of await io.readdir(await store.resolvePath('staging/recovery-ownership'))) {
      check(tx.startsWith('tx_') && uuid(tx.slice(3)), 'Unknown ownership archive');
      const {anchor,archive,retirements}=await readRecoveryArchive(store,io,tx);
      check(archive.state === 'SEALED' && anchor.payload.binding.transaction_id === tx, 'Unsealed Recovery prevents normal acquisition');
      const b = anchor.payload.binding;
      check(b.repository_instance_id === bootstrap.payload.repository_instance_id && b.bootstrap_hash === bootstrap.bootstrap_hash,
        'Ownership archive belongs to a different repository lineage');
      const proof = validateTerminalProof(await store.readJson(`staging/transaction-proofs/${tx}.json`, { strict: true }));
      const completion = validateCompletion(await store.readJson(`staging/apply-requests/completions/${b.request_id}.json`, { strict: true }), proof);
      check(same(proof.payload.binding, b), 'Sealed ownership has a foreign proof');
      for (const record of retirements.filter(value => value.kind === 'fn004-recovery-retiring')) {
        const p = record.payload;
        check(p.terminal_proof_hash === proof.hash && p.completion_hash === completion.hash &&
          same(p.terminal_journal, completion.payload.terminal_journal) && p.final_manifest_hash === proof.payload.final_manifest.manifest_hash &&
          p.terminal_state_hash === proof.payload.after_state.state_hash, 'Retirement lacks exact terminal evidence');
      }
    }
  } catch (cause) {
    throw new RepositoryError('GATE_CORRUPT', 'Recovery archive cannot be proven sealed', { path: 'staging/recovery-ownership', cause });
  }
}

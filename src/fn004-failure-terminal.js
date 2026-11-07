import { recoveryEnvelope } from './fn004-recovery-authority.js';
import { validateTerminalProof, validateCompletion } from './fn004-terminal-evidence.js';
import { validateEvidence } from './fn004-evidence-persistence.js';
import { sha256 } from './canonical-hash.js';
import { check } from './fn004-evidence-types.js';

export function failureProof(args) {
  check(!args.chain.head || ['ABORTED','ROLLED_BACK'].includes(args.chain.head.payload.phase), 'Expected failure terminal');
  return terminalProof(args);
}
export function terminalProof({ binding, owner, inputs, intent, chain, authority, ended_at, histories, diagnostics = [] }) {
  const terminal = chain.head?.payload;
  check(!terminal || ['ABORTED','ROLLED_BACK','COMPLETED'].includes(terminal.phase), 'Proof requires a terminal journal');
  const value = recoveryEnvelope('fn004-terminal-proof', { binding, owner, inputs, intent, journal: chain.entries,
    phase: terminal?.phase ?? 'ABORTED', before_state: owner.payload.before_state,
    consumed_state: terminal?.id_consumed ? intent.payload.expected_consumed_state : null,
    after_state: terminal?.terminal_state ?? owner.payload.before_state, final_manifest: terminal?.phase === 'COMPLETED' ? intent.payload.target_manifest : owner.payload.original_manifest,
    history: terminal?.phase === 'COMPLETED' ? chain.decision.record : null, authority: terminal?.authority ?? authority, ended_at: terminal?.recorded_at ?? ended_at, diagnostics });
  return validateTerminalProof(value, { histories });
}
export function failureCompletion(proof) {
  check(proof.payload.phase !== 'COMPLETED', 'Expected failure Completion');
  return terminalCompletion(proof);
}
export function terminalCompletion(proof) {
  const p = proof.payload, head = p.journal.at(-1);
  return validateCompletion(recoveryEnvelope('fn004-completion', { binding: p.binding, phase: p.phase, proof_hash: proof.hash,
    terminal_journal: head ? { sequence: head.payload.sequence, entry_hash: head.hash } : null,
    ended_at: p.ended_at, diagnostics: p.diagnostics, result: p.history ? { apply_id: p.binding.apply_id, record_hash: p.history.record_hash } : null }), proof);
}
export function retiringEvidence({ binding, session, snapshot: s, barrierRaw, archive, at }) {
  const value = recoveryEnvelope('fn004-recovery-retiring', { binding, mutex_id: session.anchor.payload.mutex_id,
    owner: { sequence: s.archive.sequence, owner_hash: session.head.hash },
    barrier: { artifact: session.barrier, byte_length: barrierRaw.length, sha256: sha256(barrierRaw), ...session.barrierIdentity },
    canonical_gate: s.gate, terminal_proof_hash: s.proof.hash, completion_hash: s.completion.hash,
    terminal_journal: s.completion.payload.terminal_journal, final_manifest_hash: s.proof.payload.final_manifest.manifest_hash,
    terminal_state_hash: s.proof.payload.after_state.state_hash, retiring_at: at });
  validateEvidence(value, { archive, proof: s.proof, completion: s.completion }); return value;
}
export function retiredEvidence({ binding, session, retiring, snapshot: s, archive, at }) {
  const value = recoveryEnvelope('fn004-recovery-retired', { binding, mutex_id: session.anchor.payload.mutex_id,
    owner: retiring.payload.owner, retiring_hash: retiring.hash, canonical_gate_released: true, retired_at: at });
  validateEvidence(value, { archive, proof: s.proof, completion: s.completion }); return value;
}

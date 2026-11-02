import { hashCanonicalJson } from './canonical-hash.js';
import { closed, integrity } from './fn004-approval-schema.js';

export const EVIDENCE_KINDS = Object.freeze([
  'fn004-owner', 'fn004-intent', 'fn004-journal', 'fn004-completion',
  'fn004-terminal-proof', 'fn004-recovery-mutex', 'fn004-recovery-claim',
  'fn004-recovery-barrier', 'fn004-recovery-retiring', 'fn004-recovery-retired'
]);

// Projection only: domain validity belongs to the corresponding validator.
export function evidenceHashV1(kind, payload) {
  if (!EVIDENCE_KINDS.includes(kind)) integrity('Unsupported evidence kind');
  try { return hashCanonicalJson({ schema_version: 1, kind, payload }); }
  catch (cause) { if (cause instanceof TypeError) integrity('Evidence is outside the strict JSON domain'); throw cause; }
}

export function validateEvidenceEnvelope(artifact, kind) {
  closed(artifact, ['schema_version', 'kind', 'payload', 'hash']);
  if (artifact.schema_version !== 1 || artifact.kind !== kind ||
      !EVIDENCE_KINDS.includes(kind) || typeof artifact.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(artifact.hash) ||
      artifact.hash !== evidenceHashV1(kind, artifact.payload)) {
    integrity('Unsupported evidence envelope or hash mismatch');
  }
  return artifact.payload;
}

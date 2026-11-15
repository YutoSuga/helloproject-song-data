// Derived namespace only. Never add this class to transaction ArtifactRefs.
const prefix = 'staging/.fn004-gate-candidate.tmp-';
export const GATE_PATH = 'staging/.fn004.lock';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isGateCandidate(path) {
  return typeof path === 'string' && path.length === prefix.length + 36 &&
    path.startsWith(prefix) && uuid.test(path.slice(prefix.length));
}
export const gateCandidatePath = lockId => `${prefix}${lockId}`;

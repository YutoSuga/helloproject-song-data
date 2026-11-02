import { canonicalJson, sha256 } from './canonical-hash.js';
import { RepositoryError } from './persistence.js';
import { validateEvidenceEnvelope } from './fn004-evidence-hash.js';
import { closed, check, hash, integer, uuid, binding, actor, processOwner, gateWitness,
  exitProof, timestamp, compareTimestamps, nullable, same, journalRef, decimal } from './fn004-evidence-types.js';

function schema(fn) {
  try { return fn(); }
  catch (cause) {
    if (cause instanceof RepositoryError && cause.code === 'INTEGRITY_CONFLICT') {
      throw new RepositoryError('GATE_CORRUPT', 'Invalid Recovery ownership evidence', { cause });
    }
    throw cause;
  }
}

function transfer(previous, current) {
  check(previous.platform === 'linux' && current.platform === 'linux' && previous.process_start_id !== null &&
    current.process_start_id !== null && ['hostname', 'boot_id', 'pid_namespace'].every(key =>
      previous[key] !== null && previous[key] === current[key]), 'Unsupported/ambiguous termination profile');
}

const gateOwner = gate => Object.fromEntries(['process_id', 'hostname', 'platform', 'process_instance_id',
  'process_started_at', 'process_start_id', 'boot_id', 'pid_namespace'].map(key => [key, gate.metadata[key]]));

export function validateMutexAnchor(value) {
  return schema(() => {
    const p = validateEvidenceEnvelope(value, 'fn004-recovery-mutex');
    closed(p, ['mutex_id', 'binding', 'gate', 'owner', 'operator', 'predecessor_exit',
      'observed_state_hash', 'acquired_at']);
    common(p); nullable(p.predecessor_exit, exitProof);
    if (p.predecessor_exit !== null) {
      check(p.gate !== null && same(p.predecessor_exit.owner, gateOwner(p.gate)) &&
        compareTimestamps(p.predecessor_exit.checked_at, p.acquired_at) <= 0, 'Anchor predecessor/termination mismatch');
      transfer(p.predecessor_exit.owner, p.owner);
    } else check(p.gate === null, 'Missing predecessor termination proof');
    return value;
  });
}

function common(p) {
  check(uuid(p.mutex_id) && hash(p.observed_state_hash), 'Invalid mutex identity/observation');
  binding(p.binding); processOwner(p.owner); actor(p.operator);
  check(p.operator.assurance === 'local_process', 'Recovery requires a local operator');
  nullable(p.gate, gateWitness); timestamp(p.acquired_at);
}

export function validateMutexClaim(value) {
  return schema(() => {
    const p = validateEvidenceEnvelope(value, 'fn004-recovery-claim');
    closed(p, ['mutex_id', 'binding', 'sequence', 'previous_claim_hash', 'owner', 'operator',
      'gate', 'predecessor_exit', 'observed_state_hash', 'acquired_at']);
    common(p); exitProof(p.predecessor_exit);
    transfer(p.predecessor_exit.owner, p.owner);
    check(integer(p.sequence, 1) && hash(p.previous_claim_hash) &&
      compareTimestamps(p.predecessor_exit.checked_at, p.acquired_at) <= 0, 'Invalid claim predecessor');
    return value;
  });
}

export function validateMutexProof(value) {
  return schema(() => {
    closed(value, ['anchor', 'claims']); validateMutexAnchor(value.anchor);
    check(Array.isArray(value.claims), 'Missing complete claim chain');
    let previous = value.anchor;
    for (let i = 0; i < value.claims.length; i++) {
      const claim = validateMutexClaim(value.claims[i]), p = claim.payload;
      check(p.sequence === i + 1 && p.previous_claim_hash === previous.hash &&
        p.mutex_id === value.anchor.payload.mutex_id && same(p.binding, value.anchor.payload.binding) &&
        same(p.predecessor_exit.owner, previous.payload.owner) &&
        compareTimestamps(previous.payload.acquired_at, p.acquired_at) <= 0,
      'Recovery claim gap/fork/binding mismatch');
      transfer(previous.payload.owner, p.owner);
      previous = claim;
    }
    return value;
  });
}

export function validateMutexBarrier(value) {
  return schema(() => {
    const p = validateEvidenceEnvelope(value, 'fn004-recovery-barrier');
    closed(p, ['binding', 'mutex_id', 'anchor_hash', 'barrier_id']); binding(p.binding);
    check(uuid(p.mutex_id) && uuid(p.barrier_id) && hash(p.anchor_hash), 'Invalid barrier identity');
    return value;
  });
}

function ownerRef(value) {
  closed(value, ['sequence', 'owner_hash']);
  check(integer(value.sequence) && hash(value.owner_hash), 'Invalid ownership reference');
}

function barrierWitness(value) {
  closed(value, ['artifact', 'byte_length', 'sha256', 'device', 'inode']);
  validateMutexBarrier(value.artifact);
  const bytes = Buffer.from(canonicalJson(value.artifact) + '\n');
  check(value.byte_length === bytes.length && value.sha256 === sha256(bytes) &&
    ['device', 'inode'].every(key => decimal(value[key])),
  'Invalid barrier witness bytes/inode');
}

export function validateMutexRetiring(value) {
  return schema(() => {
    const p = validateEvidenceEnvelope(value, 'fn004-recovery-retiring');
    closed(p, ['binding', 'mutex_id', 'owner', 'barrier', 'canonical_gate', 'terminal_proof_hash',
      'completion_hash', 'terminal_journal', 'final_manifest_hash', 'terminal_state_hash', 'retiring_at']);
    binding(p.binding); ownerRef(p.owner); barrierWitness(p.barrier); gateWitness(p.canonical_gate);
    nullable(p.terminal_journal, journalRef); timestamp(p.retiring_at);
    check(uuid(p.mutex_id) && ['terminal_proof_hash', 'completion_hash', 'final_manifest_hash',
      'terminal_state_hash'].every(key => hash(p[key])) &&
      same(p.binding, p.barrier.artifact.payload.binding) && p.mutex_id === p.barrier.artifact.payload.mutex_id,
    'Invalid retiring binding');
    return value;
  });
}

export function validateMutexRetired(value) {
  return schema(() => {
    const p = validateEvidenceEnvelope(value, 'fn004-recovery-retired');
    closed(p, ['binding', 'mutex_id', 'owner', 'retiring_hash', 'canonical_gate_released', 'retired_at']);
    binding(p.binding); ownerRef(p.owner); timestamp(p.retired_at);
    check(uuid(p.mutex_id) && hash(p.retiring_hash) && p.canonical_gate_released === true,
      'Invalid retired evidence');
    return value;
  });
}

// Pure archive validation. This never probes the OS or creates an ownership lease.
export function validateOwnershipArchive({ anchor, claims, retirements, barrier }) {
  return schema(() => {
    claims.forEach(validateMutexClaim);
    const chain = [...claims].sort((a, b) => a.payload.sequence - b.payload.sequence);
    validateMutexProof({ anchor, claims: chain });
    const owners = [anchor, ...chain], records = new Map();
    for (const record of retirements) {
      const retiring = record.kind === 'fn004-recovery-retiring';
      (retiring ? validateMutexRetiring : validateMutexRetired)(record);
      const p = record.payload, owner = owners[p.owner.sequence];
      check(owner && owner.hash === p.owner.owner_hash && same(p.binding, anchor.payload.binding) &&
        p.mutex_id === anchor.payload.mutex_id, 'Retirement without exact owner');
      const key = `${p.owner.sequence}/${record.kind}`;
      check(!records.has(key), 'Duplicate retirement'); records.set(key, record);
      if (retiring) check(p.barrier.artifact.payload.anchor_hash === anchor.hash,
        'Retirement refers to another anchor');
    }
    for (const record of retirements) {
      if (record.kind !== 'fn004-recovery-retired') continue;
      const p = record.payload, retiring = records.get(`${p.owner.sequence}/fn004-recovery-retiring`);
      check(retiring && retiring.hash === p.retiring_hash && same(retiring.payload.owner, p.owner) &&
        compareTimestamps(retiring.payload.retiring_at, p.retired_at) <= 0, 'Retired without exact Retiring');
    }
    if (barrier !== null) {
      validateMutexBarrier(barrier);
      check(barrier.payload.anchor_hash === anchor.hash && same(barrier.payload.binding, anchor.payload.binding) &&
        barrier.payload.mutex_id === anchor.payload.mutex_id, 'Barrier does not bind archive');
    }
    const witnesses = retirements.filter(record => record.kind === 'fn004-recovery-retiring').map(record => record.payload.barrier);
    if (witnesses.length) check(witnesses.every(witness => same(witness, witnesses[0])), 'Barrier identity changed within lineage');
    const sequence = chain.length, head = owners[sequence];
    const retiring = records.get(`${sequence}/fn004-recovery-retiring`) ?? null;
    const retired = records.get(`${sequence}/fn004-recovery-retired`) ?? null;
    if (barrier === null) check(retired !== null, 'Unsealed owner lost its barrier');
    if (retiring && barrier) check(same(retiring.payload.barrier.artifact, barrier), 'Retirement barrier mismatch');
    return { chain, head, sequence, retiring, retired,
      state: retired ? (barrier === null ? 'SEALED' : 'RETIRED') : retiring ? 'RETIRING' : 'ACTIVE' };
  });
}

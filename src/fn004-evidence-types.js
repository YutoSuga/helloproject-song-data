import { canonicalJson, sha256 } from './canonical-hash.js';
import { closed, integrity, actor, requestId, approvalId, UUID_PATTERN } from './fn004-approval-schema.js';
import { validateDecisionIdentity } from './fn004-decision-core.js';
import { isFn004Timestamp, validateFn004State, validateManifest } from './fn004-state.js';
import { compareTimestamps, same } from './fn004-history-schema.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { RepositoryError } from './persistence.js';

export { closed, actor, same, validateFn004State as state, validateManifest as manifest, compareTimestamps };
export const check = (value, message) => { if (!value) integrity(message); };
export const hash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
export const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const uuid = value => typeof value === 'string' && value.length === 36 && new RegExp(`^${UUID_PATTERN}$`).test(value);
export const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && !/[\r\n]/.test(value);
export const timestamp = value => check(isFn004Timestamp(value), 'Invalid evidence timestamp');
export const nullable = (value, validate) => { if (value !== null) validate(value); };
export const PHASES = Object.freeze(['PREPARING', 'PREPARED', 'COMMITTING', 'COMMIT_DECIDED',
  'HISTORY_COMMITTED', 'COMPLETED', 'ROLLING_BACK', 'ROLLED_BACK', 'ABORTED', 'RECOVERY_REQUIRED']);
export const TERMINAL_PHASES = Object.freeze(['COMPLETED', 'ROLLED_BACK', 'ABORTED']);
export const COMMIT_PATHS = Object.freeze(['works', 'creators', 'artists', 'releases', 'songs',
  'song_artists', 'song_creators', 'song_performers', 'release_tracks'].map(name =>
  CANONICAL_TABLES.find(table => table.name === name).path));

export function ordered(values, key = value => value) {
  check(Array.isArray(values), 'Expected evidence array');
  values.forEach((value, index) => check(index === 0 || key(values[index - 1]) < key(value),
    'Duplicate or noncanonical evidence ordering'));
}

export function observedPath(value) {
  if (!(typeof value === 'string' && value.length > 0 && !value.includes('\\') && !/^[a-zA-Z]:/.test(value) &&
    !value.startsWith('/') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..'))) throw new RepositoryError('PATH_UNSAFE', 'Unsafe evidence path', { path: value });
}

export function binding(value) {
  closed(value, ['repository_instance_id', 'bootstrap_hash', 'transaction_id', 'request_id',
    'apply_id', 'decision', 'plan_id', 'plan_hash', 'approval_id', 'approval_hash',
    'request_payload_hash', 'receipt_hash', 'actor']);
  check(typeof value.repository_instance_id === 'string' && uuid(value.repository_instance_id.slice(5)) &&
    value.repository_instance_id.startsWith('repo_') && typeof value.transaction_id === 'string' &&
    value.transaction_id.startsWith('tx_') && uuid(value.transaction_id.slice(3)) &&
    value.apply_id === `apply_${value.transaction_id.slice(3)}` && requestId(value.request_id) &&
    approvalId(value.approval_id) && value.plan_id === `ap_${value.plan_hash}` &&
    ['bootstrap_hash', 'plan_hash', 'approval_hash', 'request_payload_hash', 'receipt_hash']
      .every(key => hash(value[key])), 'Invalid evidence Binding');
  validateDecisionIdentity(value.decision);
  actor(value.actor);
}

export function processOwner(value) {
  closed(value, ['process_id', 'hostname', 'platform', 'process_instance_id', 'process_started_at',
    'process_start_id', 'boot_id', 'pid_namespace']);
  check(integer(value.process_id, 1) && nonempty(value.hostname) && nonempty(value.platform) &&
    uuid(value.process_instance_id) && ['process_start_id', 'boot_id', 'pid_namespace']
      .every(key => value[key] === null || nonempty(value[key])), 'Invalid process identity');
  timestamp(value.process_started_at);
}

export function gateWitness(value) {
  closed(value, ['metadata', 'byte_length', 'sha256', 'device', 'inode']);
  const m = value.metadata;
  const processKeys = ['process_id', 'hostname', 'platform', 'process_instance_id',
    'process_started_at', 'process_start_id', 'boot_id', 'pid_namespace'];
  closed(m, ['schema_version', 'lock_id', 'root', 'operation', 'mode', 'started_at', 'actor', ...processKeys]);
  processOwner(Object.fromEntries(processKeys.map(key => [key, m[key]])));
  check(m.schema_version === 1 && uuid(m.lock_id) && nonempty(m.root) && nonempty(m.operation) &&
    m.mode === 'exclusive' && (m.actor === null || typeof m.actor === 'string'), 'Invalid gate metadata');
  timestamp(m.started_at);
  const bytes = Buffer.from(canonicalJson(m) + '\n');
  check(value.byte_length === bytes.length && value.sha256 === sha256(bytes) &&
    ['device', 'inode'].every(key => decimal(value[key])),
  'Gate witness does not bind exact metadata bytes/inode');
}

export function exitProof(value) {
  closed(value, ['owner', 'checked_at', 'status']);
  processOwner(value.owner);
  timestamp(value.checked_at);
  check(value.status === 'exited', 'Invalid termination proof status');
}

export function journalRef(value) {
  closed(value, ['sequence', 'entry_hash']);
  check(integer(value.sequence, 1) && hash(value.entry_hash), 'Invalid journal reference');
}

export function artifactRef(value) {
  closed(value, ['path', 'byte_length', 'sha256']);
  observedPath(value.path);
  check(integer(value.byte_length) && hash(value.sha256), 'Invalid artifact reference');
}

export function pathSubsequence(paths, all, { prefix = false, reverse = false } = {}) {
  check(Array.isArray(paths) && new Set(paths).size === paths.length, 'Invalid progress array');
  const order = reverse ? [...all].reverse() : all;
  let last = -1;
  for (const path of paths) {
    const index = order.indexOf(path);
    check(index > last && (!prefix || index === last + 1), 'Invalid progress order');
    last = index;
  }
}

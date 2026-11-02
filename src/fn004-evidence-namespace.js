import { CANONICAL_TABLES } from './canonical-schema.js';
import { UUID_PATTERN } from './fn004-approval-schema.js';
import { check, observedPath, COMMIT_PATHS } from './fn004-evidence-types.js';
import { RepositoryError } from './persistence.js';

const fixed = new Set(['staging/fn004-bootstrap.json', 'staging/fn004-state.json', 'staging/decisions.json',
  'staging/song-candidates.json', 'staging/.fn004.lock', 'staging/.fn004-recovery.lock', ...CANONICAL_TABLES.map(t => t.path)]);
const tableNames = CANONICAL_TABLES.map(table => table.path.slice(5));
const writableNames = COMMIT_PATHS.map(path => path.slice(5));
const txRoot = `staging/transactions/tx_${UUID_PATTERN}`;
const archiveRoot = `staging/recovery-ownership/tx_${UUID_PATTERN}`;
const patterns = [
  `staging/apply-plans/ap_[0-9a-f]{64}\\.json`,
  `staging/apply-approvals/apr_${UUID_PATTERN}\\.json`,
  `staging/apply-approvals/invalidations/ainv_${UUID_PATTERN}\\.json`,
  `staging/apply-requests/(?:completions/)?${UUID_PATTERN}\\.json`,
  `staging/apply-history/apply_${UUID_PATTERN}\\.json`,
  `staging/transaction-proofs/tx_${UUID_PATTERN}\\.json`,
  `${txRoot}/(?:owner|intent|transaction|plan|decision-snapshot|approval|request)\\.json`,
  `${txRoot}/journal/(?:[0-9]{6}|[1-9][0-9]{6,})\\.json`,
  `${txRoot}/backup/fn004-state\\.json`, `${txRoot}/temp/apply-history\\.json`,
  `${txRoot}/backup/data/(?:${tableNames.map(n => n.replace('.', '\\.')).join('|')})`,
  `${txRoot}/(?:temp|restore)/data/(?:${writableNames.map(n => n.replace('.', '\\.')).join('|')})`,
  `${archiveRoot}/anchor\\.json`, `${archiveRoot}/claims/(?:[0-9]{6}|[1-9][0-9]{6,})\\.json`,
  `${archiveRoot}/retirements/(?:[0-9]{6}|[1-9][0-9]{6,})\\.(?:retiring|retired)\\.json`
].map(pattern => new RegExp(`^(?:${pattern})$`));
const directories = [
  'data', 'staging', 'staging/apply-plans', 'staging/apply-approvals', 'staging/apply-approvals/invalidations',
  'staging/apply-requests', 'staging/apply-requests/completions', 'staging/apply-history',
  'staging/transaction-proofs', 'staging/transactions', 'staging/recovery-ownership'
];
const directoryPatterns = [txRoot, `${txRoot}/(?:journal|backup|temp|restore)`,
  `${txRoot}/(?:backup|temp|restore)/data`, archiveRoot, `${archiveRoot}/(?:claims|retirements)`]
  .map(pattern => new RegExp(`^(?:${pattern})$`));

export function publisherTarget(path) {
  const slash = path.lastIndexOf('/'), name = path.slice(slash + 1);
  const match = new RegExp(`^\\.fn004-(.+)\\.tmp-(${UUID_PATTERN})$`).exec(name);
  return match ? path.slice(0, slash + 1) + match[1] : null;
}

export function isKnownEvidenceFile(path) {
  return fixed.has(path) || patterns.some(pattern => pattern.test(path));
}

export function validateEvidenceNamespace(files) {
  for (const file of files) {
    observedPath(file.path);
    if (file.kind === 'symlink' || file.kind === 'other') throw new RepositoryError('PATH_UNSAFE', 'Nonregular evidence namespace entry', { path: file.path });
    if (file.kind === 'directory' || file.kind === 'missing' && (directories.includes(file.path) || directoryPatterns.some(pattern => pattern.test(file.path)))) check(directories.includes(file.path) || directoryPatterns.some(pattern => pattern.test(file.path)), 'Unknown evidence directory');
    else check(isKnownEvidenceFile(file.path) || isKnownEvidenceFile(publisherTarget(file.path)), 'Unknown evidence file');
  }
}

import { CANONICAL_TABLES, CANONICAL_SCHEMA_VERSION } from "./canonical-schema.js";
import { isCanonicalDate } from "./canonical-validator.js";
import { canonicalJson, hashCanonicalJson } from "./canonical-hash.js";
import { ID_NAMESPACES, maximumMaps } from "./fn004-id-audit.js";
import { RepositoryError } from "./persistence.js";

export const RULE_VERSIONS = Object.freeze({ canonical_schema: CANONICAL_SCHEMA_VERSION, canonical_validator: 1,
  canonical_manifest: 1, id_namespace: 1, git_id_audit: 1, external_declaration: 1, bootstrap: 1, state: 1,
  canonical_json: "rfc8785", hash_algorithm: "sha256" });
export const DECLARATION_STATEMENT = "known_used_id_upper_bounds_including_outside_authoritative_history";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const repoId = new RegExp(`^repo_${uuid}$`), txId = new RegExp(`^tx_${uuid}$`), applyId = new RegExp(`^apply_${uuid}$`);
const hash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value) => typeof value === "string" && value.trim().length > 0;
const equal = (a, b) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
function demand(condition, code, message, details) { if (!condition) throw new RepositoryError(code, message, details); }
function shape(value, required, code, optional = []) {
  demand(value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) && required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), code, "Unsupported object fields or type");
}
export function validateNamespaceMap(value, code = "STATE_HIGH_WATER_INVALID") {
  shape(value, ID_NAMESPACES, code);
  demand(ID_NAMESPACES.every((key) => integer(value[key], 0, 99999)), code, "Invalid namespace upper bound");
  return value;
}
export function validateActor(value, code = "BOOTSTRAP_CORRUPT") {
  shape(value, ["id", "assurance"], code);
  demand(text(value.id) && value.assurance === "local_process", code, "Explicit local operator identity required");
  return value;
}
function timestamp(value) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return Boolean(m && isCanonicalDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +m[4] < 60 && (m[5] === "Z" || (+m[6] < 24 && +m[7] < 60)));
}
function rules(value, code) { demand(equal(value, RULE_VERSIONS), code, "Unsupported audit rule versions"); }

export function validateExternalDeclaration(value) {
  const code = "EXTERNAL_DECLARATION_INVALID";
  shape(value, ["schema_version", "namespaces", "statement", "evidence"], code, ["note"]);
  validateNamespaceMap(value.namespaces, code);
  demand(value.schema_version === 1 && value.statement === DECLARATION_STATEMENT && Array.isArray(value.evidence) &&
    (!Object.hasOwn(value, "note") || typeof value.note === "string"), code, "Invalid external declaration");
  for (const evidence of value.evidence) {
    shape(evidence, ["kind", "value"], code);
    demand(["url", "human_note"].includes(evidence.kind) && text(evidence.value), code, "Invalid audit evidence");
    if (evidence.kind === "url") {
      let valid = false;
      try { const url = new URL(evidence.value); valid = /^https:\/\//.test(evidence.value) && !/[\s\\]/.test(evidence.value) && Boolean(url.hostname); } catch { /* rejected below */ }
      demand(valid, code, "Evidence URL must be absolute HTTPS");
    }
  }
  // Enforce the same JSON domain as every identity hash (including notes).
  try { canonicalJson(value); } catch (cause) { throw new RepositoryError(code, "Declaration is outside the canonical JSON domain", { cause }); }
  return value;
}

export function resultingHighWater(current, historical, declaration) {
  validateExternalDeclaration(declaration);
  validateNamespaceMap(current, "BOOTSTRAP_AUDIT_INCOMPLETE");
  validateNamespaceMap(historical, "BOOTSTRAP_AUDIT_INCOMPLETE");
  const known = maximumMaps(current, historical);
  const conflicts = ID_NAMESPACES.filter((key) => declaration.namespaces[key] < known[key]);
  demand(!conflicts.length, "EXTERNAL_DECLARATION_CONTRADICTION", "Declaration is below known canonical usage", {
    diagnostics: conflicts.map((key) => ({ code: "EXTERNAL_DECLARATION_CONTRADICTION", severity: "error", key,
      known_max: known[key], declared_max: declaration.namespaces[key], message: "Declared upper bound is below known usage" }))
  });
  return maximumMaps(current, historical, declaration.namespaces);
}

export function createAuditPayload(snapshot, historical, declaration) {
  // Maxima are supplied by the schema-based audit; this function is pure.
  const payload = { audit_schema_version: 1, canonical_manifest_hash: snapshot.manifest.manifest_hash,
    git: historical.git, current_maxima: snapshot.current_maxima, historical_maxima: historical.maxima,
    external_declaration: declaration,
    resulting_high_water_marks: resultingHighWater(snapshot.current_maxima, historical.maxima, declaration), rule_versions: RULE_VERSIONS };
  validateAuditPayload(payload);
  return structuredClone(payload);
}

export function validateAuditPayload(value) {
  const code = "BOOTSTRAP_CORRUPT";
  shape(value, ["audit_schema_version", "canonical_manifest_hash", "git", "current_maxima", "historical_maxima", "external_declaration", "resulting_high_water_marks", "rule_versions"], code);
  demand(value.audit_schema_version === 1 && hash(value.canonical_manifest_hash), code, "Invalid audit identity");
  rules(value.rule_versions, code);
  const git = value.git;
  shape(git, ["authoritative_ref", "audited_head", "object_format", "history_scope", "history_rule_version", "shallow", "complete", "reachable_commit_count", "root_commits"], code);
  const sha = git.object_format === "sha1" ? /^[0-9a-f]{40}$/ : git.object_format === "sha256" ? /^[0-9a-f]{64}$/ : null;
  demand(git.authoritative_ref === "origin/main" && sha && matches(sha, git.audited_head) && git.history_scope === "all_reachable_parents" &&
    git.history_rule_version === 1 && git.shallow === false && git.complete === true && integer(git.reachable_commit_count, 1) &&
    Array.isArray(git.root_commits) && git.root_commits.length > 0 && git.root_commits.length <= git.reachable_commit_count &&
    git.root_commits.every((id, i, all) => matches(sha, id) && (i === 0 || all[i - 1] < id)), code, "Invalid complete Git audit identity");
  validateNamespaceMap(value.resulting_high_water_marks, code);
  demand(equal(value.resulting_high_water_marks, resultingHighWater(value.current_maxima, value.historical_maxima, value.external_declaration)), code, "Audit maxima mismatch");
  return value;
}

function validateManifest(value) {
  const code = "BOOTSTRAP_CORRUPT";
  shape(value, ["schema_version", "files", "manifest_hash"], code);
  const paths = CANONICAL_TABLES.map((table) => table.path).sort();
  demand(value.schema_version === 1 && hash(value.manifest_hash) && Array.isArray(value.files) && value.files.length === paths.length, code, "Invalid baseline manifest");
  value.files.forEach((file, index) => {
    shape(file, ["path", "byte_length", "sha256"], code);
    demand(file.path === paths[index] && integer(file.byte_length) && hash(file.sha256), code, "Invalid baseline manifest entry");
  });
  demand(hashCanonicalJson(value.files) === value.manifest_hash, code, "Manifest hash mismatch");
}

export function validateBootstrapRecord(record) {
  const code = "BOOTSTRAP_CORRUPT";
  try {
    shape(record, ["schema_version", "payload", "bootstrap_hash", "audit_payload", "canonical_manifest", "metadata"], code);
    demand(record.schema_version === 1 && hash(record.bootstrap_hash), code, "Invalid bootstrap record version/hash");
    validateAuditPayload(record.audit_payload);
    validateManifest(record.canonical_manifest);
    shape(record.metadata, ["initialized_at"], code);
    demand(timestamp(record.metadata.initialized_at), code, "Invalid bootstrap timestamp");
    const p = record.payload, a = record.audit_payload;
    shape(p, ["bootstrap_schema_version", "repository_instance_id", "audit_hash", "canonical_manifest_hash", "authoritative_git_ref", "audited_git_head", "high_water_marks", "rule_versions", "operator_confirmation"], code);
    shape(p.operator_confirmation, ["actor", "purpose", "expected_audit_hash"], code);
    validateActor(p.operator_confirmation.actor, code);
    validateNamespaceMap(p.high_water_marks, code);
    rules(p.rule_versions, code);
    demand(p.bootstrap_schema_version === 1 && matches(repoId, p.repository_instance_id) && p.audit_hash === hashCanonicalJson(a) &&
      p.canonical_manifest_hash === record.canonical_manifest.manifest_hash && p.canonical_manifest_hash === a.canonical_manifest_hash &&
      p.authoritative_git_ref === a.git.authoritative_ref && p.audited_git_head === a.git.audited_head && equal(p.high_water_marks, a.resulting_high_water_marks) &&
      equal(p.rule_versions, a.rule_versions) && p.operator_confirmation.purpose === "bootstrap_initialize" &&
      p.operator_confirmation.expected_audit_hash === p.audit_hash && hashCanonicalJson(p) === record.bootstrap_hash, code, "Bootstrap identity/hash binding mismatch");
    return record;
  } catch (cause) {
    if (cause.code === code) throw cause;
    throw new RepositoryError(code, "Invalid bootstrap record", { cause });
  }
}

export function stateContent(state) {
  const { state_hash, ...content } = state;
  return content;
}
export const hashState = (state) => hashCanonicalJson(stateContent(state));

export function validateFn004State(state) {
  const code = "STATE_CORRUPT";
  shape(state, ["schema_version", "repository_instance_id", "bootstrap_hash", "initialized_at", "generation", "baseline_manifest_hash", "high_water_marks", "allocation_events", "history", "pending_transaction", "state_hash"], code);
  validateNamespaceMap(state.high_water_marks);
  demand(state.schema_version === 1 && matches(repoId, state.repository_instance_id) && hash(state.bootstrap_hash) && timestamp(state.initialized_at) &&
    integer(state.generation) && hash(state.baseline_manifest_hash) && hash(state.state_hash), code, "Invalid state identity/version/type");
  demand(Array.isArray(state.allocation_events), code, "Invalid allocation event array");
  for (const event of state.allocation_events) {
    shape(event, ["transaction_id", "namespace", "first", "last"], code);
    demand(matches(txId, event.transaction_id) && ID_NAMESPACES.includes(event.namespace) && integer(event.first, 1, 99999) &&
      integer(event.last, event.first, 99999) && event.last <= state.high_water_marks[event.namespace], code, "Invalid allocation event");
  }
  shape(state.history, ["count", "head_hash", "last_apply_id"], code);
  demand(integer(state.history.count) && hash(state.history.head_hash) && (state.history.last_apply_id === null || matches(applyId, state.history.last_apply_id)) &&
    (state.pending_transaction === null || matches(txId, state.pending_transaction)), code, "Invalid History or pending transaction");
  demand(hashState(state) === state.state_hash, code, "State hash mismatch");
  return state;
}

export function validateBootstrapLink(record, state, { current, historical, previous } = {}) {
  validateBootstrapRecord(record);
  validateFn004State(state);
  const p = record.payload;
  demand(state.repository_instance_id === p.repository_instance_id && state.bootstrap_hash === record.bootstrap_hash &&
    state.baseline_manifest_hash === record.canonical_manifest.manifest_hash && state.initialized_at === record.metadata.initialized_at,
  "STATE_BOOTSTRAP_MISMATCH", "State and bootstrap lineage disagree");
  const lower = [p.high_water_marks, ...(current ? [current] : []), ...(historical ? [historical] : [])];
  if (previous) { validateFn004State(previous); lower.push(previous.high_water_marks); }
  demand(ID_NAMESPACES.every((key) => lower.every((map) => state.high_water_marks[key] >= map[key])), "STATE_HIGH_WATER_INVALID", "High-water marks are below proven usage");
  demand(!previous || state.generation >= previous.generation, "STATE_CORRUPT", "State generation decreased");
  // Later slices must prove non-genesis allocation/History chains before enabling
  // them. Schema validity alone is not proof of a finished transaction.
  demand(state.generation === 0 && state.allocation_events.length === 0 && state.pending_transaction === null &&
    state.history.count === 0 && state.history.head_hash === record.bootstrap_hash && state.history.last_apply_id === null,
  "BOOTSTRAP_INCOMPLETE", "Non-genesis state needs transaction/History verification");
  demand(equal(state.high_water_marks, p.high_water_marks), "STATE_HIGH_WATER_INVALID", "Unproven genesis high-water change");
  return { record, state };
}

export function createBootstrapRecords({ audit_payload, canonical_manifest, repository_instance_id, initialized_at, actor, expected_audit_hash }) {
  validateActor(actor);
  const payload = { bootstrap_schema_version: 1, repository_instance_id, audit_hash: hashCanonicalJson(audit_payload),
    canonical_manifest_hash: canonical_manifest.manifest_hash, authoritative_git_ref: audit_payload.git.authoritative_ref,
    audited_git_head: audit_payload.git.audited_head, high_water_marks: audit_payload.resulting_high_water_marks,
    rule_versions: audit_payload.rule_versions, operator_confirmation: { actor, purpose: "bootstrap_initialize", expected_audit_hash } };
  const record = { schema_version: 1, payload, bootstrap_hash: hashCanonicalJson(payload), audit_payload, canonical_manifest, metadata: { initialized_at } };
  const state = { schema_version: 1, repository_instance_id, bootstrap_hash: record.bootstrap_hash, initialized_at,
    generation: 0, baseline_manifest_hash: canonical_manifest.manifest_hash, high_water_marks: structuredClone(payload.high_water_marks),
    allocation_events: [], history: { count: 0, head_hash: record.bootstrap_hash, last_apply_id: null }, pending_transaction: null };
  state.state_hash = hashState(state);
  validateBootstrapLink(record, state);
  return structuredClone({ record, state });
}

import { applyPlanPath } from "./fn004-plan-path.js";
import { validateApplyPlan } from "./fn004-plan-validator.js";
import { readApplyHistoryDirectory, applyHistoryPath } from "./fn004-history-directory.js";
import { canonicalJson } from "./canonical-hash.js";
import { validateDecisionStore, assertImmutableDecisionStore } from "./fn004-decision-core.js";
import { createPersistence, RepositoryError } from "./persistence.js";
import { withCanonicalGate, assertGateOwnership } from "./fn004-gate.js";
import { CANONICAL_TABLES } from "./canonical-schema.js";
import { readCanonicalSnapshot } from "./canonical-snapshot.js";
import { inspectRuntimeState } from "./fn004-runtime-state.js";

const fixedArtifacts = new Set(["staging/decisions.json", "staging/fn004-state.json", "staging/fn004-bootstrap.json"]);
const artifactDirectories = new Set(["apply-approvals", "apply-requests", "transactions"]);
function artifactPath(path, { readonly = false } = {}) {
  if (readonly && typeof path === "string" && path.startsWith("staging/apply-history/") && path.endsWith(".json")) return applyHistoryPath(path.slice("staging/apply-history/".length, -5));
  const parts = typeof path === "string" ? path.split("/") : [];
  if (fixedArtifacts.has(path)) return path;
  if (parts[0] !== "staging" || !artifactDirectories.has(parts[1]) || parts.length < 3 ||
      parts.slice(2).some((part) => !/^[a-zA-Z0-9_-]+(?:\.json)?$/.test(part)) || !parts.at(-1).endsWith(".json")) {
    throw new RepositoryError("PATH_UNSAFE", "Not a known FN-004 JSON artifact path", { path });
  }
  return path;
}

// Only proven genesis or success-only History chains permit ordinary reads.
// Unknown transitions, pending work and cleanup continue to block reads.
async function assertReadableRuntime(store) {
  const result = await inspectRuntimeState(store);
  if (!["BOOTSTRAP_REQUIRED", "READY"].includes(result.status) || result.readiness === "cleanup_required") {
    throw new RepositoryError(result.status === "READY" ? "RECOVERY_REQUIRED" : result.status,
      "Runtime state blocks ordinary canonical reads", { ...(result.diagnostics.length ? { diagnostics: result.diagnostics } : {}), readiness: result.readiness });
  }
}

// Also used by legacy partial readers: holds one gate across their whole read,
// preserving their existing row shape/validation rather than strengthening it.
export async function withCanonicalRead({ root = process.cwd(), gate, fn }) {
  return withCanonicalGate({ root, gate, operation: "canonical_read", fn: async (lease) => {
    const store = await createPersistence(lease.root);
    await assertReadableRuntime(store);
    for (const schema of CANONICAL_TABLES) await store.resolvePath(schema.path);
    const result = await fn(lease.root, lease);
    await assertGateOwnership(lease);
    return result;
  } });
}

export async function createFn004Repository(root = process.cwd(), options = {}) {
  const store = await createPersistence(root, options);
  const decisionPath = "staging/decisions.json";
  const readDecisions = async () => {
    if (!await store.exists(decisionPath)) return { schema_version: 1, revisions: [] };
    return validateDecisionStore(await store.readJson(decisionPath, { strict: true }));
  };
  const writeDecisions = async (value, gate, exclusive = false) => {
    await assertGateOwnership(gate, store.root);
    value = JSON.parse(canonicalJson(value));
    validateDecisionStore(value);
    const exists = await store.exists(decisionPath);
    if (exists) assertImmutableDecisionStore(await readDecisions(), value);
    await assertGateOwnership(gate, store.root);
    if (exclusive || !exists) await store.createJsonExclusive(decisionPath, value);
    else await store.writeJsonAtomic(decisionPath, value);
  };
  const readPlan = async (id) => {
    const value = await store.readJson(applyPlanPath(id), { strict: true });
    validateApplyPlan(value);
    if (value.plan_id !== id) throw new RepositoryError("PLAN_INTEGRITY_CONFLICT", "Plan filename/identity mismatch");
    return value;
  };
  const savePlan = async (value, gate) => {
    await assertGateOwnership(gate, store.root);
    value = JSON.parse(canonicalJson(value)); validateApplyPlan(value);
    const path = applyPlanPath(value.plan_id);
    if (await store.exists(path)) {
      const existing = await readPlan(value.plan_id);
      if (canonicalJson(existing.payload) !== canonicalJson(value.payload)) throw new RepositoryError("PLAN_INTEGRITY_CONFLICT", "Immutable Plan payload differs");
      return existing; // generated_at is presentation metadata; keep the original.
    }
    await assertGateOwnership(gate, store.root);
    await store.createJsonExclusive(path, value);
    return value;
  };
  return Object.freeze({
    root: store.root,
    getApplyPlan: (id, { gate } = {}) => withCanonicalGate({ root: store.root, gate, operation: "plan_read", fn: () => readPlan(id) }),
    saveApplyPlan: (value, { gate } = {}) => savePlan(value, gate),
    readApplyHistoryDirectory: ({ gate } = {}) => withCanonicalGate({ root: store.root, gate, operation: "history_read", fn: () => readApplyHistoryDirectory(store, options) }),
    readDecisionStore: ({ gate } = {}) => withCanonicalGate({ root: store.root, gate, operation: "decision_read", fn: readDecisions }),
    writeDecisionStore: (value, { gate } = {}) => writeDecisions(value, gate),
    // Readonly, point-in-time snapshot. Release does not keep it current; any
    // later write must reacquire the gate and revalidate manifest preconditions.
    readCanonicalSnapshot: ({ gate } = {}) => withCanonicalRead({ root: store.root, gate, fn: async (resolvedRoot) => {
      const snapshot = await readCanonicalSnapshot(resolvedRoot);
      if (!snapshot.validation.ok) throw new RepositoryError("CANONICAL_INVALID", "Canonical validation failed", { diagnostics: snapshot.validation.diagnostics });
      return snapshot;
    } }),
    readJson: (path, { gate } = {}) => withCanonicalGate({ root: store.root, gate, operation: "runtime_read", fn: () => typeof path === "string" && path.startsWith("staging/apply-plans/") && path.endsWith(".json") ? readPlan(path.slice("staging/apply-plans/".length, -5)) : path === decisionPath ? readDecisions() : store.readJson(artifactPath(path, { readonly: true }), { strict: path.startsWith("staging/apply-history/") }) }),
    writeJsonAtomic: async (path, value, { gate } = {}) => {
      await assertGateOwnership(gate, store.root);
      if (path === decisionPath) await writeDecisions(value, gate);
      else await store.writeJsonAtomic(artifactPath(path), value);
    },
    createJsonExclusive: async (path, value, { gate } = {}) => {
      await assertGateOwnership(gate, store.root);
      if (path === decisionPath) await writeDecisions(value, gate, true);
      else await store.createJsonExclusive(artifactPath(path), value);
    }
  });
}

export async function readValidatedCanonicalSnapshot(root = process.cwd(), options) {
  return (await createFn004Repository(root)).readCanonicalSnapshot(options);
}

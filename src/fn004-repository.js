import { createPersistence, RepositoryError } from "./persistence.js";
import { withCanonicalGate, assertGateOwnership } from "./fn004-gate.js";
import { CANONICAL_TABLES } from "./canonical-schema.js";
import { readCanonicalSnapshot } from "./canonical-snapshot.js";
import { inspectRuntimeState } from "./fn004-runtime-state.js";

const fixedArtifacts = new Set(["staging/decisions.json", "staging/fn004-state.json", "staging/fn004-bootstrap.json"]);
const artifactDirectories = new Set(["apply-plans", "apply-approvals", "apply-requests", "apply-history", "transactions"]);
function artifactPath(path) {
  const parts = typeof path === "string" ? path.split("/") : [];
  if (fixedArtifacts.has(path)) return path;
  if (parts[0] !== "staging" || !artifactDirectories.has(parts[1]) || parts.length < 3 ||
      parts.slice(2).some((part) => !/^[a-zA-Z0-9_-]+(?:\.json)?$/.test(part)) || !parts.at(-1).endsWith(".json")) {
    throw new RepositoryError("PATH_UNSAFE", "Not a known FN-004 JSON artifact path", { path });
  }
  return path;
}

// Slice 3 proves genesis state/lineage; non-genesis transaction chains remain
// blocked until their later-slice validators exist. No pending bypass flag.
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
  return Object.freeze({
    root: store.root,
    // Readonly, point-in-time snapshot. Release does not keep it current; any
    // later write must reacquire the gate and revalidate manifest preconditions.
    readCanonicalSnapshot: ({ gate } = {}) => withCanonicalRead({ root: store.root, gate, fn: async (resolvedRoot) => {
      const snapshot = await readCanonicalSnapshot(resolvedRoot);
      if (!snapshot.validation.ok) throw new RepositoryError("CANONICAL_INVALID", "Canonical validation failed", { diagnostics: snapshot.validation.diagnostics });
      return snapshot;
    } }),
    readJson: (path, { gate } = {}) => withCanonicalGate({ root: store.root, gate, operation: "runtime_read", fn: () => store.readJson(artifactPath(path)) }),
    writeJsonAtomic: async (path, value, { gate } = {}) => {
      await assertGateOwnership(gate, store.root);
      await store.writeJsonAtomic(artifactPath(path), value);
    },
    createJsonExclusive: async (path, value, { gate } = {}) => {
      await assertGateOwnership(gate, store.root);
      await store.createJsonExclusive(artifactPath(path), value);
    }
  });
}

export async function readValidatedCanonicalSnapshot(root = process.cwd(), options) {
  return (await createFn004Repository(root)).readCanonicalSnapshot(options);
}

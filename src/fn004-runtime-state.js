import { readdir } from "node:fs/promises";
import { canonicalJson } from "./canonical-hash.js";
import { readCanonicalSnapshot } from "./canonical-snapshot.js";
import { CANONICAL_TABLES } from "./canonical-schema.js";
import { auditGitIds } from "./fn004-git-audit.js";
import { exhaustedNamespaces } from "./fn004-id-audit.js";
import { readApplyHistoryDirectory } from "./fn004-history-directory.js";
import { verifySuccessfulHistory } from "./fn004-history-verify.js";
import { validateBootstrapRecord, validateFn004State } from "./fn004-state.js";
import { RepositoryError } from "./persistence.js";

export const BOOTSTRAP_PATH = "staging/fn004-bootstrap.json";
export const STATE_PATH = "staging/fn004-state.json";
export const HISTORY_PATH = "staging/apply-history";
const bootstrapDirectory = /^bootstrap_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function directoryEntries(store, path) {
  if (!await store.exists(path)) return [];
  return (await readdir(await store.resolvePath(path))).sort();
}

export async function validatedSnapshot(store) {
  for (const table of CANONICAL_TABLES) await store.resolvePath(table.path);
  const snapshot = await readCanonicalSnapshot(store.root);
  if (!snapshot.validation.ok) throw new RepositoryError("CANONICAL_INVALID", "Canonical validation failed", { diagnostics: snapshot.validation.diagnostics });
  return snapshot;
}

// Called only while holding the common gate. No writes, repairs or cleanup.
// An absent empty History directory in a clone is proven by valid genesis,
// never by directory absence alone. Unknown runtime work stays fail-closed.
export async function inspectRuntimeState(store, { historical, snapshot } = {}) {
  const stateExists = await store.exists(STATE_PATH), markerExists = await store.exists(BOOTSTRAP_PATH);
  const transactions = await directoryEntries(store, "staging/transactions");
  const requests = await directoryEntries(store, "staging/apply-requests");
  const history = await directoryEntries(store, HISTORY_PATH);
  const temps = (await directoryEntries(store, "staging")).filter((name) => name.startsWith(".fn004-") && name.includes(".tmp-"));
  const base = { readiness: "blocked", existing_identity: null, exhausted_namespaces: [], diagnostics: [] };
  const fail = (code, message, cause) => ({ ...base, readiness: code === "STATE_TRANSITION_PROOF_REQUIRED" || code === "RECOVERY_REQUIRED" ? "recovery_required" : "blocked", status: code, diagnostics: cause?.diagnostics ?? [{ code, severity: "error", message }], cause });
  if (requests.length || transactions.some((name) => !bootstrapDirectory.test(name))) return fail("RECOVERY_REQUIRED", "Unknown or pending runtime work requires inspection");
  if (!stateExists && !markerExists && !transactions.length && !temps.length && !history.length) {
    return { ...base, status: "BOOTSTRAP_REQUIRED" };
  }
  if (!stateExists || !markerExists) return fail("BOOTSTRAP_INCOMPLETE", "Bootstrap evidence exists without both completed records");
  let record, state;
  try { record = await store.readJson(BOOTSTRAP_PATH, { strict: true }); }
  catch (cause) { return fail("BOOTSTRAP_CORRUPT", "Unreadable bootstrap record", new RepositoryError("BOOTSTRAP_CORRUPT", "Unreadable bootstrap record", { cause })); }
  try { state = await store.readJson(STATE_PATH, { strict: true }); }
  catch (cause) { return fail("STATE_CORRUPT", "Unreadable state", new RepositoryError("STATE_CORRUPT", "Unreadable state", { cause })); }
  try {
    validateBootstrapRecord(record);
    validateFn004State(state);
    snapshot ??= await validatedSnapshot(store);
    historical ??= await auditGitIds(store.root);
    const historyVerification = verifySuccessfulHistory({ bootstrap: record, state,
      history_directory: await readApplyHistoryDirectory(store), snapshot, git_audit: historical });
    if (!historyVerification.valid || !historyVerification.state_proof.verified || historyVerification.readiness !== "ready") {
      const code = historyVerification.diagnostics[0]?.code ?? "STATE_TRANSITION_PROOF_REQUIRED";
      throw new RepositoryError(code, "Successful History/state proof is not ready", { history_verification: historyVerification });
    }
    // Only byte-independent exact documents of this completed bootstrap may be
    // identified as cleanup-only. An unrelated temp/intent is never ignored.
    const same = (a, b) => canonicalJson(a) === canonicalJson(b);
    const validateIntent = (intent) => {
      if (!intent || Object.keys(intent).sort().join(",") !== "bootstrap_record,initial_state,kind,schema_version" ||
          intent.schema_version !== 1 || intent.kind !== "bootstrap" || !same(intent.bootstrap_record, record) || !same(intent.initial_state, state)) {
        throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "Unknown or interrupted bootstrap intent");
      }
    };
    try {
      for (const name of transactions) {
        const path = `staging/transactions/${name}`;
        const entries = await directoryEntries(store, path);
        if (!entries.length) throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "Unverifiable bootstrap directory");
        for (const entry of entries) {
          if (entry !== "intent.json" && !/^\.fn004-intent\.json\.tmp-[0-9a-f-]+$/.test(entry)) throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "Unknown bootstrap artifact");
          validateIntent(await store.readJson(`${path}/${entry}`));
        }
      }
      for (const name of temps) {
        const expected = name.startsWith(".fn004-fn004-state.json.tmp-") ? state : name.startsWith(".fn004-fn004-bootstrap.json.tmp-") ? record : null;
        if (!expected || !same(await store.readJson(`staging/${name}`), expected)) throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "Unverifiable runtime temp");
      }
    } catch (cause) {
      throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "Residual bootstrap evidence cannot be verified", { cause });
    }
    return { ...base, status: "READY", readiness: transactions.length || temps.length ? "cleanup_required" : "initialized",
      existing_identity: { repository_instance_id: state.repository_instance_id, bootstrap_hash: record.bootstrap_hash, state_hash: state.state_hash },
      history_verification: historyVerification, high_water_marks: state.high_water_marks, exhausted_namespaces: exhaustedNamespaces(state.high_water_marks) };
  } catch (cause) {
    return fail(cause instanceof RepositoryError ? cause.code : "BOOTSTRAP_CORRUPT", "Bootstrap validation failed", cause instanceof RepositoryError ? cause : new RepositoryError("BOOTSTRAP_CORRUPT", "Bootstrap validation failed", { cause }));
  }
}

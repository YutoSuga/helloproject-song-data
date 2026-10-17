import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createPersistence, RepositoryError } from "./persistence.js";
import { withCanonicalGate, assertGateOwnership } from "./fn004-gate.js";
import { createFn004Repository } from "./fn004-repository.js";
import { auditGitIds, inspectGitIdentity } from "./fn004-git-audit.js";
import { currentIdMaxima, exhaustedNamespaces } from "./fn004-id-audit.js";
import { createAuditPayload, createBootstrapRecords, validateActor, validateExternalDeclaration } from "./fn004-state.js";
import { BOOTSTRAP_PATH, STATE_PATH, HISTORY_PATH, directoryEntries, inspectRuntimeState } from "./fn004-runtime-state.js";
import { hashCanonicalJson } from "./canonical-hash.js";

const failure = (error) => ({ status: error.code ?? "BOOTSTRAP_AUDIT_INCOMPLETE", readiness: "blocked", audit_payload: null,
  audit_hash: null, canonical_manifest: null, existing_identity: null, exhausted_namespaces: [],
  diagnostics: error.diagnostics ?? [{ code: "BOOTSTRAP_AUDIT_INCOMPLETE", severity: "error", message: error.message }], metadata: { generated_at: new Date().toISOString() } });
function assertInitializable(result) {
  if (result.status !== "BOOTSTRAP_REQUIRED") throw new RepositoryError(result.status, "Bootstrap state is not initializable", { diagnostics: result.diagnostics, readiness: result.readiness });
}
const identityResult = (status, code) => ({ status: "READY", code, ...status.existing_identity,
  high_water_marks: status.high_water_marks, readiness: status.readiness, diagnostics: status.diagnostics });

// Trusted dependency injection is for filesystem/Git fault tests. It is not a
// client request surface or a validation/lock bypass. No canonical write API.
export function createBootstrapService({ io = fs, gitOptions = {} } = {}) {
  async function scan(root) { return auditGitIds(root, gitOptions); }
  async function refresh(root, historical) {
    const identity = await inspectGitIdentity(root, gitOptions);
    return identity.head === historical.git.audited_head && identity.format === historical.git.object_format ? historical : scan(root);
  }
  async function inspectBootstrapStatus({ root = process.cwd() } = {}) {
    return withCanonicalGate({ root, operation: "bootstrap_status", fn: async (gate) => {
      const store = await createPersistence(gate.root, { io });
      const result = await inspectRuntimeState(store);
      await assertGateOwnership(gate);
      return result;
    } });
  }
  async function checkBootstrap({ root = process.cwd(), external_declaration } = {}) {
    try {
      const existing = await inspectBootstrapStatus({ root });
      if (existing.status !== "BOOTSTRAP_REQUIRED") return { ...existing, audit_payload: null, audit_hash: null,
        canonical_manifest: null, metadata: { generated_at: new Date().toISOString() } };
      const declaration = structuredClone(validateExternalDeclaration(external_declaration));
      let historical = await scan(root); // expensive graph scan outside the gate
      return await withCanonicalGate({ root, operation: "bootstrap_check", fn: async (gate) => {
        const store = await createPersistence(gate.root, { io });
        const status = await inspectRuntimeState(store, { historical });
        assertInitializable(status);
        const repository = await createFn004Repository(gate.root, { io });
        const snapshot = await repository.readCanonicalSnapshot({ gate });
        historical = await refresh(gate.root, historical);
        const audit_payload = createAuditPayload({ ...snapshot, current_maxima: currentIdMaxima(snapshot) }, historical, declaration);
        await assertGateOwnership(gate);
        return { status: "BOOTSTRAP_REQUIRED", readiness: "initializable", audit_payload,
          audit_hash: hashCanonicalJson(audit_payload), canonical_manifest: snapshot.manifest,
          exhausted_namespaces: exhaustedNamespaces(audit_payload.resulting_high_water_marks), existing_identity: null,
          diagnostics: [], metadata: { generated_at: new Date().toISOString() } };
      } });
    } catch (error) { return failure(error); }
  }
  async function initializeBootstrap({ root = process.cwd(), external_declaration, expected_audit_hash, actor } = {}) {
    // Never synthesize an operator confirmation or external declaration.
    const declaration = structuredClone(validateExternalDeclaration(external_declaration));
    const confirmedActor = structuredClone(validateActor(actor));
    let historical = await scan(root);
    return withCanonicalGate({ root, operation: "bootstrap_initialize", actor: confirmedActor.id, fn: async (gate) => {
      const store = await createPersistence(gate.root, { io });
      historical = await refresh(gate.root, historical);
      const status = await inspectRuntimeState(store, { historical });
      if (status.status === "READY") return identityResult(status, "BOOTSTRAP_ALREADY_INITIALIZED");
      assertInitializable(status);
      const repository = await createFn004Repository(gate.root, { io });
      const snapshot = await repository.readCanonicalSnapshot({ gate });
      historical = await refresh(gate.root, historical);
      const audit_payload = createAuditPayload({ ...snapshot, current_maxima: currentIdMaxima(snapshot) }, historical, declaration);
      const audit_hash = hashCanonicalJson(audit_payload);
      if (expected_audit_hash !== audit_hash) throw new RepositoryError("BOOTSTRAP_AUDIT_MISMATCH", "Audit inputs changed; check and confirm again");
      const { record, state } = createBootstrapRecords({ audit_payload, canonical_manifest: snapshot.manifest,
        repository_instance_id: `repo_${randomUUID()}`, initialized_at: new Date().toISOString(), actor: confirmedActor, expected_audit_hash });
      // Final precondition before any domain publication. Git/checkout and direct
      // edits are non-cooperating operations and forbidden during initialize.
      const finalGit = await inspectGitIdentity(gate.root, gitOptions);
      const finalSnapshot = await repository.readCanonicalSnapshot({ gate });
      if (finalGit.head !== historical.git.audited_head || finalGit.format !== historical.git.object_format ||
          finalSnapshot.manifest.manifest_hash !== snapshot.manifest.manifest_hash) {
        throw new RepositoryError("BOOTSTRAP_AUDIT_MISMATCH", "Canonical or authoritative Git ref changed before publication");
      }
      await assertGateOwnership(gate);
      const directory = `staging/transactions/bootstrap_${randomUUID()}`;
      const intentPath = `${directory}/intent.json`;
      const intent = { schema_version: 1, kind: "bootstrap", bootstrap_record: record, initial_state: state };
      await repository.createJsonExclusive(intentPath, intent, { gate });
      await repository.createJsonExclusive(STATE_PATH, state, { gate });
      if ((await directoryEntries(store, HISTORY_PATH)).length) throw new RepositoryError("BOOTSTRAP_INCOMPLETE", "History is not empty");
      await store.ensureDirectory(HISTORY_PATH);
      await store.syncDirectory(HISTORY_PATH);
      await repository.createJsonExclusive(BOOTSTRAP_PATH, record, { gate }); // completion marker LAST
      const completed = await inspectRuntimeState(store, { historical, snapshot: finalSnapshot });
      if (completed.status !== "READY") throw new RepositoryError(completed.status, "Published bootstrap failed verification", { diagnostics: completed.diagnostics });
      // Remove only this owner's exact verified intent. No sweep or recovery.
      try {
        await assertGateOwnership(gate);
        if (hashCanonicalJson(await store.readJson(intentPath)) !== hashCanonicalJson(intent)) throw new Error("Intent ownership/content changed");
        await io.unlink(await store.resolvePath(intentPath));
        await store.syncDirectory(directory);
        await io.rmdir(await store.resolvePath(directory));
        await store.syncDirectory("staging/transactions");
      } catch (cause) {
        return { ...identityResult(completed, null), readiness: "cleanup_required", diagnostics: [
          { code: "BOOTSTRAP_INCOMPLETE", severity: "error", message: "Bootstrap committed; owner intent cleanup needs inspection" }
        ], cleanup_required: true, cause };
      }
      return identityResult({ ...completed, readiness: "initialized" }, null);
    } });
  }
  return Object.freeze({ inspectBootstrapStatus, checkBootstrap, initializeBootstrap });
}

const service = createBootstrapService();
export const inspectBootstrapStatus = service.inspectBootstrapStatus;
export const checkBootstrap = service.checkBootstrap;
export const initializeBootstrap = service.initializeBootstrap;

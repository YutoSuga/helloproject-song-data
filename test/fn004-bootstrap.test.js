import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { CANONICAL_TABLES } from "../src/canonical-schema.js";
import { readCanonicalSnapshot } from "../src/canonical-snapshot.js";
import { hashCanonicalJson } from "../src/canonical-hash.js";
import { createPersistence } from "../src/persistence.js";
import { acquireGate, releaseGate } from "../src/fn004-gate.js";
import { readValidatedCanonicalSnapshot } from "../src/fn004-repository.js";
import { ID_NAMESPACES, emptyMaxima, currentIdMaxima, historicalCsvMaxima, maximumMaps } from "../src/fn004-id-audit.js";
import { auditGitIds, runAuditGit } from "../src/fn004-git-audit.js";
import { DECLARATION_STATEMENT, RULE_VERSIONS, validateExternalDeclaration, resultingHighWater,
  createBootstrapRecords, validateBootstrapRecord, validateFn004State, validateBootstrapLink, hashState } from "../src/fn004-state.js";
import { checkBootstrap, initializeBootstrap, inspectBootstrapStatus, createBootstrapService } from "../src/fn004-bootstrap.js";

const execute = promisify(execFile);
const actor = { id: "local:test-operator", assurance: "local_process" };
const code = (expected) => (error) => error.code === expected;
const clone = structuredClone;
const declaration = (namespaces = emptyMaxima()) => ({ schema_version: 1, namespaces: clone(namespaces), statement: DECLARATION_STATEMENT, evidence: [] });
const stamp = "2026-10-17T00:00:00Z";
const originalRoot = fileURLToPath(new URL("../", import.meta.url));
async function git(root, ...args) {
  const { stdout } = await execute("git", ["-C", root, "-c", "user.name=Bootstrap test", "-c", "user.email=bootstrap@example.invalid", ...args],
    { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
}
async function temporary(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "fn004-bootstrap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function commit(root, message = "canonical") {
  await git(root, "add", "--all"); await git(root, "commit", "-q", "--allow-empty", "-m", message);
  await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
}
async function works(root, ids) {
  const schema = CANONICAL_TABLES.find((table) => table.name === "works");
  const rows = ids.map((work_id) => schema.columns.map(({ name }) => ({ work_id, title: "監査テスト", source_url: "https://example.invalid/work", created_at: stamp, updated_at: stamp }[name] ?? "")).join(","));
  await fs.writeFile(join(root, schema.path), [schema.columns.map(({ name }) => name).join(","), ...rows].join("\n") + "\n");
}
async function fixture(t, ids = ["W00002"]) {
  const root = await temporary(t);
  await fs.mkdir(join(root, "data"));
  for (const table of CANONICAL_TABLES) await fs.writeFile(join(root, table.path), table.columns.map(({ name }) => name).join(",") + "\n");
  await works(root, ids);
  await git(root, "init", "-q", "-b", "main");
  await commit(root);
  return root;
}
async function inputs(root, mutate) {
  const historical = await auditGitIds(root), snapshot = await readValidatedCanonicalSnapshot(root);
  const d = declaration(maximumMaps(currentIdMaxima(snapshot), historical.maxima));
  if (mutate) mutate(d);
  const checked = await checkBootstrap({ root, external_declaration: d });
  assert.equal(checked.readiness, "initializable", JSON.stringify(checked.diagnostics));
  return { root, external_declaration: d, expected_audit_hash: checked.audit_hash, actor, checked };
}
async function recordPair(root) {
  const input = await inputs(root);
  return createBootstrapRecords({ audit_payload: input.checked.audit_payload, canonical_manifest: input.checked.canonical_manifest,
    repository_instance_id: `repo_${randomUUID()}`, initialized_at: stamp, actor, expected_audit_hash: input.expected_audit_hash });
}
const reshash = (state) => { state.state_hash = hashState(state); return state; };

test("declaration: exact versioned schema, optional note, evidence and all namespace bounds", () => {
  assert.equal(ID_NAMESPACES.length, 14);
  const valid = declaration();
  assert.equal(validateExternalDeclaration(valid), valid);
  validateExternalDeclaration({ ...valid, note: "人間監査", evidence: [{ kind: "url", value: "https://example.invalid/a" }, { kind: "human_note", value: "External register checked" }] });
  const cases = [undefined, null, [], { ...valid, extra: 1 }, { ...valid, schema_version: 2 }, { ...valid, statement: "anything" },
    { ...valid, note: 0 }, { ...valid, evidence: null }, { ...valid, evidence: [{}] },
    { ...valid, evidence: [{ kind: "url", value: "http://example.invalid" }] }, { ...valid, evidence: [{ kind: "human_note", value: " " }] },
    { ...valid, evidence: [{ kind: "unknown", value: "a" }] }, { ...valid, evidence: [{ kind: "human_note", value: "a", extra: 1 }] }];
  for (const namespaces of [{ ...valid.namespaces, X: 0 }, Object.fromEntries(Object.entries(valid.namespaces).filter(([key]) => key !== "W")),
    ...[-1, 0.5, 100000, "2", null].map((W) => ({ ...valid.namespaces, W }))]) cases.push({ ...valid, namespaces });
  for (const value of cases) assert.throws(() => validateExternalDeclaration(value), code("EXTERNAL_DECLARATION_INVALID"));
  for (const W of [99998, 99999]) validateExternalDeclaration(declaration({ ...emptyMaxima(), W }));
});

test("declaration contradiction is blocking; equal/higher upper bounds preserve gaps", () => {
  const current = { ...emptyMaxima(), W: 4 }, historical = { ...emptyMaxima(), W: 5 };
  assert.throws(() => resultingHighWater(current, historical, declaration(current)), code("EXTERNAL_DECLARATION_CONTRADICTION"));
  for (const W of [5, 8]) assert.equal(resultingHighWater(current, historical, declaration({ ...emptyMaxima(), W })).W, W);
});

test("current maxima derive all master/song namespaces and reject malformed identities", () => {
  const tables = Object.fromEntries(CANONICAL_TABLES.map((table) => [table.name, []]));
  for (const table of CANONICAL_TABLES) {
    if (table.primaryKey.length !== 1) continue;
    const column = table.columns.find((column) => column.name === table.primaryKey[0] && column.type === "id" && column.target === table.name);
    if (column) for (const prefix of ID_NAMESPACES.filter((prefix) => column.pattern.test(`${prefix}00000`))) tables[table.name].push({ [column.name]: `${prefix}99999` });
  }
  assert.deepEqual(currentIdMaxima({ tables }), Object.fromEntries(ID_NAMESPACES.map((key) => [key, 99999])));
  tables.works = [{ work_id: "W00001" }, { work_id: "W00004" }];
  assert.equal(currentIdMaxima({ tables }).W, 4);
  tables.works = []; assert.equal(currentIdMaxima({ tables }).W, 0);
  for (const value of ["W100000", "X00001", "W001", "", null]) {
    tables.works = [{ work_id: value }]; assert.throws(() => currentIdMaxima({ tables }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  }
});

test("historical CSV permits non-ID schema evolution but rejects ambiguous/malformed content", () => {
  assert.equal(historicalCsvMaxima("data/works.csv", Buffer.from("title,work_id\r\n\"a,b\",W99999\r\n")).W, 99999);
  assert.equal(historicalCsvMaxima("data/song_creators.csv", Buffer.from("creator_id,song_id\nC00009,J00004\n")).C, 9);
  assert.equal(historicalCsvMaxima("data/video_songs.csv", Buffer.from("video_id,song_id,performer_artist_id\nV00001,H00002,\n")).H, 2);
  for (const [path, content] of [["data/unknown.csv", "work_id\nW00001\n"], ["data/works.csv", "id\nW00001\n"],
    ["data/works.csv", "work_id,unknown_id\nW00001,X00001\n"], ["data/works.csv", "work_id,work_id\nW00001,W00002\n"],
    ["data/works.csv", "work_id\nW00001,extra\n"], ["data/works.csv", "work_id\n\"W00001"],
    ["data/works.csv", "work_id\nW100000\n"], ["data/works.csv", Buffer.from([0xff])]]) {
    assert.throws(() => historicalCsvMaxima(path, Buffer.isBuffer(content) ? content : Buffer.from(content)), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  }
});

test("Git audit retains deleted IDs, includes merge parents, excludes unmerged/docs/tests/messages/untracked", async (t) => {
  const root = await fixture(t, ["W00001"]);
  await git(root, "checkout", "-q", "-b", "side"); await works(root, ["W00005"]); await commit(root);
  await git(root, "checkout", "-q", "main");
  await git(root, "merge", "--no-ff", "-q", "-m", "merge", "side");
  await works(root, ["W00002"]); await fs.writeFile(join(root, "docs.txt"), "W99999");
  await fs.mkdir(join(root, "test")); await fs.writeFile(join(root, "test", "id.csv"), "work_id\nW99999\n");
  await commit(root, "W99999 is not canonical usage");
  await git(root, "checkout", "-q", "-b", "unmerged"); await works(root, ["W99999"]);
  await git(root, "add", "data"); await git(root, "commit", "-q", "-m", "unmerged");
  await git(root, "checkout", "-q", "main"); await fs.writeFile(join(root, "untracked.csv"), "W99999");
  const result = await auditGitIds(root);
  assert.equal(result.maxima.W, 5); assert.equal(result.git.history_scope, "all_reachable_parents");
  assert.equal(result.git.reachable_commit_count, 4); assert.equal(result.git.root_commits.length, 1);
  assert.equal(currentIdMaxima(await readValidatedCanonicalSnapshot(root)).W, 2);
  assert.equal(result.git.audited_head, await git(root, "rev-parse", "origin/main"));
});

test("Git audit detects shallow, missing objects/commands, replacements and malformed historical CSV", async (t) => {
  const root = await fixture(t);
  await assert.rejects(auditGitIds(root, { run: async () => { throw new Error("missing object/command"); } }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  await assert.rejects(auditGitIds(root, { run: (root, args) => args.includes("--is-shallow-repository") ? Buffer.from("true\n") : runAuditGit(root, args) }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  await assert.rejects(auditGitIds(root, { run: (root, args) => args[0] === "cat-file" ? Promise.reject(new Error("object missing")) : runAuditGit(root, args) }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  await assert.rejects(auditGitIds(root, { run: (root, args) => args[0] === "for-each-ref" ? Buffer.from("refs/replace/abc\n") : runAuditGit(root, args) }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
  await fs.writeFile(join(root, ".git/info/grafts"), "invalid graft\n");
  await assert.rejects(auditGitIds(root), code("BOOTSTRAP_AUDIT_INCOMPLETE")); await fs.rm(join(root, ".git/info/grafts"));
  await fs.writeFile(join(root, "data/works.csv"), "unknown_id\nW00005\n"); await commit(root);
  await works(root, ["W00002"]); await commit(root);
  await assert.rejects(auditGitIds(root), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
});

test("audit is deterministic across time/path, binds declaration, manifest, HEAD and rule versions", async (t) => {
  const root = await fixture(t), input = await inputs(root);
  const again = await checkBootstrap(input);
  assert.deepEqual(again.audit_payload, input.checked.audit_payload); assert.equal(again.audit_hash, input.expected_audit_hash);
  const copied = await temporary(t); await fs.cp(root, copied, { recursive: true });
  assert.equal((await checkBootstrap({ ...input, root: copied })).audit_hash, again.audit_hash);
  for (const change of [(p) => p.external_declaration.note = "", (p) => p.canonical_manifest_hash = "f".repeat(64),
    (p) => p.git.audited_head = "f".repeat(40), (p) => p.rule_versions.git_id_audit++]) {
    const modified = clone(again.audit_payload); change(modified); assert.notEqual(hashCanonicalJson(modified), again.audit_hash);
  }
  const declared = clone(input.external_declaration); declared.namespaces.W++;
  assert.notEqual((await checkBootstrap({ root, external_declaration: declared })).audit_hash, again.audit_hash);
  const omitted = clone(input.external_declaration), noted = { ...omitted, note: "" };
  assert.notEqual(hashCanonicalJson(omitted), hashCanonicalJson(noted));
  assert.deepEqual(again.audit_payload.rule_versions, RULE_VERSIONS);
});

test("bootstrap identity/hash, state hash and strict validators reject tampering", async (t) => {
  const root = await fixture(t), { record, state } = await recordPair(root);
  validateBootstrapLink(record, state);
  const metadataChanged = clone(record); metadataChanged.metadata.initialized_at = "2026-10-18T00:00:00Z";
  assert.equal(hashCanonicalJson(metadataChanged.payload), record.bootstrap_hash);
  validateBootstrapRecord(metadataChanged);
  for (const modify of [(r) => r.payload.repository_instance_id = `repo_${randomUUID()}`, (r) => r.payload.audit_hash = "f".repeat(64),
    (r) => r.payload.high_water_marks.W++, (r) => r.payload.operator_confirmation.actor.id = "different"]) {
    const r = clone(record); modify(r); assert.notEqual(hashCanonicalJson(r.payload), record.bootstrap_hash);
    assert.throws(() => validateBootstrapRecord(r), code("BOOTSTRAP_CORRUPT"));
  }
  for (const modify of [(s) => s.initialized_at = "2026-02-30T00:00:00Z", (s) => s.state_hash = "f".repeat(64), (s) => s.generation++,
    (s) => s.schema_version++, (s) => s.extra = true, (s) => s.repository_instance_id = [s.repository_instance_id]]) {
    const s = clone(state); modify(s); assert.throws(() => validateFn004State(s), code("STATE_CORRUPT"));
  }
  const same = { ...state, state_hash: "ignored" }; assert.equal(hashState(same), state.state_hash);
  for (const modify of [(s) => s.high_water_marks.W = -1, (s) => s.high_water_marks.W = 1.5, (s) => s.high_water_marks.W = 100000,
    (s) => delete s.high_water_marks.W, (s) => s.high_water_marks.X = 0]) {
    const s = clone(state); modify(s); assert.throws(() => validateFn004State(s), code("STATE_HIGH_WATER_INVALID"));
  }
  const low = clone(state); low.high_water_marks.W--; reshash(low);
  assert.throws(() => validateBootstrapLink(record, low), code("STATE_HIGH_WATER_INVALID"));
  const mismatch = reshash({ ...clone(state), initialized_at: "2026-10-18T00:00:00Z" });
  assert.throws(() => validateBootstrapLink(record, mismatch), code("STATE_BOOTSTRAP_MISMATCH"));
  for (const modify of [(s) => s.history.head_hash = "f".repeat(64), (s) => s.pending_transaction = `tx_${randomUUID()}`, (s) => s.generation = 1]) {
    const s = clone(state); modify(s); reshash(s); assert.throws(() => validateBootstrapLink(record, s), code("BOOTSTRAP_INCOMPLETE"));
  }
  const bound = { ...emptyMaxima(), W: state.high_water_marks.W + 1 };
  assert.throws(() => validateBootstrapLink(record, state, { current: bound }), code("STATE_HIGH_WATER_INVALID"));
  assert.throws(() => validateBootstrapLink(record, state, { historical: bound }), code("STATE_HIGH_WATER_INVALID"));
});

test("explicit initialize publishes state before marker, reuses existing identity and supports clone lineage/readers", async (t) => {
  const root = await fixture(t), input = await inputs(root), publications = [];
  const io = { ...fs, link: async (source, target) => { publications.push(target); return fs.link(source, target); } };
  const service = createBootstrapService({ io });
  const result = await service.initializeBootstrap(input);
  assert.equal(result.status, "READY"); assert.equal(result.readiness, "initialized"); assert.equal(result.code, null);
  assert.match(result.repository_instance_id, /^repo_[0-9a-f-]{36}$/);
  assert.ok(publications[0].endsWith("intent.json"));
  assert.ok(publications[1].endsWith("fn004-state.json")); assert.ok(publications[2].endsWith("fn004-bootstrap.json"));
  const store = await createPersistence(root), record = await store.readJson("staging/fn004-bootstrap.json"), state = await store.readJson("staging/fn004-state.json");
  validateBootstrapLink(record, state); assert.equal(state.initialized_at, record.metadata.initialized_at);
  assert.deepEqual(await fs.readdir(join(root, "staging/transactions")), []);
  assert.equal((await readValidatedCanonicalSnapshot(root)).validation.ok, true);
  const repeated = await initializeBootstrap(input); assert.equal(repeated.code, "BOOTSTRAP_ALREADY_INITIALIZED");
  assert.equal(repeated.repository_instance_id, result.repository_instance_id); assert.equal(repeated.state_hash, result.state_hash);
  const checked = await checkBootstrap({ root }); assert.equal(checked.status, "READY"); assert.equal(checked.audit_hash, null); assert.equal(checked.audit_payload, null);
  assert.equal(checked.existing_identity.repository_instance_id, result.repository_instance_id);
  const copied = await temporary(t); await fs.cp(root, copied, { recursive: true });
  await fs.rm(join(copied, "staging/apply-history"), { recursive: true }); // Git does not store empty dirs
  const status = await inspectBootstrapStatus({ root: copied }); assert.equal(status.status, "READY");
  assert.equal(status.existing_identity.repository_instance_id, result.repository_instance_id);
  assert.equal((await readValidatedCanonicalSnapshot(copied)).validation.ok, true);
});

test("readonly checks/status never create domain artifacts and declaration is mandatory", async (t) => {
  const root = await fixture(t);
  assert.equal((await inspectBootstrapStatus({ root })).status, "BOOTSTRAP_REQUIRED");
  assert.equal((await checkBootstrap({ root })).status, "EXTERNAL_DECLARATION_INVALID");
  const input = await inputs(root); assert.equal(input.checked.status, "BOOTSTRAP_REQUIRED");
  assert.deepEqual(await fs.readdir(join(root, "staging")), []);
  assert.equal(await git(root, "status", "--porcelain"), "");
  const invalid = clone(input.external_declaration); invalid.namespaces.W = 0;
  const blocked = await checkBootstrap({ root, external_declaration: invalid });
  assert.equal(blocked.status, "EXTERNAL_DECLARATION_CONTRADICTION"); assert.equal(blocked.audit_hash, null); assert.equal(blocked.readiness, "blocked");
});

test("status blocks partial, corrupt, mismatched and unproven advanced state without rebootstrap", async (t) => {
  const cases = ["state-only", "marker-only", "bad-state", "bad-marker", "link", "low", "history", "pending", "unknown-work", "temp-only"];
  for (const scenario of cases) {
    const root = await fixture(t), input = await inputs(root);
    if (scenario === "temp-only") {
      await fs.writeFile(join(root, "staging/.fn004-fn004-state.json.tmp-test"), "{}");
    } else {
      await initializeBootstrap(input);
      const statePath = join(root, "staging/fn004-state.json"), markerPath = join(root, "staging/fn004-bootstrap.json");
      if (scenario === "state-only") await fs.rm(markerPath);
      if (scenario === "marker-only") await fs.rm(statePath);
      if (scenario === "bad-state") await fs.writeFile(statePath, "{");
      if (scenario === "bad-marker") await fs.writeFile(markerPath, "{}");
      if (["link", "low", "history", "pending"].includes(scenario)) {
        const s = JSON.parse(await fs.readFile(statePath, "utf8"));
        if (scenario === "link") s.repository_instance_id = `repo_${randomUUID()}`;
        if (scenario === "low") s.high_water_marks.W = 0;
        if (scenario === "history") s.history.head_hash = "f".repeat(64);
        if (scenario === "pending") s.pending_transaction = `tx_${randomUUID()}`;
        await fs.writeFile(statePath, JSON.stringify(reshash(s)));
      }
      if (scenario === "unknown-work") { await fs.mkdir(join(root, "staging/transactions/tx_unknown")); }
    }
    const status = await inspectBootstrapStatus({ root });
    const expected = { "bad-state": "STATE_CORRUPT", "bad-marker": "BOOTSTRAP_CORRUPT", link: "STATE_BOOTSTRAP_MISMATCH",
      low: "STATE_HIGH_WATER_INVALID", "unknown-work": "RECOVERY_REQUIRED" }[scenario] ?? "BOOTSTRAP_INCOMPLETE";
    assert.equal(status.status, expected, scenario);
    await assert.rejects(initializeBootstrap(input));
    await assert.rejects(readValidatedCanonicalSnapshot(root));
  }
});

test("status re-audits current and historical lower bounds after initialization", async (t) => {
  for (const source of ["current", "historical"]) {
    const root = await fixture(t), input = await inputs(root);
    await initializeBootstrap(input);
    await works(root, ["W00003"]);
    if (source === "historical") {
      // Commit only canonical; keep bootstrap/state outside this synthetic Git
      // history so this assertion focuses on deleted historical ID usage.
      await git(root, "add", "data"); await git(root, "commit", "-q", "-m", "used higher ID");
      await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
      await works(root, ["W00002"]);
    }
    assert.equal((await inspectBootstrapStatus({ root })).status, "STATE_HIGH_WATER_INVALID");
    await assert.rejects(readValidatedCanonicalSnapshot(root), code("STATE_HIGH_WATER_INVALID"));
  }
});

test("capacity exhausted 99999 is valid READY, 99998 not exhausted", async (t) => {
  for (const maximum of [99998, 99999]) {
    const root = await fixture(t), input = await inputs(root, (d) => d.namespaces.W = maximum);
    assert.deepEqual(input.checked.exhausted_namespaces, maximum === 99999 ? ["W"] : []);
    await initializeBootstrap(input);
    const status = await inspectBootstrapStatus({ root }); assert.equal(status.status, "READY");
    assert.deepEqual(status.exhausted_namespaces, maximum === 99999 ? ["W"] : []);
  }
});

test("initialize rejects stale audit after canonical, authoritative HEAD or declaration changes", async (t) => {
  for (const change of ["canonical", "head", "declaration"]) {
    const root = await fixture(t), input = await inputs(root);
    if (change === "canonical") await fs.appendFile(join(root, "data/works.csv"), `W00001,additional,,,https://example.invalid,${stamp},${stamp}\n`);
    if (change === "head") await commit(root, "new authoritative head");
    if (change === "declaration") input.external_declaration.note = "changed";
    await assert.rejects(initializeBootstrap(input), code("BOOTSTRAP_AUDIT_MISMATCH"));
    assert.deepEqual(await fs.readdir(join(root, "staging")), []);
  }
  const root = await fixture(t), input = await inputs(root), oldRules = clone(input.checked.audit_payload);
  oldRules.rule_versions.bootstrap = 0;
  await assert.rejects(initializeBootstrap({ ...input, expected_audit_hash: hashCanonicalJson(oldRules) }), code("BOOTSTRAP_AUDIT_MISMATCH"));
});

test("authoritative ref changing during audit is blocking, not a mixed complete result", async (t) => {
  const root = await fixture(t); let changed = false;
  await assert.rejects(auditGitIds(root, { run: async (root, args) => {
    const bytes = await runAuditGit(root, args);
    if (args[0] === "rev-list" && !changed) { changed = true; await commit(root, "ref changed during scan"); }
    return bytes;
  } }), code("BOOTSTRAP_AUDIT_INCOMPLETE"));
});

test("initialize holds the common gate throughout durable publication", async (t) => {
  const root = await fixture(t), input = await inputs(root);
  let entered, resume;
  const arrived = new Promise((resolve) => entered = resolve), paused = new Promise((resolve) => resume = resolve);
  const io = { ...fs, link: async (source, target) => {
    if (target.endsWith("fn004-state.json")) { entered(); await paused; }
    return fs.link(source, target);
  } };
  const initialization = createBootstrapService({ io }).initializeBootstrap(input);
  await arrived;
  try { await assert.rejects(acquireGate({ root, operation: "competing_writer" }), code("GATE_BUSY")); }
  finally { resume(); }
  assert.equal((await initialization).readiness, "initialized");
});

test("bootstrap initialize rechecks Git immediately before domain publication", async (t) => {
  const root = await fixture(t), input = await inputs(root); let resolutions = 0;
  const service = createBootstrapService({ gitOptions: { run: async (root, args) => {
    // Scan before+after, refresh under gate, refresh after current read, final
    // publication precondition: change the ref precisely at that final check.
    if (args[0] === "rev-parse" && args.includes("--verify") && ++resolutions === 5) await commit(root, "late ref update");
    return runAuditGit(root, args);
  } } });
  await assert.rejects(service.initializeBootstrap(input), code("BOOTSTRAP_AUDIT_MISMATCH"));
  assert.deepEqual(await fs.readdir(join(root, "staging")), []);
});

test("gate contention, corrupt and stale locks never get removed by bootstrap", async (t) => {
  const root = await fixture(t), input = await inputs(root);
  const lease = await acquireGate({ root, operation: "other_writer" });
  await assert.rejects(initializeBootstrap(input), code("GATE_BUSY"));
  await releaseGate(lease);
  for (const bytes of ["{", JSON.stringify({ schema_version: 1, root, lock_id: randomUUID(), process_id: 2147483647, operation: "old", started_at: stamp })]) {
    await fs.writeFile(join(root, "staging/.fn004.lock"), bytes);
    await assert.rejects(initializeBootstrap(input), (error) => ["GATE_BUSY", "GATE_CORRUPT"].includes(error.code));
    assert.equal(await fs.readFile(join(root, "staging/.fn004.lock"), "utf8"), bytes);
    await fs.rm(join(root, "staging/.fn004.lock")); // fixture owner cleanup, never runtime force-unlock
  }
});

test("publication failures retain evidence, never return READY, and do not auto-rebootstrap", async (t) => {
  for (const stage of ["intent", "state", "marker", "directory-sync", "no-clobber"]) {
    const root = await fixture(t), input = await inputs(root); let markerPublished = false;
    const io = { ...fs,
      link: async (source, target) => {
        if ((stage === "intent" && target.endsWith("intent.json")) || (stage === "state" && target.endsWith("fn004-state.json")) ||
            (stage === "marker" && target.endsWith("fn004-bootstrap.json"))) throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
        if (stage === "no-clobber" && target.endsWith("fn004-state.json")) await fs.writeFile(target, "{}");
        await fs.link(source, target); if (target.endsWith("fn004-bootstrap.json")) markerPublished = true;
      },
      open: async (...args) => {
        const handle = await fs.open(...args);
        return new Proxy(handle, { get(target, property) {
          if (property === "sync" && stage === "directory-sync" && markerPublished && args[0] === join(root, "staging")) return async () => { throw new Error("injected directory sync failure"); };
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
        } });
      }
    };
    await assert.rejects(createBootstrapService({ io }).initializeBootstrap(input), (error) => error.code.startsWith("PERSISTENCE_"));
    const status = await inspectBootstrapStatus({ root });
    assert.notEqual(status.status, "BOOTSTRAP_REQUIRED", stage);
    assert.ok(status.status !== "READY" || status.readiness === "cleanup_required", stage);
    if (status.status !== "READY") await assert.rejects(initializeBootstrap(input));
    else assert.equal((await initializeBootstrap(input)).readiness, "cleanup_required");
  }
});

test("completed owner intent cleanup failure is distinguishable and blocks normal readers", async (t) => {
  const root = await fixture(t), input = await inputs(root);
  const io = { ...fs, unlink: async (path) => { if (path.endsWith("/intent.json")) throw new Error("cleanup failure"); return fs.unlink(path); } };
  const result = await createBootstrapService({ io }).initializeBootstrap(input);
  assert.equal(result.status, "READY"); assert.equal(result.readiness, "cleanup_required");
  assert.equal((await inspectBootstrapStatus({ root })).readiness, "cleanup_required");
  await assert.rejects(readValidatedCanonicalSnapshot(root), code("RECOVERY_REQUIRED"));
});

test("bootstrap uses repository path safety and rejects invalid canonical without rewriting it", async (t) => {
  const root = await fixture(t), input = await inputs(root);
  await fs.appendFile(join(root, "data/works.csv"), "bad\n");
  const before = await fs.readFile(join(root, "data/works.csv"));
  await assert.rejects(initializeBootstrap(input), code("CANONICAL_INVALID"));
  assert.deepEqual(await fs.readFile(join(root, "data/works.csv")), before);
  assert.equal((await checkBootstrap(input)).status, "CANONICAL_INVALID");
  const other = await fixture(t), outside = await temporary(t);
  await fs.mkdir(join(other, "staging")); await fs.symlink(outside, join(other, "staging/transactions"));
  await assert.rejects(inspectBootstrapStatus({ root: other }), code("PATH_UNSAFE"));
});

test("current production canonical is valid via temp copy; tests never initialize production", async (t) => {
  const root = await temporary(t); await fs.cp(join(originalRoot, "data"), join(root, "data"), { recursive: true });
  const snapshot = await readValidatedCanonicalSnapshot(root);
  assert.equal(snapshot.validation.ok, true); assert.equal(snapshot.manifest.files.length, 14);
  assert.deepEqual(snapshot.validation.diagnostics, []);
  assert.equal(Object.keys(currentIdMaxima(snapshot)).length, 14);
});

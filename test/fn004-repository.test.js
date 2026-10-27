import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { spawnSync, fork } from "node:child_process";
import { once } from "node:events";
import { createPersistence, RepositoryError } from "../src/persistence.js";
import { acquireGate, releaseGate, assertGateOwnership, withCanonicalGate, GATE_PATH } from "../src/fn004-gate.js";
import { createFn004Repository, readValidatedCanonicalSnapshot } from "../src/fn004-repository.js";
import { readCanonicalSnapshot } from "../src/canonical-snapshot.js";
import { loadCanonicalData } from "../src/canonical.js";
import { loadReviewCanonical } from "../src/prepare-reviews.js";
import { loadTitleIndex } from "../src/collector/match-existing.js";
import { collectCandidates } from "../src/collector/collect.js";

const project = fileURLToPath(new URL("../", import.meta.url));
const gateUrl = new URL("../src/fn004-gate.js", import.meta.url).href;
const fault = () => Object.assign(new Error("injected I/O failure"), { code: "EIO" });
const hasCode = (code) => (error) => error instanceof RepositoryError && error.code === code;
async function fixture(t, canonical = false) {
  const root = await fs.mkdtemp(join(tmpdir(), "hp-fn004-repo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (canonical) await fs.cp(join(project, "data"), join(root, "data"), { recursive: true });
  return root;
}
const missing = (path) => assert.rejects(fs.stat(path), { code: "ENOENT" });
function injectedOpen(override) {
  return async (path, flags, ...args) => {
    const handle = await fs.open(path, flags, ...args);
    return new Proxy(handle, { get(target, name) {
      const change = override(path, flags, name, target);
      if (change) return change;
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
}

test("gate excludes independent worker, then permits next acquisition; metadata has no repository UUID", async (t) => {
  const root = await fixture(t);
  const lease = await acquireGate({ root, operation: "runtime_write", actor: "local:test" });
  const metadata = JSON.parse(await fs.readFile(join(root, GATE_PATH)));
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.lock_id, lease.lock_id);
  assert.equal(metadata.mode, "exclusive");
  assert.equal(metadata.process_id, process.pid);
  assert.equal(metadata.actor, "local:test");
  assert.equal(metadata.repository_instance_id, undefined);
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{const {acquireGate,releaseGate}=await import(workerData.module);
    try { const lease=await acquireGate({root:workerData.root}); await releaseGate(lease); parentPort.postMessage('acquired'); }
    catch(e) { parentPort.postMessage(e.code); } })().catch(e=>{throw e;});`, { eval: true, workerData: { root, module: gateUrl } });
  try { assert.equal((await once(worker, "message"))[0], "GATE_BUSY"); }
  finally { await worker.terminate(); await releaseGate(lease); }
  const next = await acquireGate({ root }); await releaseGate(next);
  await missing(join(root, GATE_PATH));
});

test("callback throw releases normal lock, including falsy thrown values", async (t) => {
  const root = await fixture(t);
  for (const value of [new Error("domain failed"), null, undefined, false]) {
    let caught = false;
    try { await withCanonicalGate({ root, fn: () => { throw value; } }); }
    catch (error) { caught = true; assert.equal(error, value); }
    assert.equal(caught, true);
    await missing(join(root, GATE_PATH));
  }
});

test("existing and simulated stale locks are never removed or rewritten", async (t) => {
  const root = await fixture(t), path = join(root, GATE_PATH);
  const lease = await acquireGate({ root });
  const original = JSON.parse(await fs.readFile(path));
  const stale = { ...original, process_id: 2147483647, started_at: "2000-01-01T00:00:00Z" };
  const bytes = JSON.stringify(stale);
  await fs.writeFile(path, bytes);
  await assert.rejects(acquireGate({ root }), hasCode("GATE_BUSY"));
  assert.equal(await fs.readFile(path, "utf8"), bytes);
  await assert.rejects(releaseGate(lease), hasCode("GATE_OWNERSHIP_MISMATCH"));
  assert.equal(await fs.readFile(path, "utf8"), bytes);
});

for (const content of ["", "{", "[]", '{"schema_version":99}']) test(`malformed/incomplete/unknown lock is retained: ${JSON.stringify(content)}`, async (t) => {
  const root = await fixture(t); await fs.mkdir(join(root, "staging"));
  await fs.writeFile(join(root, GATE_PATH), content);
  await assert.rejects(acquireGate({ root }), hasCode("GATE_CORRUPT"));
  assert.equal(await fs.readFile(join(root, GATE_PATH), "utf8"), content);
});

test("lock read failure is corrupt/busy, never absence", async (t) => {
  const root = await fixture(t), lease = await acquireGate({ root });
  const before = await fs.readFile(join(root, GATE_PATH));
  const io = { ...fs, readFile: async (path, ...args) => { if (path.endsWith(".fn004.lock")) throw fault(); return fs.readFile(path, ...args); } };
  await assert.rejects(acquireGate({ root, io }), hasCode("GATE_CORRUPT"));
  assert.deepEqual(await fs.readFile(join(root, GATE_PATH)), before);
  await releaseGate(lease);
});

test("ownership checks bytes and inode; forged, stale and cross-root tokens are rejected", async (t) => {
  const root = await fixture(t), other = await fixture(t), lease = await acquireGate({ root });
  await assert.rejects(assertGateOwnership({ ...lease }, root), hasCode("GATE_OWNERSHIP_MISMATCH"));
  await assert.rejects(assertGateOwnership(lease, other), hasCode("GATE_OWNERSHIP_MISMATCH"));
  const path = join(root, GATE_PATH), bytes = await fs.readFile(path);
  await fs.rename(path, path + ".old"); await fs.writeFile(path, bytes);
  await assert.rejects(releaseGate(lease), hasCode("GATE_OWNERSHIP_MISMATCH"));
  assert.deepEqual(await fs.readFile(path), bytes); // replacement not deleted
  await assert.rejects(assertGateOwnership(lease), hasCode("GATE_OWNERSHIP_MISMATCH"));
});

test("nested implicit acquisition rejected; explicit original lease works and stays held", async (t) => {
  const root = await fixture(t, true);
  await withCanonicalGate({ root, fn: async (gate) => {
    await assert.rejects(withCanonicalGate({ root, fn: () => assert.fail("nested") }), hasCode("GATE_NESTED"));
    const snapshot = await readValidatedCanonicalSnapshot(root, { gate });
    assert.equal(snapshot.validation.ok, true);
    await withCanonicalGate({ root, gate, fn: async (same) => { assert.equal(same, gate); await assertGateOwnership(same); } });
    await assertGateOwnership(gate);
  } });
  await missing(join(root, GATE_PATH));
});

test("async context inherited after release can acquire a new gate", async (t) => {
  const root = await fixture(t);
  let start;
  const later = new Promise((resolve) => { start = resolve; });
  let background;
  await withCanonicalGate({ root, fn: async () => {
    background = later.then(() => withCanonicalGate({ root, fn: () => "next" }));
  } });
  start();
  assert.equal(await background, "next");
});

test("concurrent release cannot unlink a later owner's lock", async (t) => {
  const root = await fixture(t), lease = await acquireGate({ root });
  const first = releaseGate(lease);
  await assert.rejects(releaseGate(lease), hasCode("GATE_OWNERSHIP_MISMATCH"));
  await first;
  const next = await acquireGate({ root });
  await assert.rejects(releaseGate(lease), hasCode("GATE_OWNERSHIP_MISMATCH"));
  await assertGateOwnership(next); await releaseGate(next);
});

test("unlink failure is cleanup_required, preserves operation error and lock", async (t) => {
  const root = await fixture(t);
  const io = { ...fs, unlink: async () => { throw fault(); } };
  const domain = new Error("original operation error");
  await assert.rejects(withCanonicalGate({ root, io, fn: () => { throw domain; } }), (error) => {
    assert.equal(error.code, "GATE_RELEASE_FAILED"); assert.equal(error.cleanup_required, true);
    assert.equal(error.operation_error, domain); return true;
  });
  assert.ok(await fs.stat(join(root, GATE_PATH)));
  await assert.rejects(acquireGate({ root }), hasCode("GATE_BUSY"));
});

test("successful callback cannot hide release sync failure", async (t) => {
  const root = await fixture(t); await fs.mkdir(join(root, "staging"));
  let directorySyncs = 0;
  const io = { ...fs, open: injectedOpen((path, flags, name) => flags === "r" && name === "sync" ? async () => { if (++directorySyncs === 2) throw fault(); } : null) };
  await assert.rejects(withCanonicalGate({ root, io, fn: () => 42 }), (error) => error.code === "GATE_RELEASE_FAILED" && error.cleanup_required);
});

test("acquire fsync failure retains partial lock and never runs callback", async (t) => {
  const root = await fixture(t);
  const io = { ...fs, open: injectedOpen((path, flags, name) => flags === "wx" && name === "sync" ? async () => { throw fault(); } : null) };
  await assert.rejects(withCanonicalGate({ root, io, fn: () => assert.fail("must not execute") }), hasCode("GATE_ACQUIRE_FAILED"));
  assert.ok(await fs.stat(join(root, GATE_PATH)));
  await assert.rejects(acquireGate({ root }), hasCode("GATE_BUSY"));
});

test("metadata write failure leaves an incomplete lock, never unlocks someone else's file", async (t) => {
  const root = await fixture(t);
  const io = { ...fs, open: injectedOpen((path, flags, name) => flags === "wx" && name === "writeFile" ? async () => { throw fault(); } : null) };
  await assert.rejects(acquireGate({ root, io }), hasCode("GATE_ACQUIRE_FAILED"));
  assert.equal((await fs.readFile(join(root, GATE_PATH))).length, 0);
  await assert.rejects(acquireGate({ root }), hasCode("GATE_CORRUPT"));
});

test("safe read: Slice 1 manifest/14 tables, stable bytes retained after gate release", async (t) => {
  const root = await fixture(t, true), expected = await readCanonicalSnapshot(root);
  const actual = await readValidatedCanonicalSnapshot(root);
  assert.deepEqual(actual, expected);
  assert.equal(Object.keys(actual.tables).length, 14);
  assert.deepEqual(actual.validation, { ok: true, diagnostics: [] });
  await missing(join(root, GATE_PATH));
  await withCanonicalGate({ root, operation: "runtime_write", fn: async () => fs.appendFile(join(root, "data/works.csv"), "\n") });
  assert.deepEqual(actual.manifest, expected.manifest);
  assert.notEqual((await readCanonicalSnapshot(root)).manifest.manifest_hash, actual.manifest.manifest_hash);
});

test("invalid canonical rejects with original structured diagnostics and releases gate", async (t) => {
  const root = await fixture(t, true); await fs.writeFile(join(root, "data/videos.csv"), "bad\n");
  await assert.rejects(readValidatedCanonicalSnapshot(root), (error) => {
    assert.equal(error.code, "CANONICAL_INVALID");
    assert.ok(error.diagnostics.some((item) => item.code === "HEADER_MISMATCH" && item.table === "videos")); return true;
  });
  await missing(join(root, GATE_PATH));
});

test("FN-001/FN-002/FN-003 cooperate, return original shapes, accept explicit lease", async (t) => {
  const root = await fixture(t, true), lease = await acquireGate({ root, operation: "runtime_write" });
  try {
    for (const reader of [loadCanonicalData, loadReviewCanonical, loadTitleIndex, readValidatedCanonicalSnapshot]) {
      await assert.rejects(reader(root), hasCode("GATE_BUSY"));
    }
    const snapshot = await readValidatedCanonicalSnapshot(root, { gate: lease });
    assert.deepEqual((await loadCanonicalData(root, { gate: lease })).songs, snapshot.tables.songs);
    assert.deepEqual(await loadReviewCanonical(root, { gate: lease }), snapshot.tables);
    assert.ok((await loadTitleIndex(root, { gate: lease })).has("微炭酸"));
  } finally { await releaseGate(lease); }
  assert.ok((await loadCanonicalData(root)).songs.length);
});

test("collector does not hold canonical gate over network fetch or staging save", async (t) => {
  const root = await fixture(t, true); let fetched = false;
  await assert.rejects(collectCandidates({ root, artistSlug: "rosychronicle", fetchImpl: async () => {
    fetched = true;
    await missing(join(root, GATE_PATH));
    const other = await acquireGate({ root, operation: "runtime_write" }); await releaseGate(other);
    throw new Error("stop test network");
  } }), /stop test network|Collection aborted/);
  assert.equal(fetched, true);
  await missing(join(root, GATE_PATH));
});

test("partial bootstrap and unknown pending artifacts fail closed", async (t) => {
  const root = await fixture(t, true); await fs.mkdir(join(root, "staging"));
  for (const path of ["staging/fn004-state.json", "staging/fn004-bootstrap.json", "staging/apply-requests/r.json", "staging/transactions/tx/intent.json"]) {
    await fs.mkdir(join(root, path, ".."), { recursive: true }); await fs.writeFile(join(root, path), "{}");
    await assert.rejects(readValidatedCanonicalSnapshot(root), hasCode(path.includes("fn004-") ? "BOOTSTRAP_INCOMPLETE" : "RECOVERY_REQUIRED"));
    await fs.rm(join(root, path));
    if (path.includes("transactions")) await fs.rm(join(root, "staging/transactions"), { recursive: true });
  }
  assert.equal((await readValidatedCanonicalSnapshot(root)).validation.ok, true);
});

test("repository only exposes known artifact paths and requires a live write lease", async (t) => {
  const root = await fixture(t), repo = await createFn004Repository(root);
  await assert.rejects(repo.writeJsonAtomic("staging/decisions.json", {}), hasCode("GATE_OWNERSHIP_MISMATCH"));
  await withCanonicalGate({ root, operation: "runtime_write", fn: async (gate) => {
    for (const path of ["data/songs.csv", "../../outside.json", "staging/../x.json", "staging/unknown/x.json", "staging/apply-plans/../../outside.json", "staging\\decisions.json"]) {
      await assert.rejects(repo.writeJsonAtomic(path, {}, { gate }), hasCode("PATH_UNSAFE"));
    }
    await repo.writeJsonAtomic("staging/decisions.json", { schema_version: 1, revisions: [] }, { gate });
    assert.deepEqual(await repo.readJson("staging/decisions.json", { gate }), { schema_version: 1, revisions: [] });
    await repo.createJsonExclusive("staging/transactions/example.json", { test: true }, { gate });
    await assert.rejects(repo.createJsonExclusive("staging/transactions/example.json", {}, { gate }), hasCode("PERSISTENCE_ALREADY_EXISTS"));
  } });
  assert.equal(repo.writeCanonical, undefined);
});

test("persistence: directory creation, atomic replace, UTF-8 roundtrip, no successful temp leftovers", async (t) => {
  const root = await fixture(t), store = await createPersistence(root);
  assert.equal(await store.exists("nested/record.json"), false);
  await store.writeJsonAtomic("nested/record.json", { title: "日本語😀", old: true });
  assert.deepEqual(await store.readJson("nested/record.json"), { title: "日本語😀", old: true });
  await store.writeJsonAtomic("nested/record.json", { replaced: true });
  assert.deepEqual(await store.readJson("nested/record.json"), { replaced: true });
  assert.deepEqual(await fs.readdir(join(root, "nested")), ["record.json"]);
  await store.createJsonExclusive("nested/immutable.json", { complete: true });
  assert.deepEqual(await store.readJson("nested/immutable.json"), { complete: true });
  await assert.rejects(store.createJsonExclusive("nested/immutable.json", { overwrite: true }), hasCode("PERSISTENCE_ALREADY_EXISTS"));
  assert.deepEqual(await store.readJson("nested/immutable.json"), { complete: true });
});

test("JSON read distinguishes missing, invalid UTF-8, malformed JSON and wrong root", async (t) => {
  const root = await fixture(t), store = await createPersistence(root);
  await assert.rejects(store.readJson("missing.json"), hasCode("PERSISTENCE_NOT_FOUND"));
  for (const [value, code] of [[Buffer.from([0xc3, 0x28]), "PERSISTENCE_INVALID_UTF8"], ["{", "PERSISTENCE_PARSE_FAILED"], ["[]", "PERSISTENCE_ROOT_TYPE"], ["null", "PERSISTENCE_ROOT_TYPE"]]) {
    await fs.writeFile(join(root, "bad.json"), value);
    await assert.rejects(store.readJson("bad.json"), hasCode(code));
  }
  await fs.writeFile(join(root, "unknown-schema.json"), '{"schema_version":999}');
  assert.deepEqual(await store.readJson("unknown-schema.json"), { schema_version: 999 }); // no domain interpretation
  const unreadable = await createPersistence(root, { io: { ...fs, readFile: async () => { throw fault(); } } });
  await assert.rejects(unreadable.readJson("bad.json"), hasCode("PERSISTENCE_READ_FAILED"));
});

for (const stage of ["temp_create", "temp_write", "file_sync", "temp_verify", "rename"]) test(`persistence ${stage} failure preserves original and reports failure`, async (t) => {
  const root = await fixture(t), path = join(root, "record.json"); await fs.writeFile(path, '{"original":true}');
  const io = { ...fs,
    open: stage === "temp_create" ? async (...args) => { if (args[1] === "wx") throw fault(); return fs.open(...args); } : injectedOpen((path, flags, name) => flags === "wx" && ((stage === "temp_write" && name === "writeFile") || (stage === "file_sync" && name === "sync")) ? async () => { throw fault(); } : null),
    rename: stage === "rename" ? async () => { throw fault(); } : fs.rename,
    readFile: stage === "temp_verify" ? async () => Buffer.from("wrong bytes") : fs.readFile
  };
  const store = await createPersistence(root, { io });
  await assert.rejects(store.writeJsonAtomic("record.json", { replacement: true }), (error) => error.code === "PERSISTENCE_WRITE_FAILED" && error.published === false);
  assert.equal(await fs.readFile(path, "utf8"), '{"original":true}');
});

test("post-publication directory fsync failure is not success and is explicitly published", async (t) => {
  const root = await fixture(t);
  const store = await createPersistence(root, { io: { ...fs, open: injectedOpen((path, flags, name) => flags === "r" && name === "sync" ? async () => { throw fault(); } : null) } });
  await assert.rejects(store.writeJsonAtomic("record.json", { published: true }), (error) => error.code === "PERSISTENCE_WRITE_FAILED" && error.phase === "directory_sync" && error.published === true);
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, "record.json"))), { published: true });
});

test("new directory parent fsync failure is not ignored", async (t) => {
  const root = await fixture(t);
  const store = await createPersistence(root, { io: { ...fs, open: injectedOpen((path, flags, name) => flags === "r" && name === "sync" ? async () => { throw fault(); } : null) } });
  await assert.rejects(store.writeJsonAtomic("new/record.json", {}), (error) => error.code === "PERSISTENCE_WRITE_FAILED" && error.published === false);
  await missing(join(root, "new/record.json"));
});

test("immutable cleanup failure reports published and preserves complete artifact", async (t) => {
  const root = await fixture(t);
  const store = await createPersistence(root, { io: { ...fs, unlink: async () => { throw fault(); } } });
  await assert.rejects(store.createJsonExclusive("record.json", { complete: true }), (error) => error.code === "PERSISTENCE_WRITE_FAILED" && error.phase === "temp_cleanup" && error.published === true);
  assert.deepEqual(await (await createPersistence(root)).readJson("record.json"), { complete: true });
});

test("exclusive target is absent until complete temp has synced and been verified", async (t) => {
  const root = await fixture(t);
  const store = await createPersistence(root, { io: { ...fs, link: async (temp, target) => {
    await missing(target);
    assert.deepEqual(JSON.parse(await fs.readFile(temp)), { complete: true });
    await fs.link(temp, target);
  } } });
  await store.createJsonExclusive("record.json", { complete: true });
  assert.deepEqual(await fs.readdir(root), ["record.json"]);
});

test("exclusive publication exposes only complete bytes and never overwrites a racing creator", async (t) => {
  const root = await fixture(t), first = await createPersistence(root), second = await createPersistence(root);
  const results = await Promise.allSettled([first.createJsonExclusive("one.json", { actor: 1 }), second.createJsonExclusive("one.json", { actor: 2 })]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.find((item) => item.status === "rejected").reason.code, "PERSISTENCE_ALREADY_EXISTS");
  assert.ok([1, 2].includes((await first.readJson("one.json")).actor));
});

test("path traversal, Windows path syntax, symlink ancestors/final targets and data symlinks rejected", async (t) => {
  const root = await fixture(t, true), outside = await fixture(t), store = await createPersistence(root);
  for (const path of ["../outside.json", "/absolute.json", "C:/outside.json", "a\\b.json", "a//b.json", "a/./b.json"]) await assert.rejects(store.writeJsonAtomic(path, {}), hasCode("PATH_UNSAFE"));
  await fs.symlink(outside, join(root, "escape"), "junction");
  await assert.rejects(store.writeJsonAtomic("escape/outside.json", {}), hasCode("PATH_UNSAFE"));
  await fs.writeFile(join(outside, "existing.json"), "{}");
  await fs.symlink(join(outside, "existing.json"), join(root, "linked.json"));
  await assert.rejects(store.readJson("linked.json"), hasCode("PATH_UNSAFE"));
  await assert.rejects(store.writeJsonAtomic("linked.json", {}), hasCode("PATH_UNSAFE"));
  await fs.rename(join(root, "data/works.csv"), join(outside, "works.csv"));
  await fs.symlink(join(outside, "works.csv"), join(root, "data/works.csv"));
  await assert.rejects(readValidatedCanonicalSnapshot(root), hasCode("PATH_UNSAFE"));
});

test("realpath root aliases use the same gate", async (t) => {
  const root = await fixture(t), parent = await fixture(t), alias = join(parent, "alias");
  await fs.symlink(root, alias, "junction");
  const gate = await acquireGate({ root });
  await assert.rejects(acquireGate({ root: alias }), hasCode("GATE_BUSY"));
  await assertGateOwnership(gate, alias); await releaseGate(gate);
});

test("cross-process crash retains lock and next process cannot auto-unlock", { timeout: 10000 }, async (t) => {
  const probe = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  if (probe.error?.code === "EPERM") { t.skip("Environment blocks spawnSync (also reproduced on origin/main); worker exclusion test still runs"); return; }
  assert.equal(probe.status, 0);
  const root = await fixture(t), script = join(root, "owner.mjs");
  await fs.writeFile(script, `import {acquireGate} from ${JSON.stringify(gateUrl)}; await acquireGate({root:process.argv[2]}); process.send('held'); setInterval(()=>{},1000);`);
  const child = fork(script, [root], { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  try {
    assert.equal((await once(child, "message"))[0], "held");
    await assert.rejects(acquireGate({ root }), hasCode("GATE_BUSY"));
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    await assert.rejects(acquireGate({ root }), hasCode("GATE_BUSY"));
    assert.ok(await fs.stat(join(root, GATE_PATH)));
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

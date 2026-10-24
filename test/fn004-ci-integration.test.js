import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditGitIds, inspectGitIdentity } from "../src/fn004-git-audit.js";
import { currentIdMaxima, maximumMaps } from "../src/fn004-id-audit.js";
import { DECLARATION_STATEMENT } from "../src/fn004-state.js";
import { checkBootstrap, initializeBootstrap, inspectBootstrapStatus } from "../src/fn004-bootstrap.js";
import { readValidatedCanonicalSnapshot } from "../src/fn004-repository.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const artifacts = ["staging/fn004-bootstrap.json", "staging/fn004-state.json"];
async function git(cwd, ...args) {
  const { stdout } = await execute("git", ["-C", cwd, "-c", "user.name=CI integration test",
    "-c", "user.email=ci-integration@example.invalid", ...args], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
async function commit(cwd, message) {
  await git(cwd, "commit", "-q", "--allow-empty", "-m", message);
}
async function initializedOrigin(parent) {
  const origin = join(parent, "origin");
  await mkdir(origin);
  // Copy content only: no production .git, state, candidates or lock. Actual
  // scripts resolve their root from import.meta.dirname, so run copied scripts.
  for (const path of ["data", "src", "scripts", "site/data/rankings", "package.json", ".gitignore"]) {
    await cp(join(root, path), join(origin, path), { recursive: true });
  }
  await git(origin, "init", "-q", "-b", "main");
  await git(origin, "add", "--all");
  await commit(origin, "Canonical fixture");
  await git(origin, "update-ref", "refs/remotes/origin/main", "HEAD");
  const snapshot = await readValidatedCanonicalSnapshot(origin), historical = await auditGitIds(origin);
  const declaration = { schema_version: 1,
    namespaces: maximumMaps(currentIdMaxima(snapshot), historical.maxima),
    statement: DECLARATION_STATEMENT, evidence: [], note: "Disposable CI fixture only; not a production declaration." };
  const check = await checkBootstrap({ root: origin, external_declaration: declaration });
  assert.equal(check.readiness, "initializable");
  // This root is always a newly-created temporary repository, never production.
  const initialized = await initializeBootstrap({ root: origin, external_declaration: declaration,
    expected_audit_hash: check.audit_hash, actor: { id: "local:ci-integration-test", assurance: "local_process" } });
  assert.equal(initialized.readiness, "initialized");
  await git(origin, "add", ...artifacts);
  await commit(origin, "Initialized fixture state");
  const main = await git(origin, "rev-parse", "HEAD");
  await git(origin, "update-ref", "refs/remotes/origin/main", main);

  // A PR merge commit is deliberately different from authoritative main.
  await git(origin, "checkout", "-q", "-b", "feature");
  await commit(origin, "Unmerged feature commit");
  await git(origin, "checkout", "-q", "-b", "pr-merge", "main");
  await git(origin, "merge", "-q", "--no-ff", "-m", "Synthetic PR merge", "feature");
  const merge = await git(origin, "rev-parse", "HEAD");
  await git(origin, "update-ref", "refs/pull/1/merge", merge);
  return { origin, main, merge, snapshot, initialized };
}
async function checkout(parent, fixture, name, { shallow = false } = {}) {
  const cwd = join(parent, name);
  await mkdir(cwd);
  await git(cwd, "init", "-q");
  await git(cwd, "remote", "add", "origin", pathToFileURL(fixture.origin).href);
  // Only main and the PR merge ref are needed; no tag/other branch dependency.
  await git(cwd, "fetch", "--quiet", "--no-tags", ...(shallow ? ["--depth=1"] : []), "origin",
    "+refs/heads/main:refs/remotes/origin/main", "+refs/pull/1/merge:refs/remotes/pull/1/merge");
  await git(cwd, "checkout", "-q", "--detach", "refs/remotes/pull/1/merge");
  return cwd;
}
async function artifactBytes(cwd) {
  return Promise.all(artifacts.map((path) => readFile(join(cwd, path))));
}
async function blockedScripts(cwd) {
  for (const script of ["scripts/validate-rankings.js", "scripts/generate-rankings.js"]) {
    await assert.rejects(execute(process.execPath, [script], { cwd }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /BOOTSTRAP_AUDIT_INCOMPLETE/);
      return true;
    });
  }
}

test("actual GitHub Actions checkout has complete origin/main history", {
  skip: process.env.GITHUB_ACTIONS !== "true" ? "Checks the actual Actions checkout; local fixtures run below" : false
}, async (t) => {
  const identity = await inspectGitIdentity(root); // rejects shallow or missing ref
  assert.equal(await git(root, "rev-parse", "--is-shallow-repository"), "false");
  assert.equal(identity.head, await git(root, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"));
  t.diagnostic(`CI checkout shallow=false; origin/main=${identity.head}; HEAD=${await git(root, "rev-parse", "HEAD")}`);
});

test("initialized-state CI: full detached PR checkout succeeds; shallow/missing main stay blocked", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "fn004-ci-integration-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const fixture = await initializedOrigin(parent), bytes = await artifactBytes(fixture.origin);
  const full = await checkout(parent, fixture, "full");

  await t.test("full history, origin/main and detached PR HEAD: status/read/scripts/drift PASS", async () => {
    assert.equal(await git(full, "rev-parse", "--is-shallow-repository"), "false");
    assert.equal(await git(full, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
    assert.equal(await git(full, "rev-parse", "HEAD"), fixture.merge);
    assert.equal(await git(full, "rev-parse", "origin/main"), fixture.main);
    assert.notEqual(fixture.main, fixture.merge);
    const historical = await auditGitIds(full);
    assert.equal(historical.git.audited_head, fixture.main);
    assert.equal(historical.git.complete, true);
    assert.equal(historical.git.reachable_commit_count, 2); // excludes PR-only parents
    const status = await inspectBootstrapStatus({ root: full });
    assert.equal(status.status, "READY");
    assert.equal(status.readiness, "initialized");
    assert.equal(status.existing_identity.repository_instance_id, fixture.initialized.repository_instance_id);
    const snapshot = await readValidatedCanonicalSnapshot(full);
    assert.equal(snapshot.validation.ok, true);
    assert.equal(snapshot.manifest.files.length, 14);
    assert.deepEqual(snapshot.manifest, fixture.snapshot.manifest);
    await execute(process.execPath, ["scripts/validate-rankings.js"], { cwd: full }); // nonzero rejects
    const generated = join(full, "site/data/rankings/G00001.json");
    const expected = await readFile(generated);
    await rm(generated); // prove generation actually writes, not just a no-op
    await execute(process.execPath, ["scripts/generate-rankings.js"], { cwd: full });
    assert.deepEqual(await readFile(generated), expected);
    assert.equal(await git(full, "diff", "--exit-code", "--", "site/data/rankings"), "");
    assert.deepEqual(await artifactBytes(full), bytes);
    assert.equal(await git(full, "status", "--porcelain"), "");
  });

  await t.test("same initialized artifacts in a real depth=1 checkout: blocking", async () => {
    const shallow = await checkout(parent, fixture, "shallow", { shallow: true });
    assert.equal(await git(shallow, "rev-parse", "--is-shallow-repository"), "true");
    assert.equal(await git(shallow, "rev-parse", "origin/main"), fixture.main);
    assert.deepEqual(await artifactBytes(shallow), bytes);
    assert.equal((await inspectBootstrapStatus({ root: shallow })).status, "BOOTSTRAP_AUDIT_INCOMPLETE");
    await assert.rejects(readValidatedCanonicalSnapshot(shallow), (error) => error.code === "BOOTSTRAP_AUDIT_INCOMPLETE");
    await blockedScripts(shallow);
    assert.deepEqual(await artifactBytes(shallow), bytes);
    assert.equal(await git(shallow, "status", "--porcelain"), "");
  });

  await t.test("complete history without origin/main: blocking", async () => {
    const missing = await checkout(parent, fixture, "missing-main");
    await git(missing, "update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(await git(missing, "rev-parse", "--is-shallow-repository"), "false");
    assert.deepEqual(await artifactBytes(missing), bytes);
    assert.equal((await inspectBootstrapStatus({ root: missing })).status, "BOOTSTRAP_AUDIT_INCOMPLETE");
    await assert.rejects(readValidatedCanonicalSnapshot(missing), (error) => error.code === "BOOTSTRAP_AUDIT_INCOMPLETE");
    await blockedScripts(missing);
    assert.deepEqual(await artifactBytes(missing), bytes);
  });

  // Every caller released its own lock; no runtime evidence was committed.
  for (const cwd of [fixture.origin, full, join(parent, "shallow"), join(parent, "missing-main")]) {
    assert.deepEqual((await readdir(join(cwd, "staging"))).sort(),
      cwd === fixture.origin ? ["apply-history", "fn004-bootstrap.json", "fn004-state.json", "transactions"] : ["fn004-bootstrap.json", "fn004-state.json"]);
  }
});

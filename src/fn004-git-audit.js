import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { emptyMaxima, maximumMaps, historicalCsvMaxima } from "./fn004-id-audit.js";
import { RepositoryError } from "./persistence.js";

const execute = promisify(execFile);
// No shell, network fetch, config mutations, replacement objects or lazy fetch.
// Injected runner is a trusted test seam, never an application/client option.
export async function runAuditGit(root, args) {
  if (!["rev-parse", "for-each-ref", "rev-list", "ls-tree", "cat-file"].includes(args[0])) {
    throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Only readonly audit Git commands are supported");
  }
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  // A caller's Git context must not redirect this root's audit to another DB,
  // namespace, graft/shallow file or worktree. No Git configuration is changed.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE", "GIT_SHALLOW_FILE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_REPLACE_REF_BASE", "GIT_GRAFT_FILE"]) delete env[key];
  const { stdout } = await execute("git", ["--no-replace-objects", "-C", root, ...args], {
    encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
    env
  });
  return stdout;
}

export async function inspectGitIdentity(root, { run = runAuditGit } = {}) {
  try {
    const text = async (...args) => new TextDecoder("utf-8", { fatal: true }).decode(await run(root, args)).trim();
    if (await realpath(await text("rev-parse", "--show-toplevel")) !== await realpath(root)) throw new Error("Audit root is not the Git working tree root");
    if (await text("rev-parse", "--is-shallow-repository") !== "false") throw new Error("Shallow history");
    if (await text("for-each-ref", "--format=%(refname)", "refs/replace/")) throw new Error("Replacement objects are not supported");
    const graftPath = resolve(root, await text("rev-parse", "--git-path", "info/grafts"));
    try { if ((await readFile(graftPath)).length) throw new Error("Grafted history is not supported"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const format = await text("rev-parse", "--show-object-format");
    const head = await text("rev-parse", "--verify", "refs/remotes/origin/main^{commit}");
    const sha = format === "sha1" ? /^[0-9a-f]{40}$/ : format === "sha256" ? /^[0-9a-f]{64}$/ : null;
    if (!sha?.test(head)) throw new Error("Unsupported or ambiguous authoritative ref");
    return { head, format, sha };
  } catch (cause) {
    throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Cannot establish complete authoritative Git history", { cause });
  }
}

export async function auditGitIds(root, { run = runAuditGit } = {}) {
  try {
    const { head, format, sha } = await inspectGitIdentity(root, { run });
    const graphText = new TextDecoder("utf-8", { fatal: true }).decode(await run(root, ["rev-list", "--parents", head])).trim();
    const graph = graphText.split("\n").map((line) => line.split(" "));
    const commits = new Set(graph.map(([commit]) => commit));
    if (!commits.has(head) || commits.size !== graph.length || graph.some((line) => line.some((id) => !sha.test(id) || !commits.has(id)))) throw new Error("Incomplete parent graph");
    const roots = graph.filter((line) => line.length === 1).map(([id]) => id).sort();
    if (!roots.length) throw new Error("No graph root");
    let maxima = emptyMaxima();
    const audited = new Set();
    for (const [commit] of graph) {
      const tree = await run(root, ["ls-tree", "-r", "-z", commit, "--", "data"]);
      const entries = new TextDecoder("utf-8", { fatal: true }).decode(tree).split("\0");
      if (entries.pop() !== "") throw new Error("Invalid tree output");
      for (const entry of entries) {
        const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(entry);
        if (!match) throw new Error("Invalid tree entry");
        const [, mode, type, object, path] = match;
        if (path === "data") throw new Error("Canonical directory is not an auditable tree");
        if (!/^data\/[^/]+\.csv$/.test(path)) continue;
        if (type !== "blob" || !["100644", "100755"].includes(mode) || !sha.test(object)) throw new Error("Unsupported canonical tree entry");
        const key = `${path}:${object}`;
        if (!audited.has(key)) {
          maxima = maximumMaps(maxima, historicalCsvMaxima(path, await run(root, ["cat-file", "blob", object])));
          audited.add(key);
        }
      }
    }
    const after = await inspectGitIdentity(root, { run });
    if (after.head !== head || after.format !== format) throw new Error("Authoritative ref changed during audit");
    return { maxima, git: { authoritative_ref: "origin/main", audited_head: head, object_format: format,
      history_scope: "all_reachable_parents", history_rule_version: 1, shallow: false, complete: true,
      reachable_commit_count: commits.size, root_commits: roots } };
  } catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    throw new RepositoryError("BOOTSTRAP_AUDIT_INCOMPLETE", "Authoritative canonical ID audit is incomplete", { cause });
  }
}

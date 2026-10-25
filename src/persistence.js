import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import { parseStrictJson } from "./strict-json.js";
import { canonicalJson } from "./canonical-hash.js";

// One small machine-readable error type for repository, gate and persistence.
export class RepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message, { cause: details.cause });
    this.name = "RepositoryError";
    Object.assign(this, details, { code });
    this.diagnostics = details.diagnostics ?? [{ code, severity: "error", message,
      ...(details.path ? { file: details.path } : {}) }];
  }
}

// Local cooperating filesystem only. io injection is for fault tests, never
// untrusted client input. The application repository restricts artifact paths.
export async function createPersistence(root, { io = fs } = {}) {
  let resolvedRoot;
  try { resolvedRoot = await io.realpath(root); }
  catch (cause) { throw new RepositoryError("PERSISTENCE_READ_FAILED", "Cannot resolve repository root", { cause }); }
  if (!(await io.stat(resolvedRoot)).isDirectory()) throw new RepositoryError("PATH_UNSAFE", "Repository root must be a directory");
  function segments(path) {
    if (typeof path !== "string" || !path || path.split("/").some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) {
      throw new RepositoryError("PATH_UNSAFE", "Expected a repository-relative POSIX path", { path });
    }
    return path.split("/");
  }
  async function resolvePath(path) {
    const parts = segments(path);
    let target = resolvedRoot;
    for (let index = 0; index < parts.length; index++) {
      target = join(target, parts[index]);
      try {
        const stat = await io.lstat(target);
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new RepositoryError("PATH_UNSAFE", "Symlink or non-directory ancestor is not supported", { path });
      } catch (error) {
        if (error instanceof RepositoryError) throw error;
        if (error.code !== "ENOENT") throw new RepositoryError("PERSISTENCE_READ_FAILED", "Cannot inspect repository path", { path, cause: error });
      }
    }
    return target;
  }
  const relativePath = (path) => relative(resolvedRoot, path).split(sep).join("/");
  async function syncDirectoryPath(path) {
    const handle = await io.open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function syncDirectory(path) {
    try { await syncDirectoryPath(await resolvePath(path)); }
    catch (cause) { throw new RepositoryError("PERSISTENCE_SYNC_FAILED", "Directory sync failed; durability is not established", { path, cause }); }
  }
  async function ensureDirectory(path) {
    const parts = segments(path);
    let current = resolvedRoot;
    try {
      for (const part of parts) {
        const parent = current;
        current = join(current, part);
        // lstat before mkdir also rejects a pre-existing symlink, including one
        // that points back inside root. No recursive mkdir follows user links.
        await resolvePath(relativePath(current));
        let created = false;
        try { await io.mkdir(current); created = true; }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        if (created) await syncDirectoryPath(parent);
        const stat = await io.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RepositoryError("PATH_UNSAFE", "Expected a real directory", { path });
      }
    } catch (cause) {
      if (cause instanceof RepositoryError) throw cause;
      throw new RepositoryError("PERSISTENCE_WRITE_FAILED", "Directory creation/sync failed", { path, cause });
    }
  }
  async function exists(path) {
    try { await io.lstat(await resolvePath(path)); return true; }
    catch (cause) {
      if (cause.code === "ENOENT") return false;
      if (cause instanceof RepositoryError) throw cause;
      throw new RepositoryError("PERSISTENCE_READ_FAILED", "Cannot inspect artifact", { path, cause });
    }
  }
  async function readJson(path, { strict = false } = {}) {
    let bytes, text, value;
    try { bytes = await io.readFile(await resolvePath(path)); }
    catch (cause) {
      if (cause instanceof RepositoryError) throw cause;
      throw new RepositoryError(cause.code === "ENOENT" ? "PERSISTENCE_NOT_FOUND" : "PERSISTENCE_READ_FAILED", "Cannot read JSON artifact", { path, cause });
    }
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (cause) { throw new RepositoryError("PERSISTENCE_INVALID_UTF8", "JSON artifact is not UTF-8", { path, cause }); }
    try { value = strict ? parseStrictJson(bytes) : JSON.parse(text); }
    catch (cause) { throw new RepositoryError("PERSISTENCE_PARSE_FAILED", "Malformed JSON artifact", { path, cause }); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RepositoryError("PERSISTENCE_ROOT_TYPE", "JSON artifact must have an object root", { path });
    return value; // Domain schema/version validation belongs to the caller.
  }
  async function publish(path, value, exclusive) {
    let temp, handle, published = false, phase = "encode";
    try {
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RepositoryError("PERSISTENCE_ROOT_TYPE", "JSON artifact must have an object root", { path });
      const bytes = Buffer.from(canonicalJson(value) + "\n", "utf8");
      const target = await resolvePath(path);
      const parent = dirname(target);
      phase = "ensure_directory";
      if (parent !== resolvedRoot) await ensureDirectory(relativePath(parent));
      temp = join(parent, `.fn004-${basename(target)}.tmp-${randomUUID()}`);
      phase = "temp_create";
      handle = await io.open(temp, "wx", 0o600);
      phase = "temp_write";
      await handle.writeFile(bytes);
      phase = "file_sync";
      await handle.sync();
      await handle.close(); handle = null;
      phase = "temp_verify";
      if (!(await io.readFile(temp)).equals(bytes)) throw new Error("Temporary artifact bytes changed");
      await resolvePath(path);
      phase = "publish";
      if (exclusive) await io.link(temp, target); // complete bytes, no clobber
      else await io.rename(temp, target); // same-directory atomic replace
      published = true;
      phase = "directory_sync";
      await syncDirectoryPath(parent);
      if (exclusive) {
        phase = "temp_cleanup";
        await io.unlink(temp);
        await syncDirectoryPath(parent);
      }
    } catch (cause) {
      if (handle) { try { await handle.close(); } catch { /* original failure retained */ } }
      if (cause instanceof RepositoryError) {
        Object.assign(cause, { phase, published, temp: temp && relativePath(temp) });
        throw cause;
      }
      throw new RepositoryError(exclusive && phase === "publish" && cause.code === "EEXIST" ? "PERSISTENCE_ALREADY_EXISTS" : "PERSISTENCE_WRITE_FAILED",
        "JSON publication failed; inspect phase and published before retry", { path, temp: temp && relativePath(temp), phase, published, cause });
      // Never sweep temp files. Failure artifacts belong to the failing caller.
    }
  }
  return Object.freeze({ root: resolvedRoot, resolvePath, ensureDirectory, exists, readJson, syncDirectory,
    writeJsonAtomic: (path, value) => publish(path, value, false),
    createJsonExclusive: (path, value) => publish(path, value, true) });
}

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./hash.js";
import { applyMutationText, mutationDiff, type AppliedMutation, type CodeMutation } from "./schemas/root-cause.js";

/*
 * Isolation for root-cause experiments. Every arm (baseline and each
 * intervention) runs on its own copy of the application. The source tree is
 * only ever read; its hash is recorded before and after so a report can
 * prove it was not modified.
 */

function inside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function listFiles(root: string, entry: string): Promise<string[]> {
  const path = join(root, entry);
  const info = await stat(path);
  if (info.isFile()) return [entry];
  const names = (await readdir(path)).sort();
  const nested = await Promise.all(names.map((name) => listFiles(root, `${entry}/${name}`)));
  return nested.flat();
}

/** Every file of the included entries, as sorted forward-slash relative paths. */
export async function listTree(dir: string, include: readonly string[]): Promise<string[]> {
  return (await Promise.all(include.map((entry) => listFiles(dir, entry)))).flat().sort();
}

/** sha256 over the sorted paths and contents of the included entries. */
export async function hashTree(dir: string, include: readonly string[]): Promise<{ files: number; hash: string }> {
  const files = (await Promise.all(include.map((entry) => listFiles(dir, entry)))).flat().sort();
  const parts: string[] = [];
  for (const file of files) parts.push(`${file}\0${sha256(await readFile(join(dir, file)))}`);
  return { files: files.length, hash: sha256(parts.join("\n")) };
}

/** Copies the included entries of `sourceDir` into a new, empty `workspaceDir`. */
export async function createWorkspace(sourceDir: string, include: readonly string[], workspaceDir: string): Promise<void> {
  if (inside(sourceDir, workspaceDir)) throw new Error("the workspace must be outside the source directory");
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  for (const entry of include) {
    const from = join(sourceDir, entry);
    if (!inside(sourceDir, from)) throw new Error(`include entry escapes the source directory: ${entry}`);
    await cp(from, join(workspaceDir, entry), { recursive: true, errorOnExist: true });
  }
}

/** Applies a mutation inside a workspace (never anywhere else). */
export async function applyMutation(workspaceDir: string, mutation: CodeMutation): Promise<{ ok: true; applied: AppliedMutation } | { ok: false; reason: string }> {
  const file = join(workspaceDir, mutation.file);
  if (!inside(workspaceDir, file)) return { ok: false, reason: `mutation target escapes the workspace: ${mutation.file}` };
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return { ok: false, reason: `${mutation.file} does not exist in the workspace` };
  }
  const result = applyMutationText(source, mutation);
  if (!result.ok) return result;
  await writeFile(file, result.text, "utf8");
  return {
    ok: true,
    applied: { file: mutation.file, sha256Before: sha256(source), sha256After: sha256(result.text), diff: mutationDiff(mutation.file, mutation) },
  };
}

export async function removeWorkspace(workspaceDir: string): Promise<void> {
  // Retries cover Windows, where a just-exited process can hold the directory briefly.
  await rm(workspaceDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

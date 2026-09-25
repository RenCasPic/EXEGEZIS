import { userInfo } from "node:os";
import { join } from "node:path";
import { readText } from "./evidence/read";
import { repoRoot } from "./workspace";

/** Repository facts read from `.git` (no git process, no network). */
export interface RepositoryInfo {
  name: string;
  branch: string | null;
  remote: string | null;
}

export async function repositoryInfo(): Promise<RepositoryInfo> {
  const root = repoRoot();
  const head = await readText(join(root, ".git", "HEAD"), 4096);
  const config = await readText(join(root, ".git", "config"), 64 * 1024);
  const branch = head === null ? null : (/^ref: refs\/heads\/(.+)$/m.exec(head.trim())?.[1] ?? null);
  const url = config === null ? null : (/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1] ?? null);
  const remote = url === null ? null : url.replace(/^https?:\/\/[^/]*@/, "https://").replace(/\.git$/, "");
  const name = remote?.replace(/^.*github\.com[/:]/, "") ?? root.split(/[\\/]/).pop() ?? "repository";
  return { name, branch, remote };
}

export function localUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "local";
  }
}

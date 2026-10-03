import { spawn } from "node:child_process";
import { AccessStore, type AccessEntry, type SiteSettings } from "@exegezis/access";
import { cliEntry } from "./jobs";
import { currentWorkspace, workspaceEnv } from "./user-workspace";
import { repoRoot } from "./workspace";

/**
 * The web side of saved access: metadata only (index.json). The web never
 * decrypts anything; it asks the CLI, passing secrets through stdin.
 */
/** This user's store of saved accesses. */
async function store(): Promise<AccessStore> {
  const ws = await currentWorkspace();
  return new AccessStore(ws.access);
}

export async function listAccess(): Promise<{ dir: string; entries: AccessEntry[] }> {
  const s = await store();
  return { dir: s.dir, entries: await s.index() };
}

export async function accessEntry(origin: string): Promise<AccessEntry | null> {
  return (await store()).entry(origin);
}

export async function deleteAccess(origin: string): Promise<void> {
  await (await store()).delete(origin);
}

export async function setSiteSettings(origin: string, patch: Partial<SiteSettings>): Promise<void> {
  const s = await store();
  const entry = await s.entry(origin);
  await s.touch(origin, { settings: { robotsOwner: entry?.settings.robotsOwner ?? false, unsafeLinkPatterns: entry?.settings.unsafeLinkPatterns ?? [], ...patch } });
}

export function accessState(entry: AccessEntry, now = Date.now()): "active" | "expired" | "none" {
  if (!entry.kinds.includes("session") && !entry.kinds.includes("httpCredentials") && !entry.kinds.includes("wafToken")) return "none";
  if (entry.expired || (entry.expiresAt !== null && Date.parse(entry.expiresAt) < now)) return "expired";
  return "active";
}

/** Runs the CLI without a shell; `stdin` carries any secret. Output stays in memory, never in a log file. */
export async function runCli(args: string[], stdin = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // The CLI reads and writes this workspace only (the user's own folders).
  const env = { ...process.env, ...workspaceEnv(await currentWorkspace()) };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry(), ...args], { cwd: repoRoot(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: null, stdout, stderr: e.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

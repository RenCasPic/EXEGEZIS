import { spawn } from "node:child_process";
import { AccessStore, type AccessEntry, type SiteSettings } from "@exegezis/access";
import { cliEntry } from "./jobs";
import { repoRoot } from "./workspace";

/**
 * The web side of saved access: metadata only (index.json). The web never
 * decrypts anything; it asks the CLI, passing secrets through stdin.
 */
function store(): AccessStore {
  return new AccessStore();
}

export async function listAccess(): Promise<{ dir: string; entries: AccessEntry[] }> {
  const s = store();
  return { dir: s.dir, entries: await s.index() };
}

export async function accessEntry(origin: string): Promise<AccessEntry | null> {
  return store().entry(origin);
}

export async function deleteAccess(origin: string): Promise<void> {
  await store().delete(origin);
}

export async function setSiteSettings(origin: string, patch: Partial<SiteSettings>): Promise<void> {
  const s = store();
  const entry = await s.entry(origin);
  await s.touch(origin, { settings: { robotsOwner: entry?.settings.robotsOwner ?? false, unsafeLinkPatterns: entry?.settings.unsafeLinkPatterns ?? [], ...patch } });
}

export function accessState(entry: AccessEntry, now = Date.now()): "active" | "expired" | "none" {
  if (!entry.kinds.includes("session") && !entry.kinds.includes("httpCredentials") && !entry.kinds.includes("wafToken")) return "none";
  if (entry.expired || (entry.expiresAt !== null && Date.parse(entry.expiresAt) < now)) return "expired";
  return "active";
}

/** Runs the CLI without a shell; `stdin` carries any secret. Output stays in memory, never in a log file. */
export function runCli(args: string[], stdin = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry(), ...args], { cwd: repoRoot(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: null, stdout, stderr: e.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

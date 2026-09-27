import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { BROWSER_CHANNEL_IDS, type BrowserChannelId } from "./inspect-checks";
import { cliEntry } from "./jobs";
import { ui, type UiMessage } from "./ui-message";
import { repoRoot } from "./workspace";

/**
 * Before a job is started, the UI asks the real CLI (`exegezis doctor
 * --json`, no shell) whether a browser can start on this machine. If none
 * can, the user is told there, with the fix, and no empty job is created.
 * A positive answer is cached for a few minutes; a negative one never is.
 */
const DoctorJson = z.looseObject({
  schemaVersion: z.literal("exegezis.doctor/v1"),
  auto: z.enum(["chromium", "chrome", "msedge"]).nullable(),
  browsers: z.array(z.looseObject({ channel: z.enum(["chromium", "chrome", "msedge"]), label: z.string(), available: z.boolean(), version: z.string().nullable(), error: z.string().nullable() })),
});
export type DoctorJson = z.infer<typeof DoctorJson>;

export type BrowserCheck = { ok: true; label: string; version: string | null } | { ok: false; message: UiMessage; remedy: string[] };

/** The fixes, as commands that work unchanged in Windows CMD, PowerShell, macOS and Linux. */
export const BROWSER_REMEDY = [
  "pnpm exegezis doctor",
  "pnpm exegezis doctor --install",
];

let cached: { at: number; report: DoctorJson } | null = null;
const TTL_MS = 5 * 60_000;

async function runDoctor(): Promise<{ report: DoctorJson } | { error: UiMessage }> {
  if (!existsSync(cliEntry())) return { error: ui("common.errors.cliNotBuilt") };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry(), "doctor", "--json"], { cwd: repoRoot(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: ui("common.errors.doctorFailed", { error: e.message }) });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      try {
        resolve({ report: DoctorJson.parse(JSON.parse(out)) });
      } catch {
        resolve({ error: ui("common.errors.doctorUnreadable") });
      }
    });
  });
}

/** Whether `channel` can start now; `evaluate` is exported for tests. */
export function evaluate(report: DoctorJson, channel: BrowserChannelId): BrowserCheck {
  const probe = channel === "auto" ? report.browsers.find((b) => b.channel === report.auto) : report.browsers.find((b) => b.channel === channel);
  if (probe?.available === true) return { ok: true, label: probe.label, version: probe.version };
  const tried = channel === "auto" ? report.browsers : report.browsers.filter((b) => b.channel === channel);
  return {
    ok: false,
    message:
      channel === "auto"
        ? ui("common.errors.noBrowser", { details: tried.map((b) => `${b.label}: ${b.error ?? "—"}`).join("; ") })
        : ui("common.errors.noBrowserChannel", { channel, details: tried.map((b) => `${b.label}: ${b.error ?? "—"}`).join("; ") }),
    remedy: BROWSER_REMEDY,
  };
}

export async function checkBrowser(channel: BrowserChannelId = "auto"): Promise<BrowserCheck> {
  if (!(BROWSER_CHANNEL_IDS as readonly string[]).includes(channel)) channel = "auto";
  if (cached !== null && Date.now() - cached.at < TTL_MS) {
    const hit = evaluate(cached.report, channel);
    if (hit.ok) return hit;
  }
  const answer = await runDoctor();
  if ("error" in answer) return { ok: false, message: answer.error, remedy: BROWSER_REMEDY };
  const report = answer.report;
  const result = evaluate(report, channel);
  cached = result.ok ? { at: Date.now(), report } : null;
  return result;
}

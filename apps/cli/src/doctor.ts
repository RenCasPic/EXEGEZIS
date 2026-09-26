import { spawn } from "node:child_process";
import { platform } from "node:os";
import { candidatesFor, playwrightCliPath, playwrightVersion, probeBrowsers, type BrowserProbe } from "@exegezis/adapter-browser";
import type { EngineErrorInfo } from "@exegezis/core";
import { EXIT } from "./args.js";
import { printer, type CliIo } from "./shared.js";

const NODE_MIN = [22, 18, 0] as const;

export interface DoctorReport {
  schemaVersion: "exegezis.doctor/v1";
  platform: string;
  exegezis: string;
  node: { version: string; required: string; ok: boolean };
  /** From the user agent pnpm sets when it runs a script; null when started some other way. */
  pnpm: { version: string | null };
  playwright: string;
  browsers: BrowserProbe[];
  /** What --browser-channel auto would use right now; null: nothing can run. */
  auto: BrowserProbe["channel"] | null;
  ok: boolean;
}

function nodeOk(version: string): boolean {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = parts[i] ?? 0;
    const b = NODE_MIN[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export async function diagnose(exegezisVersion: string): Promise<DoctorReport> {
  const browsers = await probeBrowsers();
  const auto = candidatesFor("auto").find((c) => browsers.some((b) => b.channel === c && b.available)) ?? null;
  const pnpm = /\bpnpm\/(\S+)/.exec(process.env["npm_config_user_agent"] ?? "")?.[1] ?? null;
  const node = { version: process.version, required: `>=${NODE_MIN.join(".")}`, ok: nodeOk(process.version) };
  return {
    schemaVersion: "exegezis.doctor/v1",
    platform: platform(),
    exegezis: exegezisVersion,
    node,
    pnpm: { version: pnpm },
    playwright: playwrightVersion(),
    browsers,
    auto,
    ok: node.ok && auto !== null,
  };
}

/** Downloads Playwright's Chromium with the Playwright CLI the adapter uses. Only ever on --install. */
async function installChromium(io: CliIo): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCliPath(), "install", "chromium"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.on("data", (d: Buffer) => io.stdout.write(d.toString()));
    child.stderr.on("data", (d: Buffer) => io.stderr.write(d.toString()));
    child.on("error", (e) => {
      io.stderr.write(`Could not start the Playwright installer: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function print(io: CliIo, r: DoctorReport): void {
  const out = printer(io);
  const mark = (ok: boolean) => (ok ? "OK     " : "MISSING");
  out("EXEGEZIS DOCTOR");
  out();
  out(`System:     ${r.platform} · EXEGEZIS ${r.exegezis} · Playwright ${r.playwright}`);
  out(`Node.js     ${r.node.ok ? "OK     " : "TOO OLD"} ${r.node.version} (required ${r.node.required})`);
  out(`pnpm        ${r.pnpm.version === null ? "?       not detected (run this as: pnpm exegezis doctor)" : `OK      ${r.pnpm.version}`}`);
  out();
  out("Browsers (tried in this order with --browser-channel auto):");
  for (const b of r.browsers) {
    out(`  ${mark(b.available)} ${b.label.padEnd(24)} ${b.available ? (b.version ?? "") : ""}`);
    if (!b.available && b.error !== null) out(`          ${b.error}`);
  }
  out();
  if (r.auto !== null) {
    const used = r.browsers.find((b) => b.channel === r.auto);
    out(`EXEGEZIS will use: ${used?.label ?? r.auto} ${used?.version ?? ""}`.trimEnd());
  } else {
    out("EXEGEZIS cannot start any browser on this machine: inspections and verifications will stop with ENGINE_ERROR (exit code 7).");
  }

  const fixes: string[] = [];
  if (!r.node.ok) fixes.push(`Install Node.js ${r.node.required} from https://nodejs.org/ and open a new terminal.`);
  if (!r.browsers.some((b) => b.channel === "chromium" && b.available)) {
    fixes.push(
      r.auto === null
        ? "Install Playwright's Chromium (downloads ~150 MB):"
        : "Optional: install Playwright's Chromium, the reference browser (downloads ~150 MB):",
    );
    fixes.push("    pnpm exegezis doctor --install");
    if (r.auto === null) {
      fixes.push("  or install Google Chrome (https://www.google.com/chrome/); on Windows, Microsoft Edge normally comes preinstalled.");
    }
  }
  if (fixes.length > 0) {
    out();
    out("What to do (the same commands work in Windows CMD, PowerShell, macOS and Linux, from the repository folder):");
    for (const f of fixes) out(`  ${f}`);
  }
}

export async function doctorCommand(options: { install: boolean; json: boolean }, io: CliIo, exegezisVersion: string): Promise<number> {
  if (options.install) {
    const out = printer(io);
    out("Downloading Playwright's Chromium (you asked for it with --install)...");
    const code = await installChromium(io);
    if (code !== 0) {
      io.stderr.write(`The Playwright installer exited with code ${code}.\n`);
      return EXIT.engineError;
    }
    out();
  }
  const report = await diagnose(exegezisVersion);
  if (options.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else print(io, report);
  return report.ok ? EXIT.ok : EXIT.engineError;
}

/** The ENGINE_ERROR explanation shown by every command (exit code 7). */
export function printEngineError(io: CliIo, info: EngineErrorInfo): void {
  const w = (line = "") => io.stderr.write(`${line}\n`);
  w("ENGINE_ERROR: the browser could not start on this machine.");
  w("The problem is on this computer, not on the site or in the application: nothing was concluded about it.");
  w();
  w(info.message);
  for (const a of info.attempts) w(`  - ${a.engine}: ${a.error}`);
  w();
  w("How to fix it (the same commands work in Windows CMD, PowerShell, macOS and Linux):");
  for (const r of info.remedy) w(`  ${r}`);
}

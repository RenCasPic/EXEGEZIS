import { spawn } from "node:child_process";
import { platform } from "node:os";
import { candidatesFor, playwrightCliPath, playwrightVersion, probeBrowsers, type BrowserProbe } from "@exegezis/adapter-browser";
import type { EngineErrorInfo } from "@exegezis/core";
import { EXIT } from "./args.js";
import { t } from "./i18n.js";
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
      io.stderr.write(`${t("doctor.installerStart", { message: e.message })}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function print(io: CliIo, r: DoctorReport): void {
  const out = printer(io);
  const mark = (ok: boolean) => (ok ? t("doctor.ok") : t("doctor.missing"));
  out(t("doctor.title"));
  out();
  out(t("doctor.system", { platform: r.platform, version: r.exegezis, playwright: r.playwright }));
  out(t("doctor.node", { status: r.node.ok ? t("doctor.ok") : t("doctor.tooOld"), version: r.node.version, required: r.node.required }));
  out(r.pnpm.version === null ? t("doctor.pnpmMissing") : t("doctor.pnpmOk", { version: r.pnpm.version }));
  out();
  out(t("doctor.browsers"));
  for (const b of r.browsers) {
    out(`  ${mark(b.available)} ${b.label.padEnd(24)} ${b.available ? (b.version ?? "") : ""}`);
    if (!b.available && b.error !== null) out(`          ${b.error}`);
  }
  out();
  if (r.auto !== null) {
    const used = r.browsers.find((b) => b.channel === r.auto);
    out(t("doctor.willUse", { browser: `${used?.label ?? r.auto} ${used?.version ?? ""}`.trimEnd() }));
  } else {
    out(t("doctor.none"));
  }

  const fixes: string[] = [];
  if (!r.node.ok) fixes.push(t("doctor.installNode", { required: r.node.required }));
  if (!r.browsers.some((b) => b.channel === "chromium" && b.available)) {
    fixes.push(
      r.auto === null ? t("doctor.installChromium") : t("doctor.installChromiumOptional"),
    );
    fixes.push("    pnpm exegezis doctor --install");
    if (r.auto === null) {
      fixes.push(t("doctor.orChrome"));
    }
  }
  if (fixes.length > 0) {
    out();
    out(t("doctor.whatToDo"));
    for (const f of fixes) out(`  ${f}`);
  }
}

export async function doctorCommand(options: { install: boolean; json: boolean }, io: CliIo, exegezisVersion: string): Promise<number> {
  if (options.install) {
    const out = printer(io);
    out(t("doctor.downloading"));
    const code = await installChromium(io);
    if (code !== 0) {
      io.stderr.write(`${t("doctor.installerExit", { code: String(code) })}\n`);
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
  w(t("engine.title"));
  w(t("engine.where"));
  w();
  w(engineMessage(info.message));
  for (const a of info.attempts) w(`  - ${a.engine}: ${a.error}`);
  w();
  w(t("engine.howTo"));
  for (const r of info.remedy) w(`  ${remedyLine(r)}`);
}

/** The adapter writes its message in English; the known one is said again in the current language (the list of browsers as it is). */
export function engineMessage(message: string): string {
  const tried = /^No browser could be started on this machine \(tried: (.*)\)\. This is a problem/.exec(message)?.[1];
  return tried === undefined ? message : t("engine.message", { tried });
}

const REMEDY: Record<string, Parameters<typeof t>[0]> = {
  "Install Playwright's Chromium (downloads ~150 MB, only when you run this): pnpm exegezis doctor --install": "engine.remedyInstall",
  "Check what this machine has: pnpm exegezis doctor": "engine.remedyCheck",
  "Or use a browser that is already installed: Google Chrome (https://www.google.com/chrome/) or Microsoft Edge (preinstalled on Windows), with --browser-channel auto": "engine.remedyInstalled",
  "Install Google Chrome (https://www.google.com/chrome/), or run with --browser-channel auto": "engine.remedyChrome",
  "Install Microsoft Edge (https://www.microsoft.com/edge), or run with --browser-channel auto": "engine.remedyEdge",
};

/** One of the adapter's fixes in the current language (an unknown line as it is). */
export function remedyLine(line: string): string {
  const key = REMEDY[line];
  return key === undefined ? line : t(key);
}

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EngineUnavailableError, type EngineAttempt } from "@exegezis/core";
import { chromium, type Browser } from "playwright";

const require = createRequire(import.meta.url);

/** The Playwright CLI this adapter drives (for `exegezis doctor --install`, which installs *its* Chromium). */
export function playwrightCliPath(): string {
  return join(dirname(require.resolve("playwright/package.json")), "cli.js");
}

export function playwrightVersion(): string {
  return (require("playwright/package.json") as { version: string }).version;
}

/**
 * Which browser drives a run.
 * - `chromium`: Playwright's own Chromium (downloaded with `playwright install`).
 * - `chrome` / `msedge`: a browser installed on the system (Edge ships with
 *   Windows). Both are Chromium-based and run the same automation.
 * - `auto` (default): Playwright's Chromium if it is installed, otherwise
 *   Chrome, otherwise Edge. Nothing is ever downloaded implicitly.
 */
export const BROWSER_CHANNELS = ["auto", "chromium", "chrome", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];
export type ConcreteChannel = Exclude<BrowserChannel, "auto">;

export const CHANNEL_LABEL: Record<ConcreteChannel, string> = {
  chromium: "Chromium (Playwright)",
  chrome: "Google Chrome (system)",
  msedge: "Microsoft Edge (system)",
};

export type Launcher = (channel: ConcreteChannel, headless: boolean) => Promise<Browser>;

export const playwrightLauncher: Launcher = (channel, headless) => chromium.launch({ headless, ...(channel === "chromium" ? {} : { channel }) });

export interface LaunchedBrowser {
  browser: Browser;
  channel: ConcreteChannel;
  version: string;
  system: boolean;
  /** Earlier candidates that failed before this one started. */
  attempts: EngineAttempt[];
}

/** The candidates for a channel, in the order they are tried. */
export function candidatesFor(channel: BrowserChannel): ConcreteChannel[] {
  return channel === "auto" ? ["chromium", "chrome", "msedge"] : [channel];
}

/**
 * The commands that fix a missing browser. They are the same in Windows CMD,
 * PowerShell and macOS/Linux shells (pnpm is cross-platform); nothing here
 * uses shell-specific syntax.
 */
export function remedyFor(channel: BrowserChannel): string[] {
  const install = "Install Playwright's Chromium (downloads ~150 MB, only when you run this): pnpm exegezis doctor --install";
  const check = "Check what this machine has: pnpm exegezis doctor";
  switch (channel) {
    case "auto":
    case "chromium":
      return [
        install,
        "Or use a browser that is already installed: Google Chrome (https://www.google.com/chrome/) or Microsoft Edge (preinstalled on Windows), with --browser-channel auto",
        check,
      ];
    case "chrome":
      return ["Install Google Chrome (https://www.google.com/chrome/), or run with --browser-channel auto", check];
    case "msedge":
      return ["Install Microsoft Edge (https://www.microsoft.com/edge), or run with --browser-channel auto", check];
  }
}

/** Playwright's launch errors are long boxes of text; keep the lines that say what failed. */
export function launchErrorSummary(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[║╔╗╚╝═|]/g, "").trim())
    .filter((l) => l !== "" && !/^=+$/.test(l) && !/Looks like Playwright|Please run the following|playwright install|<3 Playwright Team|^npx /i.test(l));
  return lines.slice(0, 2).join(" — ").slice(0, 600);
}

// The candidate that worked last time in this process is tried first (no repeated failing launches per run).
let lastWorking: ConcreteChannel | null = null;

/**
 * Starts a browser for `channel`. Every failed candidate is recorded; if none
 * starts, EngineUnavailableError says what was tried and how to fix it.
 */
export async function launchBrowser(options: { channel: BrowserChannel; headless: boolean; launcher?: Launcher }): Promise<LaunchedBrowser> {
  const launcher = options.launcher ?? playwrightLauncher;
  let order = candidatesFor(options.channel);
  if (options.launcher === undefined && lastWorking !== null && order.includes(lastWorking)) order = [lastWorking, ...order.filter((c) => c !== lastWorking)];
  const attempts: EngineAttempt[] = [];
  for (const channel of order) {
    try {
      const browser = await launcher(channel, options.headless);
      if (options.launcher === undefined) lastWorking = channel;
      return { browser, channel, version: browser.version(), system: channel !== "chromium", attempts };
    } catch (error) {
      attempts.push({ engine: CHANNEL_LABEL[channel], error: launchErrorSummary(error) });
    }
  }
  const tried = attempts.map((a) => a.engine).join(", ");
  throw new EngineUnavailableError(
    `No browser could be started on this machine (tried: ${tried}). This is a problem with this computer, not with the site or the application.`,
    attempts,
    remedyFor(options.channel),
  );
}

export interface BrowserProbe {
  channel: ConcreteChannel;
  label: string;
  available: boolean;
  version: string | null;
  error: string | null;
}

/** Starts and closes each candidate once (for `exegezis doctor` and the UI preflight). */
export async function probeBrowsers(options: { channels?: ConcreteChannel[]; launcher?: Launcher; stopAtFirst?: boolean } = {}): Promise<BrowserProbe[]> {
  const launcher = options.launcher ?? playwrightLauncher;
  const results: BrowserProbe[] = [];
  for (const channel of options.channels ?? (["chromium", "chrome", "msedge"] as ConcreteChannel[])) {
    try {
      const browser = await launcher(channel, true);
      const version = browser.version();
      await browser.close().catch(() => undefined);
      results.push({ channel, label: CHANNEL_LABEL[channel], available: true, version, error: null });
      if (options.stopAtFirst === true) break;
    } catch (error) {
      results.push({ channel, label: CHANNEL_LABEL[channel], available: false, version: null, error: launchErrorSummary(error) });
    }
  }
  return results;
}

import type { Browser } from "playwright";
import { describe, expect, it } from "vitest";
import { launchBrowser, launchErrorSummary, probeBrowsers, remedyFor, type ConcreteChannel, type Launcher } from "../src/browsers.js";

const PLAYWRIGHT_MISSING = `browserType.launch: Executable doesn't exist at C:/Users/rene/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-win/headless_shell.exe
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝`;

/** A launcher where only the given channels exist on "this machine". */
function machine(available: ConcreteChannel[]): Launcher & { tried: ConcreteChannel[] } {
  const tried: ConcreteChannel[] = [];
  const launcher = async (channel: ConcreteChannel): Promise<Browser> => {
    tried.push(channel);
    if (!available.includes(channel)) throw new Error(channel === "chromium" ? PLAYWRIGHT_MISSING : `browserType.launch: Chromium distribution '${channel}' is not found at C:/Program Files/${channel}`);
    return { version: () => `${channel}-130.0`, close: async () => undefined } as unknown as Browser;
  };
  return Object.assign(launcher, { tried });
}

describe("browser resolution", () => {
  it("prefers Playwright's Chromium when it is installed", async () => {
    const m = machine(["chromium", "chrome", "msedge"]);
    const launched = await launchBrowser({ channel: "auto", headless: true, launcher: m });
    expect(launched).toMatchObject({ channel: "chromium", system: false, version: "chromium-130.0", attempts: [] });
    expect(m.tried).toEqual(["chromium"]);
  });

  it("falls back to system Chrome, then Edge, and records why", async () => {
    const edgeOnly = machine(["msedge"]);
    const launched = await launchBrowser({ channel: "auto", headless: true, launcher: edgeOnly });
    expect(launched).toMatchObject({ channel: "msedge", system: true });
    expect(edgeOnly.tried).toEqual(["chromium", "chrome", "msedge"]);
    expect(launched.attempts.map((a) => a.engine)).toEqual(["Chromium (Playwright)", "Google Chrome (system)"]);
    expect(launched.attempts[0]?.error).toMatch(/Executable doesn't exist .*chromium_headless_shell-1243/);
  });

  it("with no browser at all: EngineUnavailableError with every attempt and the remedy, never a result", async () => {
    const none = machine([]);
    const failure = await launchBrowser({ channel: "auto", headless: true, launcher: none }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ name: "EngineUnavailableError" });
    const e = failure as { message: string; attempts: { engine: string }[]; remedy: string[] };
    expect(e.message).toMatch(/not with the site or the application/);
    expect(e.attempts).toHaveLength(3);
    expect(e.remedy.join("\n")).toMatch(/pnpm exegezis doctor --install/);
  });

  it("an explicit channel tries only that browser", async () => {
    const m = machine(["chromium"]);
    await expect(launchBrowser({ channel: "chrome", headless: true, launcher: m })).rejects.toMatchObject({ name: "EngineUnavailableError" });
    expect(m.tried).toEqual(["chrome"]);
    expect(remedyFor("chrome").join(" ")).toMatch(/Google Chrome/);
  });

  it("keeps the useful lines of Playwright's launch error", () => {
    const summary = launchErrorSummary(new Error(PLAYWRIGHT_MISSING));
    expect(summary).toMatch(/^browserType.launch: Executable doesn't exist/);
    expect(summary).not.toMatch(/Playwright Team|╔/);
  });

  it("probes every candidate for doctor", async () => {
    const probes = await probeBrowsers({ launcher: machine(["msedge"]) });
    expect(probes.map((p) => [p.channel, p.available, p.version])).toEqual([
      ["chromium", false, null],
      ["chrome", false, null],
      ["msedge", true, "msedge-130.0"],
    ]);
  });
});

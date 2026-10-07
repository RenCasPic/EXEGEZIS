import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeBrowsers } from "@exegezis/adapter-browser";
import { InspectionReport } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";

/**
 * A browser that cannot start on this machine must never become a verdict
 * about the site or the application. The CLI runs as a child process with
 * PLAYWRIGHT_BROWSERS_PATH pointing to an empty folder: Playwright's own
 * Chromium is then missing, exactly as on a machine where
 * `playwright install` never ran. System browsers (Chrome, Edge) are not
 * affected by that variable.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = join(REPO, "apps/cli/bin/exegezis.js");
const WORK = join(REPO, "apps/cli/test/.tmp-engine");
const NO_BROWSERS = join(WORK, "no-playwright-browsers");

let server: Server;
let site: string;

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO, env: { ...process.env, ...env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("exit", (code) => done({ code, stdout, stderr }));
  });
}

function onlyInspection(out: string): { dir: string; report: InspectionReport } {
  const base = join(out, "inspections");
  const [id] = readdirSync(base);
  const dir = join(base, id as string);
  return { dir, report: InspectionReport.parse(JSON.parse(readFileSync(join(dir, "inspection-report.json"), "utf8"))) };
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(NO_BROWSERS, { recursive: true });
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="en"><title>Engine</title><main><h1>Hello</h1></main></html>');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  site = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/`;
});

afterAll(() => {
  server.close();
  rmSync(WORK, { recursive: true, force: true });
});

describe("--browser-channel and doctor arguments", () => {
  it("accepts the channels and rejects others", () => {
    expect(parseCliArgs(["inspect", "--url", "http://x.test/", "--browser-channel", "msedge"])).toMatchObject({ browserChannel: "msedge" });
    expect(parseCliArgs(["verify", "--plan", "p.json"])).toMatchObject({ browserChannel: "auto" });
    expect(() => parseCliArgs(["inspect", "--url", "http://x.test/", "--browser-channel", "firefox"])).toThrow(/--browser-channel must be one of/);
    expect(() => parseCliArgs(["compile", "--plan", "p.json", "--browser-channel", "chrome"])).toThrow(/not valid for "compile"/);
    expect(parseCliArgs(["doctor", "--install"])).toEqual({ kind: "doctor", install: true, json: false });
  });
});

describe("no browser can start: ENGINE_ERROR, never a verdict about the target", () => {
  it("inspect stops on the first attempt with exit code 7 and marks no page UNREACHABLE", async () => {
    const out = join(WORK, "inspect-none");
    const r = await cli(["inspect", "--url", site, "--runs", "3", "--max-pages", "1", "--delay", "0", "--browser-channel", "chromium", "--output", out], { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS });
    expect(r.code).toBe(7);
    expect(r.stderr).toMatch(/ENGINE_ERROR: the browser could not start on this machine/);
    expect(r.stderr).toMatch(/not on the site or in the application/);
    expect(r.stderr).toMatch(/pnpm exegezis doctor --install/);
    const { dir, report } = onlyInspection(out);
    expect(report.status).toBe("ENGINE_ERROR");
    expect(report.pages).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.engineError?.attempts).toEqual([{ engine: "Chromium (Playwright)", error: expect.stringMatching(/Executable doesn't exist/) }]);
    // One attempt only: run 1 started once; runs 2 and 3 never ran.
    expect(readdirSync(join(dir, "pages"))).toEqual(["run-1"]);
    expect(readdirSync(join(dir, "pages", "run-1"))).toHaveLength(1);
  }, 120_000);

  it("verify aborts too (exit 7) instead of reporting INCONCLUSIVE", async () => {
    const out = join(WORK, "verify-none");
    const r = await cli(
      ["verify", "--plan", "benchmarks/buggy-shop/cases/BUG-001/plan.json", "--runs", "3", "--base-url", site, "--browser-channel", "chromium", "--output", out],
      { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS },
    );
    expect(r.code).toBe(7);
    expect(r.stderr).toMatch(/ENGINE_ERROR/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/INCONCLUSIVE|NOT_VERIFIED|Outcome:/);
  }, 120_000);
});

describe("without Playwright's Chromium but with a system browser", () => {
  let system: string[] = [];
  beforeAll(async () => {
    system = (await probeBrowsers({ channels: ["chrome", "msedge"] })).filter((p) => p.available).map((p) => p.channel);
  }, 120_000);

  it("the inspection works and the report says which browser it used", async (ctx) => {
    if (system.length === 0) ctx.skip();
    const out = join(WORK, "inspect-system");
    // The checks the shop is clean for (it is a local demo without security headers): exit 0.
    const checks = "js-exceptions,console-errors,failed-requests,broken-links,a11y,mixed-content,seo-basics";
    const r = await cli(["inspect", "--url", site, "--runs", "2", "--max-pages", "1", "--delay", "0", "--devices", "desktop", "--checks", checks, "--output", out], { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS });
    expect(r.code).toBe(0);
    const { report } = onlyInspection(out);
    expect(report.status).toBe("COMPLETED");
    expect(report.tools.browser).toMatchObject({ channel: system[0], system: true });
    expect(r.stdout).toMatch(/Browser: (chrome|msedge) \S+ \(installed on this system/);
  }, 180_000);

  it("doctor --json says auto will use the system browser, and exits 0", async (ctx) => {
    if (system.length === 0) ctx.skip();
    const r = await cli(["doctor", "--json"], { PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout) as { auto: string; browsers: { channel: string; available: boolean }[] };
    expect(report.browsers.find((b) => b.channel === "chromium")?.available).toBe(false);
    expect(report.auto).toBe(system[0]);
  }, 180_000);
});

describe("a site that really does not answer", () => {
  it("is still UNREACHABLE (exit 4), not ENGINE_ERROR", async () => {
    const out = join(WORK, "inspect-unreachable");
    const r = await cli(["inspect", "--url", "http://127.0.0.1:1/", "--runs", "2", "--max-pages", "1", "--delay", "0", "--output", out]);
    expect(r.code).toBe(4);
    const { report } = onlyInspection(out);
    expect(report.status).toBe("UNREACHABLE");
    expect(report.engineError).toBeNull();
    expect(report.tools.browser).not.toBeNull();
  }, 120_000);
});

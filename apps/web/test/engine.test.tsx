import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineProblem } from "../src/components/ui/copy-command";
import { BROWSER_REMEDY, checkBrowser, evaluate, type DoctorJson } from "../src/lib/browser-check";
import { inspectionJobState } from "../src/lib/inspection-state";
import { commandFor, JobRecord } from "../src/lib/jobs";

const doctor = (available: ("chromium" | "chrome" | "msedge")[]): DoctorJson => ({
  schemaVersion: "exegezis.doctor/v1",
  auto: (["chromium", "chrome", "msedge"] as const).find((c) => available.includes(c)) ?? null,
  browsers: (["chromium", "chrome", "msedge"] as const).map((channel) => ({
    channel,
    label: channel,
    available: available.includes(channel),
    version: available.includes(channel) ? "130" : null,
    error: available.includes(channel) ? null : "browserType.launch: Executable doesn't exist",
  })),
});

describe("browser preflight before a job is created", () => {
  it("lets the job start when auto finds a browser, including a system one", () => {
    expect(evaluate(doctor(["msedge"]), "auto")).toMatchObject({ ok: true, label: "msedge" });
  });

  it("refuses with the fix when no browser can start, blaming this machine, not the site", () => {
    const result = evaluate(doctor([]), "auto");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/El problema está en este equipo, no en el sitio/);
    expect(result.remedy).toEqual(BROWSER_REMEDY);
  });

  it("asks the real CLI (exegezis doctor --json) on this machine", async () => {
    const result = await checkBrowser("auto");
    // The test machine has at least Playwright's Chromium (the other tests need it).
    expect(result).toMatchObject({ ok: true });
  }, 180_000);

  it("checks the explicit channel the user chose", () => {
    expect(evaluate(doctor(["chromium"]), "chrome").ok).toBe(false);
    expect(evaluate(doctor(["chrome"]), "chrome").ok).toBe(true);
  });
});

describe("ENGINE_ERROR in jobs and pages", () => {
  it("names the job state ENGINE_ERROR from the report or from exit code 7", () => {
    expect(inspectionJobState("finished", 7, "ENGINE_ERROR")).toEqual({ label: "ENGINE_ERROR", tone: "bad" });
    expect(inspectionJobState("finished", 7, null)).toEqual({ label: "ENGINE_ERROR", tone: "bad" });
    expect(inspectionJobState("finished", 4, "UNREACHABLE").label).toBe("UNREACHABLE");
  });

  it("passes --browser-channel to the CLI, and old inspect jobs load with auto", () => {
    const base = { schemaVersion: "exegezis.web-job/v1", id: "01M3JOB0000000000000000000", status: "finished", pid: 1, startedAt: "2026-09-26T10:00:00.000Z", finishedAt: null, exitCode: 0, error: null, serverPid: null, kind: "inspect", url: "https://example.com/", runs: 3, maxPages: null, maxDepth: null, checks: null, storageState: null, strictReadonly: false, ignoreRobots: false };
    const old = JobRecord.parse(base);
    expect(old).toMatchObject({ browserChannel: "auto" });
    expect(commandFor(old)).not.toContain("--browser-channel");
    const edge = JobRecord.parse({ ...base, browserChannel: "msedge" });
    const args = commandFor(edge);
    expect(args.slice(args.indexOf("--browser-channel"), args.indexOf("--browser-channel") + 2)).toEqual(["--browser-channel", "msedge"]);
  });

  it("the notice says where the problem is and makes each command copyable", () => {
    const html = renderToStaticMarkup(<EngineProblem message="No browser could be started." remedy={["Install Playwright's Chromium: pnpm exegezis doctor --install", "pnpm exegezis doctor"]} detail={["Chromium (Playwright): Executable doesn't exist"]} />);
    expect(html).toContain("El problema está en este equipo, no en el sitio.");
    expect(html).toContain("pnpm exegezis doctor --install</code>");
    expect(html).toContain("pnpm exegezis doctor</code>");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('role="alert"');
  });
});

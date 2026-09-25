import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { readManifest, RunMetadata, ULID_PATTERN, type LogRecord } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildObservePlan } from "../src/observe.js";
import { main } from "../src/main.js";

const PAGE = `<!doctype html><html><head><title>CLI Fixture</title></head>
<body><h1>Hello</h1><button>Go</button><script>console.log("cli fixture ready")</script></body></html>`;

let server: Server;
let baseUrl: string;
let workDir: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  workDir = await mkdtemp(join(tmpdir(), "exegezis-cli-"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  const stderr = new PassThrough();
  let stderrText = "";
  stderr.on("data", (chunk: Buffer) => (stderrText += chunk.toString("utf8")));
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr, cwd: workDir });
  return { code, stdout, stderr: stderrText };
}

function runDirs(output: string): string[] {
  const dir = join(workDir, output);
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("exegezis observe", () => {
  it("creates a complete run and reports it", async () => {
    const { code, stdout } = await cli(["observe", "--url", baseUrl, "--output", "runs-ok"]);
    expect(code).toBe(0);

    const [runId] = runDirs("runs-ok");
    expect(runId).toMatch(ULID_PATTERN);
    expect(stdout).toContain("EXEGEZIS");
    expect(stdout).toContain(baseUrl);
    expect(stdout).toContain(runId);
    for (const label of ["Browser", "Console", "Network", "Accessibility", "Screenshot", "Trace"]) {
      expect(stdout).toMatch(new RegExp(`✓ ${label}`));
    }
    expect(stdout).toContain("Run completed.");
    expect(stdout).toContain(`./runs-ok/${runId}/`);

    const dir = join(workDir, "runs-ok", runId ?? "");
    const manifest = readManifest(dir);
    expect(manifest.complete).toBe(true);
    expect(manifest.runId).toBe(runId);
    for (const path of ["metadata.json", "timeline.json", "assertions.json", "console.json", "network.json", "accessibility.json", "trace.zip", "exegezis.log.jsonl"]) {
      expect(manifest.artifacts.some((a) => a.path === path), path).toBe(true);
    }
    expect(manifest.artifacts.some((a) => a.type === "screenshot")).toBe(true);
    expect(RunMetadata.parse(JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"))).command).toBe("observe");
  });

  it("writes structured logs bound to the run", async () => {
    await cli(["observe", "--url", baseUrl, "--output", "runs-log"]);
    const [runId] = runDirs("runs-log");
    const lines = readFileSync(join(workDir, "runs-log", runId ?? "", "exegezis.log.jsonl"), "utf8").trim().split("\n");
    const records = lines.map((line) => JSON.parse(line) as LogRecord);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.runId).toBe(runId);
      expect(record.component).toMatch(/^(runner|adapter-browser)$/);
      expect(Date.parse(record.timestamp)).not.toBeNaN();
    }
    expect(records.some((r) => r.message === "run started" && r.eventId === "evt-000001")).toBe(true);
  });

  it("exits 4 (inconclusive) and keeps the evidence when an action fails", async () => {
    const plan = join(workDir, "failing-plan.json");
    await writeFile(
      plan,
      JSON.stringify({
        schemaVersion: "exegezis.plan/v1",
        steps: [{ type: "click", target: { role: "button", name: "Missing" }, timeoutMs: 500 }],
      }),
    );
    const { code, stdout } = await cli(["observe", "--url", baseUrl, "--output", "runs-fail", "--actions", plan]);
    expect(code).toBe(4);
    expect(stdout).toContain("Run failed during action");
    expect(stdout).toContain("Evidence captured up to the failure was kept.");

    const [runId] = runDirs("runs-fail");
    const dir = join(workDir, "runs-fail", runId ?? "");
    const manifest = readManifest(dir);
    expect(manifest.complete).toBe(true);
    for (const type of ["trace", "console", "network", "accessibility", "screenshot"]) {
      expect(manifest.artifacts.some((a) => a.type === type), type).toBe(true);
    }
    const metadata = RunMetadata.parse(JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")));
    expect(metadata.status).toBe("failed");
    expect(metadata.error?.phase).toBe("action");
  });

  it("exits 2 on invalid input without creating a run", async () => {
    const plan = join(workDir, "invalid-plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "exegezis.plan/v1", steps: [{ type: "eval", code: "1" }] }));
    const invalid = await cli(["observe", "--url", baseUrl, "--output", "runs-invalid", "--actions", plan]);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("Invalid actions file");
    expect(runDirs("runs-invalid")).toEqual([]);

    const missing = await cli(["observe", "--output", "runs-invalid"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("Missing required option --url");
  });

  it("prints help and version", async () => {
    expect((await cli(["--help"])).stdout).toMatch(/exegezis observe +--url <url>/);
    expect((await cli(["--version"])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("buildObservePlan", () => {
  it("navigates then observes when no actions are given", async () => {
    const plan = await buildObservePlan("http://x/", undefined, { cwd: workDir });
    expect(plan.steps).toEqual([{ type: "navigate", url: "http://x/" }, { type: "observe", label: "page" }]);
    expect(plan.target.baseUrl).toBe("http://x/");
  });

  it("wraps user actions between navigation and a final observation", async () => {
    const file = join(workDir, "plan.json");
    await writeFile(file, JSON.stringify({ schemaVersion: "exegezis.plan/v1", steps: [{ type: "press", key: "Tab" }] }));
    const plan = await buildObservePlan("http://x/", "plan.json", { cwd: workDir });
    expect(plan.steps.map((s) => s.type)).toEqual(["navigate", "press", "observe"]);
  });
});

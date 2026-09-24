import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccessibilityFile,
  AdapterDescriptor,
  ConsoleFile,
  executeRun,
  NetworkFile,
  ObservationsFile,
  readManifest,
  REDACTED,
  RunMetadata,
  RunRecorder,
  silentLogger,
  Timeline,
  type AccessibilityNode,
  type Plan,
  type RunOutcome,
} from "@exegezis/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_ADAPTER_DESCRIPTOR, BrowserAdapter } from "../src/index.js";
import { FIXTURE_SECRETS, startFixtureServer, type FixtureServer } from "./fixtures/server.js";
import { findInRun, readJson } from "./helpers.js";

let server: FixtureServer;
let outputDir: string;

beforeAll(async () => {
  server = await startFixtureServer();
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-browser-"));
});

afterAll(async () => {
  await server.close();
  await rm(outputDir, { recursive: true, force: true });
});

async function run(steps: Plan["steps"], options: ConstructorParameters<typeof BrowserAdapter>[0] = {}): Promise<RunOutcome> {
  const recorder = await RunRecorder.create({ outputDir });
  return executeRun({
    adapter: new BrowserAdapter({ settleTimeoutMs: 2_000, ...options }),
    plan: { schemaVersion: "exegezis.plan/v1", steps },
    target: { kind: "web", url: server.url },
    recorder,
    logger: silentLogger,
    command: "observe",
    exegezisVersion: "test",
  });
}

function flatten(nodes: readonly AccessibilityNode[]): AccessibilityNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe("BrowserAdapter descriptor", () => {
  it("answers 'what can this adapter do?' with a structured, valid descriptor", () => {
    const descriptor = AdapterDescriptor.parse(new BrowserAdapter().descriptor);
    expect(descriptor).toEqual(BROWSER_ADAPTER_DESCRIPTOR);
    expect(descriptor.capabilities).toEqual(
      expect.arrayContaining(["browser", "dom", "accessibility", "network", "console", "screenshots", "trace"]),
    );
    expect(descriptor.actions).toEqual(["navigate", "click", "fill", "press", "wait", "screenshot"]);
  });

  it("validates its configuration and pins locale and timezone by default", () => {
    const adapter = new BrowserAdapter();
    expect(adapter.config).toMatchObject({ headless: true, locale: "en-US", timezoneId: "UTC", viewport: { width: 1280, height: 720 } });
    expect(() => new BrowserAdapter({ viewport: { width: -1, height: 10 } })).toThrow();
  });
});

describe("observe a page", () => {
  let outcome: RunOutcome;

  beforeAll(async () => {
    outcome = await run([{ type: "navigate", url: `${server.url}/` }, { type: "observe", label: "initial" }]);
  });

  it("completes and records browser and runtime identity", () => {
    expect(outcome.status).toBe("completed");
    const metadata = RunMetadata.parse(readJson(join(outcome.dir, "metadata.json")));
    expect(metadata.environment?.browser).toMatchObject({ name: "chromium", headless: true, viewport: { width: 1280, height: 720 } });
    expect(metadata.environment?.browser?.version).toMatch(/^\d+\./);
    expect(metadata.environment?.browser?.userAgent).toContain("Chrome");
    expect(metadata.environment?.automation).toEqual({ name: "playwright", version: "1.63.0" });
    expect(metadata.environment?.runtime.version).toBe(process.version);
    expect(Object.values(metadata.collectors).every((c) => c.status === "ok")).toBe(true);
  });

  it("produces every expected artifact, all listed in a complete manifest", () => {
    for (const file of [
      "metadata.json",
      "timeline.json",
      "manifest.json",
      "plan.json",
      "console.json",
      "network.json",
      "accessibility.json",
      "observations.json",
      "trace.zip",
      "execution-errors.json",
    ]) {
      expect(existsSync(join(outcome.dir, file)), file).toBe(true);
    }
    const manifest = readManifest(outcome.dir);
    expect(manifest.complete).toBe(true);
    expect(manifest.missing).toEqual([]);
    expect(new Set(manifest.artifacts.map((a) => a.type))).toEqual(
      new Set(["metadata", "plan", "timeline", "console", "network", "accessibility", "observations", "dom_snapshot", "screenshot", "trace", "execution_errors"]),
    );
  });

  it("captures console messages of every level with location", () => {
    const console = ConsoleFile.parse(readJson(join(outcome.dir, "console.json")));
    const byText = new Map(console.messages.map((m) => [m.text, m]));
    expect(byText.get("fixture: log")?.level).toBe("log");
    expect(byText.get("fixture: info")?.level).toBe("info");
    expect(byText.get("fixture: warning")?.level).toBe("warning");
    expect(byText.get("fixture: error")?.level).toBe("error");
    expect(byText.get("fixture: debug")?.level).toBe("debug");
    expect(byText.get("fixture: loaded 3 items")).toBeDefined();
    expect(byText.get("fixture: error")?.location?.url).toBe(`${server.url}/`);
  });

  it("captures network exchanges with redacted credentials and bodies", () => {
    const network = NetworkFile.parse(readJson(join(outcome.dir, "network.json")));
    const document = network.exchanges.find((e) => e.request.isNavigation);
    expect(document).toMatchObject({ request: { method: "GET", resourceType: "document" }, response: { status: 200 } });

    const api = network.exchanges.find((e) => e.request.url.includes("/api/data"));
    expect(api?.request.resourceType).toBe("fetch");
    expect(api?.request.url).toContain("page=1");
    expect(api?.request.url).not.toContain(FIXTURE_SECRETS.queryToken);
    expect(api?.request.headers["authorization"]).toBe(REDACTED);
    expect(api?.request.headers["x-api-key"]).toBe(REDACTED);
    expect(api?.response?.status).toBe(200);
    expect(api?.response?.headers["set-cookie"]).toBe(REDACTED);
    expect(api?.response?.headers["content-type"]).toBe("application/json");
    const body = api?.response?.body;
    expect(body?.captured).toBe(true);
    if (body?.captured === true) expect(JSON.parse(body.text)).toEqual({ items: [1, 2, 3], token: REDACTED });
    expect(api?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures a structured accessibility tree", () => {
    const accessibility = AccessibilityFile.parse(readJson(join(outcome.dir, "accessibility.json")));
    expect(accessibility.snapshots).toHaveLength(1);
    const nodes = flatten(accessibility.snapshots[0]?.tree ?? []);
    const has = (role: string, name: string): boolean => nodes.some((n) => n.role === role && n.name === name);
    expect(has("button", "Checkout")).toBe(true);
    expect(has("textbox", "Email")).toBe(true);
    expect(has("link", "Products")).toBe(true);
    expect(has("heading", "Shopping Cart")).toBe(true);
    expect(accessibility.snapshots[0]?.nodeCount).toBe(nodes.length);
  });

  it("links the observation to its screenshot and DOM snapshot", () => {
    const observations = ObservationsFile.parse(readJson(join(outcome.dir, "observations.json")));
    const [observation] = observations.observations;
    expect(observation).toMatchObject({ label: "initial", title: "Fixture Home", url: `${server.url}/`, settled: true, gaps: [] });
    const screenshot = observations.screenshots.find((s) => s.id === observation?.evidence.screenshot);
    expect(screenshot).toBeDefined();
    const png = readFileSync(join(outcome.dir, screenshot?.path ?? "missing"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    const dom = observations.domSnapshots.find((d) => d.id === observation?.evidence.dom);
    expect(readFileSync(join(outcome.dir, dom?.path ?? "missing"), "utf8")).toContain("<h1>Shopping Cart</h1>");
  });

  it("writes an ordered, structured timeline", () => {
    const { events } = Timeline.parse(readJson(join(outcome.dir, "timeline.json")));
    expect(events[0]?.type).toBe("RUN_STARTED");
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const types = new Set(events.map((e) => e.type));
    for (const type of ["ADAPTER_STARTED", "ACTION_STARTED", "PAGE_LOADED", "CONSOLE_MESSAGE", "NETWORK_REQUEST", "NETWORK_RESPONSE", "ACCESSIBILITY_SNAPSHOT", "SCREENSHOT", "OBSERVATION", "TRACE_SAVED"]) {
      expect(types.has(type as never), type).toBe(true);
    }
    // For every exchange, the request precedes its response.
    const requestSeq = new Map<string, number>();
    for (const event of events) {
      if (event.type === "NETWORK_REQUEST") requestSeq.set(event.payload.evidenceId, event.seq);
      if (event.type === "NETWORK_RESPONSE") expect(requestSeq.get(event.payload.evidenceId)).toBeLessThan(event.seq);
    }
  });

  it("produces a valid Playwright trace archive", () => {
    const entries = Object.keys(unzipSync(readFileSync(join(outcome.dir, "trace.zip"))));
    expect(entries.some((e) => e.endsWith(".trace"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".network"))).toBe(true);
    const manifestEntry = readManifest(outcome.dir).artifacts.find((a) => a.type === "trace");
    expect(manifestEntry?.redaction).toBe("verified");
  });

  it("leaks no secret into any artifact, including the trace", () => {
    const secrets = [FIXTURE_SECRETS.bearer, FIXTURE_SECRETS.apiKey, FIXTURE_SECRETS.cookie, FIXTURE_SECRETS.responseToken, FIXTURE_SECRETS.queryToken];
    expect(findInRun(outcome.dir, secrets)).toEqual([]);
  });
});

describe("actions", () => {
  it("executes fill, click, press and wait, and never persists a password", async () => {
    const outcome = await run([
      { type: "navigate", url: `${server.url}/` },
      { type: "fill", target: { label: "Email" }, value: "ana@example.com" },
      // No `sensitive` flag: password inputs are detected and redacted anyway.
      { type: "fill", target: { label: "Password" }, value: FIXTURE_SECRETS.password },
      { type: "click", target: { role: "button", name: "Sign in" } },
      { type: "wait", condition: { kind: "element", target: { text: "Signed in as ana@example.com" }, state: "visible" } },
      { type: "press", key: "Tab" },
      { type: "screenshot", name: "signed-in" },
      { type: "observe" },
    ]);
    expect(outcome.status).toBe("completed");
    const accessibility = AccessibilityFile.parse(readJson(join(outcome.dir, "accessibility.json")));
    const nodes = flatten(accessibility.snapshots.at(-1)?.tree ?? []);
    expect(nodes.some((n) => n.role === "status" && JSON.stringify(n).includes("Signed in as ana@example.com"))).toBe(true);

    const observations = ObservationsFile.parse(readJson(join(outcome.dir, "observations.json")));
    expect(observations.screenshots.map((s) => s.reason)).toEqual(["action", "observation"]);
    expect(observations.screenshots[0]?.path).toMatch(/^screenshots\/shot-0001-signed-in\.png$/);

    expect(findInRun(outcome.dir, [FIXTURE_SECRETS.password])).toEqual([]);
  });

  it("captures uncaught page errors separately from execution errors", async () => {
    const outcome = await run([
      { type: "navigate", url: `${server.url}/error` },
      { type: "wait", condition: { kind: "timeout", ms: 200 } },
      { type: "observe" },
    ]);
    expect(outcome.status).toBe("completed");
    const console = ConsoleFile.parse(readJson(join(outcome.dir, "console.json")));
    expect(console.pageErrors).toMatchObject([{ name: "TypeError", message: "fixture uncaught error" }]);
    expect(readJson(join(outcome.dir, "execution-errors.json"))).toEqual([]);
  });
});

describe("failures preserve evidence", () => {
  it("keeps everything captured before a failed action, plus a failure observation", async () => {
    const outcome = await run([
      { type: "navigate", url: `${server.url}/` },
      { type: "observe", label: "before" },
      { type: "click", target: { role: "button", name: "Does not exist" }, timeoutMs: 500 },
      { type: "observe", label: "never" },
    ]);
    expect(outcome.status).toBe("failed");
    expect(outcome.metadata.error).toMatchObject({ phase: "action" });

    const observations = ObservationsFile.parse(readJson(join(outcome.dir, "observations.json")));
    expect(observations.observations.map((o) => [o.label, o.reason])).toEqual([
      ["before", "plan"],
      ["after-act-0002", "failure"],
    ]);
    expect(observations.screenshots.map((s) => s.reason)).toEqual(["observation", "failure"]);

    const manifest = readManifest(outcome.dir);
    expect(manifest.complete).toBe(true);
    expect(manifest.missing).toEqual([]);
    for (const type of ["trace", "console", "network", "accessibility", "timeline", "metadata"]) {
      expect(manifest.artifacts.some((a) => a.type === type), type).toBe(true);
    }
    const events = Timeline.parse(readJson(join(outcome.dir, "timeline.json"))).events;
    expect(events.find((e) => e.type === "ACTION_FAILED")).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: "RUN_FINISHED", payload: { status: "failed" } });
  });

  it("records a failed navigation as evidence instead of losing the run", async () => {
    const closed = await startFixtureServer();
    const deadUrl = closed.url;
    await closed.close();

    const outcome = await run([{ type: "navigate", url: `${deadUrl}/`, timeoutMs: 5_000 }, { type: "observe" }]);
    expect(outcome.status).toBe("failed");
    expect(outcome.metadata.error?.message).toMatch(/ERR_CONNECTION_REFUSED/);
    const network = NetworkFile.parse(readJson(join(outcome.dir, "network.json")));
    expect(network.exchanges[0]?.failure?.errorText).toMatch(/ERR_CONNECTION_REFUSED/);
    expect(existsSync(join(outcome.dir, "trace.zip"))).toBe(true);
    expect(RunMetadata.parse(readJson(join(outcome.dir, "metadata.json"))).status).toBe("failed");
  });
});

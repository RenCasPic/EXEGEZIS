import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Assertion,
  AssertionsFile,
  executeRun,
  RunRecorder,
  silentLogger,
  type AdapterSession,
  type AssertionEvaluation,
  type AssertionInput,
  type TestPlan,
  UNKNOWN_PROVENANCE,
} from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserAdapter } from "../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

let server: FixtureServer;
let outputDir: string;
let session: AdapterSession;

beforeAll(async () => {
  server = await startFixtureServer();
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-assert-"));
  const recorder = await RunRecorder.create({ outputDir });
  session = await new BrowserAdapter().start({ recorder, logger: silentLogger });
  await session.execute({ type: "navigate", url: `${server.url}/assertions` }, "act-0001");
});

afterAll(async () => {
  await session.close();
  await server.close();
  await rm(outputDir, { recursive: true, force: true });
});

function check(assertion: AssertionInput, timeoutMs = 300, stabilityMs = 100): Promise<AssertionEvaluation> {
  return session.assert(Assertion.parse(assertion), { timeoutMs, stabilityMs, baseUrl: `${server.url}/` });
}

describe("text", () => {
  it("retries until the expectation holds (like Playwright's expect)", async () => {
    const result = await check({ kind: "text", target: { role: "status" }, expected: "Ready" }, 3_000);
    expect(result).toMatchObject({ status: "passed", actual: "Ready", matches: 1 });
    expect(result.attempts).toBeGreaterThan(1);
  });

  it("fails when the observed value is stable and contradicts the expectation", async () => {
    const result = await check({ kind: "text", target: { role: "status" }, expected: "Done" });
    expect(result).toMatchObject({ status: "failed", expected: "Done", actual: "Ready" });
    expect(result.message).toBe('text of status was "Ready"; expected it to equal "Done"');
  });

  it("times out, instead of failing, when the value is still changing at the deadline", async () => {
    const result = await check({ kind: "text", target: { role: "timer" }, expected: "never" }, 500, 200);
    expect(result).toMatchObject({ status: "timeout", timeoutReason: "value_unsettled" });
    expect(result.message).toMatch(/value still changing/);
  });

  it("supports contains and matches", async () => {
    expect((await check({ kind: "text", target: { role: "heading" }, operator: "contains", expected: "sert" })).status).toBe("passed");
    expect((await check({ kind: "text", target: { role: "heading" }, operator: "matches", expected: "^Assert\\w+$" })).status).toBe("passed");
  });

  it("times out when the target never appears, and is an error when it is ambiguous", async () => {
    expect(await check({ kind: "text", target: { role: "button", name: "Nope" }, expected: "x" })).toMatchObject({
      status: "timeout",
      timeoutReason: "subject_absent",
      matches: 0,
    });
    expect(await check({ kind: "text", target: { role: "button", name: "Duplicate" }, expected: "x" })).toMatchObject({
      status: "error",
      errorKind: "target_ambiguous",
      matches: 2,
    });
  });
});

describe("visibility and existence", () => {
  it("evaluates visible and hidden elements", async () => {
    expect((await check({ kind: "visibility", target: { role: "heading", name: "Assertions" }, expected: "visible" })).status).toBe("passed");
    expect((await check({ kind: "visibility", target: { text: "Hidden note" }, expected: "hidden" })).status).toBe("passed");
    expect(await check({ kind: "visibility", target: { text: "Hidden note" }, expected: "visible" })).toMatchObject({
      status: "failed",
      actual: "hidden",
    });
  });

  it("never treats absence as evidence: something that never appears is a timeout", async () => {
    expect((await check({ kind: "visibility", target: { text: "Never rendered" }, expected: "hidden" })).status).toBe("passed");
    expect(await check({ kind: "visibility", target: { text: "Never rendered" }, expected: "visible" })).toMatchObject({
      status: "timeout",
      timeoutReason: "subject_absent",
    });
    expect(await check({ kind: "existence", target: { text: "Never rendered" }, expected: "present" })).toMatchObject({
      status: "timeout",
    });
    expect(await check({ kind: "count", target: { role: "row" }, expected: 2 })).toMatchObject({ status: "timeout" });
    expect((await check({ kind: "existence", target: { text: "Hidden note" }, expected: "present" })).status).toBe("passed");
    expect(await check({ kind: "existence", target: { role: "listitem" }, expected: "absent" })).toMatchObject({
      status: "failed",
      actual: "present",
      matches: 3,
    });
  });
});

describe("count", () => {
  it("counts matching elements", async () => {
    expect(await check({ kind: "count", target: { role: "listitem" }, expected: 3 })).toMatchObject({ status: "passed", actual: 3 });
    expect(await check({ kind: "count", target: { role: "listitem" }, expected: 1 })).toMatchObject({ status: "failed", actual: 3 });
  });
});

describe("attribute", () => {
  it("compares attribute values", async () => {
    expect((await check({ kind: "attribute", target: { role: "link", name: "Next page" }, name: "data-kind", expected: "primary" })).status).toBe("passed");
    expect(
      (await check({ kind: "attribute", target: { label: "Email" }, name: "placeholder", operator: "contains", expected: "@example" })).status,
    ).toBe("passed");
    expect(await check({ kind: "attribute", target: { role: "link", name: "Next page" }, name: "target", expected: "_blank" })).toMatchObject({
      status: "failed",
      actual: null,
    });
  });
});

describe("url", () => {
  it("resolves relative expectations against the base URL", async () => {
    expect(await check({ kind: "url", expected: "/assertions" })).toMatchObject({ status: "passed", actual: `${server.url}/assertions` });
    expect((await check({ kind: "url", operator: "contains", expected: "/assert" })).status).toBe("passed");
    expect((await check({ kind: "url", expected: "/cart" })).status).toBe("failed");
  });
});

describe("http", () => {
  const request = { method: "POST", path: "/api/total" } as const;

  it("checks the status and a JSON body value of the latest matching response", async () => {
    expect((await check({ kind: "http", request, expected: { status: 200 } }, 3_000)).status).toBe("passed");
    expect((await check({ kind: "http", request, expected: { body: { pointer: "/items/0/id", equals: "a" } } })).status).toBe("passed");
    expect(await check({ kind: "http", request, expected: { status: 200, body: { pointer: "/totalCents", equals: 999 } } })).toMatchObject({
      status: "failed",
      actual: { status: 200, body: { pointer: "/totalCents", value: 1234 } },
      message: "response to POST /api/total: body/totalCents was 1234, expected 999",
    });
  });

  it("times out when no response matched, and is an error when the value is redacted", async () => {
    expect(await check({ kind: "http", request: { path: "/api/none" }, expected: { status: 200 } })).toMatchObject({
      status: "timeout",
      timeoutReason: "subject_absent",
    });
    expect(await check({ kind: "http", request, expected: { body: { pointer: "/token", equals: "x" } } })).toMatchObject({
      status: "error",
      errorKind: "value_redacted",
    });
  });
});

describe("unsupported kinds", () => {
  it("reports an assertion kind the adapter does not implement as unsupported, never as a result", async () => {
    expect(await check({ kind: "visual", baseline: "home" })).toMatchObject({ status: "error", errorKind: "unsupported" });
  });
});

describe("plans against a real browser", () => {
  async function runPlan(steps: TestPlan["steps"]) {
    const recorder = await RunRecorder.create({ outputDir });
    return executeRun({
      adapter: new BrowserAdapter({ settleTimeoutMs: 500 }),
      plan: {
        schemaVersion: "exegezis.test-plan/v1",
        id: "browser-plan",
        title: "browser plan",
        target: { kind: "web", baseUrl: `${server.url}/` },
        preconditions: [],
        provenance: UNKNOWN_PROVENANCE,
        steps,
        metadata: {},
      },
      recorder,
      logger: silentLogger,
      command: "run",
      exegezisVersion: "test",
    });
  }

  it("links a failed assertion to the screenshot, accessibility snapshot and network it produced", async () => {
    const outcome = await runPlan([
      { type: "navigate", url: "/assertions" },
      { type: "assert", purpose: "anchor", assertion: Assertion.parse({ kind: "text", target: { role: "status" }, expected: "Ready" }), timeoutMs: 3_000 },
      { type: "assert", purpose: "expectation", id: "items", assertion: Assertion.parse({ kind: "count", target: { role: "listitem" }, expected: 4 }), timeoutMs: 300 },
    ]);
    expect(outcome.verdict).toBe("failed");
    const failed = AssertionsFile.parse(JSON.parse(readFileSync(join(outcome.dir, "assertions.json"), "utf8"))).results.at(-1);
    expect(failed).toMatchObject({ stepIndex: 3, status: "failed", expected: 4, actual: 3 });
    const png = readFileSync(join(outcome.dir, failed?.evidence?.screenshot?.path ?? "missing"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(failed?.evidence?.accessibilitySnapshotId).toMatch(/^ax-/);
    expect(failed?.evidence?.network.length).toBeGreaterThan(0);
  });

  it("an element that never appears makes the run a timeout, not a failure", async () => {
    const outcome = await runPlan([
      { type: "navigate", url: "/assertions" },
      { type: "assert", purpose: "expectation", assertion: Assertion.parse({ kind: "visibility", target: { role: "dialog" }, expected: "visible" }), timeoutMs: 400 },
    ]);
    expect(outcome.verdict).toBe("timeout");
    expect(outcome.status).toBe("completed");
    expect(outcome.assertions[0]).toMatchObject({ status: "timeout", timeoutReason: "subject_absent" });
    // Evidence of what the page looked like is still linked.
    expect(outcome.assertions[0]?.evidence?.screenshot).toBeDefined();
  });

  it("reports a timed-out action as an error with partial evidence", async () => {
    const outcome = await runPlan([
      { type: "navigate", url: "/assertions" },
      { type: "click", target: { role: "button", name: "Missing" }, timeoutMs: 300 },
      { type: "assert", purpose: "expectation", assertion: Assertion.parse({ kind: "count", target: { role: "listitem" }, expected: 3 }) },
    ]);
    expect(outcome.verdict).toBe("error");
    expect(outcome.metadata.error?.name).toBe("TimeoutError");
    expect(outcome.metadata.assertions).toMatchObject({ notRun: 1 });
    expect(outcome.manifest.artifacts.some((a) => a.type === "trace")).toBe(true);
  });
});

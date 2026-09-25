import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AssertionsFile,
  executeRun,
  failureSignature,
  Logger,
  MemorySink,
  readManifest,
  RunMetadata,
  RunRecorder,
  silentLogger,
  Timeline,
  DEFAULT_TIMEOUT_POLICY,
  effectiveStabilityMs,
  resolveTimeouts,
  type TestPlan,
} from "../src/index.js";
import { badge, errors, fakeAdapter, fails, testPlan, timesOut, type FakeAdapter } from "./fake-adapter.js";

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-exec-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function run(adapter: FakeAdapter, plan: TestPlan, baseUrl?: string) {
  const recorder = await RunRecorder.create({ outputDir });
  return executeRun({
    adapter,
    plan,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    recorder,
    logger: silentLogger,
    command: "run",
    exegezisVersion: "test",
  });
}

const types = (dir: string): string[] => Timeline.parse(readJson(join(dir, "timeline.json"))).events.map((e) => e.type);

describe("executeRun — plans with assertions", () => {
  it("passes a plan whose assertions all hold", async () => {
    const outcome = await run(fakeAdapter(), testPlan([{ type: "navigate", url: "/" }, badge("Cart (0)")]));
    expect(outcome.status).toBe("completed");
    expect(outcome.verdict).toBe("passed");
    expect(types(outcome.dir)).toEqual([
      "RUN_STARTED",
      "PLAN_STARTED",
      "ACTION_STARTED",
      "ACTION_SUCCEEDED",
      "ASSERTION_STARTED",
      "ASSERTION_PASSED",
      "PLAN_FINISHED",
      "RUN_FINISHED",
    ]);
    const metadata = RunMetadata.parse(readJson(join(outcome.dir, "metadata.json")));
    expect(metadata.verdict).toBe("passed");
    expect(metadata.plan).toEqual({ id: "PLAN-1", title: "Test plan", steps: 2, provenance: expect.objectContaining({ source: "unknown" }) });
    expect(metadata.assertions).toEqual({ total: 1, passed: 1, failed: 0, timedOut: 0, errored: 0, notRun: 0 });
    expect(AssertionsFile.parse(readJson(join(outcome.dir, "assertions.json"))).results).toHaveLength(1);
  });

  it("stops at a failed assertion, reports expected vs actual and links the evidence", async () => {
    const adapter = fakeAdapter({ evaluate: () => fails("Cart (0)", "Cart (1)") });
    const outcome = await run(
      adapter,
      testPlan([{ type: "navigate", url: "/" }, { type: "click", target: { role: "button", name: "Remove" } }, badge("Cart (0)"), { type: "navigate", url: "/never" }]),
    );

    // The run itself worked; the application did not meet the expectation.
    expect(outcome.status).toBe("completed");
    expect(outcome.verdict).toBe("failed");
    expect(outcome.stoppedAtStep).toBe(3);
    expect(adapter.executed.map((a) => a.type)).toEqual(["navigate", "click"]);

    const [result] = AssertionsFile.parse(readJson(join(outcome.dir, "assertions.json"))).results;
    expect(result).toMatchObject({
      id: "asr-0001",
      stepIndex: 3,
      stepId: "badge",
      kind: "text",
      status: "failed",
      description: "badge shows Cart (0)",
      expected: "Cart (0)",
      actual: "Cart (1)",
    });
    const events = Timeline.parse(readJson(join(outcome.dir, "timeline.json"))).events;
    const click = events.find((e) => e.type === "ACTION_STARTED" && e.payload.step.type === "click");
    const failed = events.find((e) => e.type === "ASSERTION_FAILED");
    expect(result?.evidence).toMatchObject({
      actionEventId: click?.id,
      assertionEventId: failed?.id,
      screenshot: { id: "shot-0001", path: "screenshots/shot-0001.png" },
      accessibilitySnapshotId: "ax-0001",
      window: { fromEventId: click?.id },
    });
    // The linked screenshot exists on disk.
    expect(existsSync(join(outcome.dir, result?.evidence?.screenshot?.path ?? "missing"))).toBe(true);
    expect(RunMetadata.parse(readJson(join(outcome.dir, "metadata.json"))).assertions).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      timedOut: 0,
      errored: 0,
      notRun: 0,
    });
    expect(readManifest(outcome.dir).complete).toBe(true);
  });

  it("treats an action failure (e.g. timeout) as an error, never as a failed expectation", async () => {
    const outcome = await run(
      fakeAdapter({ failOn: "click" }),
      testPlan([{ type: "navigate", url: "/" }, { type: "click", target: { text: "Go" } }, badge("Cart (0)")]),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.verdict).toBe("error");
    expect(outcome.stoppedAtStep).toBe(2);
    expect(outcome.assertions).toEqual([]);
    expect(outcome.metadata.assertions).toMatchObject({ total: 1, notRun: 1, failed: 0 });
    expect(outcome.metadata.error).toMatchObject({ phase: "action", message: "click timed out" });
    // Evidence captured until the error is kept, plus a failure observation.
    expect(types(outcome.dir)).toContain("OBSERVATION");
    expect(readManifest(outcome.dir).artifacts.some((a) => a.type === "trace")).toBe(true);
  });

  it("treats an assertion that cannot be evaluated as an error, not a failure", async () => {
    const outcome = await run(fakeAdapter({ evaluate: () => errors("link \"Cart\" matched 2 elements") }), testPlan([badge("Cart (0)")]));
    expect(outcome.verdict).toBe("error");
    expect(outcome.status).toBe("failed");
    expect(outcome.assertions[0]).toMatchObject({ status: "error", errorKind: "target_ambiguous" });
    expect(types(outcome.dir)).toContain("ASSERTION_ERROR");
    expect(outcome.metadata.error?.phase).toBe("assertion");
  });

  it("rejects assertion kinds the adapter does not declare", async () => {
    const adapter = fakeAdapter();
    const outcome = await run(
      adapter,
      testPlan([{ type: "assert", purpose: "expectation", assertion: { kind: "url", operator: "equals", expected: "/cart" } }]),
    );
    expect(adapter.asserted).toEqual([]);
    expect(outcome.verdict).toBe("error");
    expect(outcome.assertions[0]).toMatchObject({ status: "error", errorKind: "unsupported" });
  });

  it("records an error verdict and missing artifacts when the adapter cannot start", async () => {
    const outcome = await run(fakeAdapter({ failStart: true }), testPlan([badge("Cart (0)")]));
    expect(outcome.verdict).toBe("error");
    expect(outcome.metadata.error?.phase).toBe("start");
    expect(readManifest(outcome.dir).missing.map((m) => m.type).sort()).toEqual(["accessibility", "console", "network", "screenshot", "trace"]);
  });

  it("keeps a failed verdict but marks the run failed when evidence collection breaks", async () => {
    const outcome = await run(fakeAdapter({ evaluate: () => fails("a", "b"), failCollect: true }), testPlan([badge("a")]));
    expect(outcome.verdict).toBe("failed");
    expect(outcome.status).toBe("failed");
    expect(outcome.metadata.error?.phase).toBe("collect");
  });

  it("reports no_assertions for plans that only observe", async () => {
    const outcome = await run(fakeAdapter(), testPlan([{ type: "navigate", url: "/" }, { type: "observe" }]));
    expect(outcome.verdict).toBe("no_assertions");
  });
});

describe("executeRun — environment and reproducibility", () => {
  it("resolves relative navigation against the base URL, overridable per run", async () => {
    const adapter = fakeAdapter();
    const plan = testPlan([{ type: "navigate", url: "/cart?x=1" }]);
    const staging = await run(adapter, plan, "https://staging.example.com/");
    expect(adapter.executed[0]).toEqual({ type: "navigate", url: "https://staging.example.com/cart?x=1", timeoutMs: DEFAULT_TIMEOUT_POLICY.navigationMs });
    expect(staging.metadata.target.url).toBe("https://staging.example.com/");

    const local = await run(fakeAdapter(), plan);
    // Same plan, different environment: same planHash, different configHash.
    expect(local.metadata.planHash).toBe(staging.metadata.planHash);
    expect(local.metadata.configHash).not.toBe(staging.metadata.configHash);
  });

  it("never persists sensitive fill values", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const sink = new MemorySink();
    const outcome = await executeRun({
      adapter: fakeAdapter(),
      plan: testPlan([{ type: "fill", target: { label: "Password" }, value: "correct-horse-battery", sensitive: true }]),
      recorder,
      logger: new Logger([sink]),
      command: "run",
      exegezisVersion: "test",
    });
    for (const entry of outcome.manifest.artifacts) {
      expect(readFileSync(join(outcome.dir, entry.path), "latin1"), entry.path).not.toContain("correct-horse-battery");
    }
    expect(JSON.stringify(sink.records)).not.toContain("correct-horse-battery");
  });
});

describe("failureSignature", () => {
  it("identifies a failure by step, expectation and observed value", () => {
    const a = failureSignature({ stepIndex: 9, stepId: "badge", kind: "text", actual: "Cart (1)" });
    expect(a).toBe('step:9|badge|actual="Cart (1)"');
    expect(failureSignature({ stepIndex: 9, stepId: "badge", kind: "text", actual: "Cart (2)" })).not.toBe(a);
    expect(failureSignature({ stepIndex: 4, kind: "http", actual: { status: 200, body: { value: 1 } } })).toBe(
      'step:4|http|actual={"body":{"value":1},"status":200}',
    );
  });
});

describe("executeRun — timeouts", () => {
  it("an assertion timeout is its own verdict: neither a failure nor an execution error", async () => {
    const outcome = await run(fakeAdapter({ evaluate: () => timesOut() }), testPlan([{ type: "navigate", url: "/" }, badge("Cart (0)")]));
    expect(outcome.verdict).toBe("timeout");
    expect(outcome.status).toBe("completed");
    expect(outcome.metadata.error).toBeUndefined();
    expect(outcome.assertions[0]).toMatchObject({ status: "timeout", timeoutReason: "subject_absent" });
    expect(outcome.metadata.assertions).toMatchObject({ failed: 0, timedOut: 1, errored: 0 });
    expect(types(outcome.dir)).toContain("ASSERTION_TIMEOUT");
    expect(types(outcome.dir)).not.toContain("ASSERTION_FAILED");
  });

  it("applies the central timeout policy to actions and assertions, with plan and step overrides", async () => {
    const adapter = fakeAdapter();
    const plan = testPlan(
      [
        { type: "navigate", url: "/" },
        { type: "click", target: { text: "Go" } },
        { type: "click", target: { text: "Slow" }, timeoutMs: 9_000 },
        badge("Cart (0)"),
        { ...badge("Cart (1)", "expectation", "second"), timeoutMs: 700 } as TestPlan["steps"][number],
      ],
      "PLAN-T",
      { timeouts: { actionMs: 1_234, assertionMs: 3_000 } },
    );
    const outcome = await run(adapter, plan);
    expect(adapter.executed.map((a) => ("timeoutMs" in a ? a.timeoutMs : undefined))).toEqual([
      DEFAULT_TIMEOUT_POLICY.navigationMs,
      1_234,
      9_000,
    ]);
    expect(adapter.assertOptions.map((o) => [o.timeoutMs, o.stabilityMs])).toEqual([
      [3_000, 250],
      [700, 250],
    ]);
    expect(outcome.metadata.timeouts).toEqual(resolveTimeouts({ actionMs: 1_234, assertionMs: 3_000 }));
  });

  it("caps the stability window at half the assertion timeout", () => {
    const policy = resolveTimeouts({ stabilityMs: 1_000 });
    expect(effectiveStabilityMs(policy, 5_000)).toBe(1_000);
    expect(effectiveStabilityMs(policy, 400)).toBe(200);
    expect(() => resolveTimeouts({ assertionMs: 0 })).toThrow();
  });

  it("stops a run that exceeds its time budget as an execution error", async () => {
    const outcome = await run(
      fakeAdapter({ actionDelayMs: 400 }),
      testPlan([{ type: "navigate", url: "/" }, { type: "click", target: { text: "Go" } }, badge("Cart (0)")], "PLAN-RT", {
        timeouts: { runMs: 300 },
      }),
    );
    expect(outcome.verdict).toBe("error");
    expect(outcome.status).toBe("failed");
    expect(outcome.metadata.error).toMatchObject({ phase: "run", name: "RunTimeoutError" });
    expect(outcome.assertions).toEqual([]);
    // The run still finalizes with its evidence.
    expect(readManifest(outcome.dir).complete).toBe(true);
  });
});

describe("executeRun — provenance", () => {
  it("records the plan's provenance in the run metadata", async () => {
    const provenance = {
      source: "model" as const,
      generator: "claude",
      model: "MODEL_NAME",
      version: "VERSION",
      promptVersion: "symptom-to-plan/v0",
      createdAt: null,
    };
    const outcome = await run(fakeAdapter(), testPlan([{ type: "navigate", url: "/" }], "PLAN-P", { provenance }));
    expect(RunMetadata.parse(readJson(join(outcome.dir, "metadata.json"))).plan?.provenance).toEqual(provenance);
  });
});

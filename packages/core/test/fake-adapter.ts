import type {
  Action,
  Adapter,
  AdapterSession,
  Assertion,
  AssertionEvaluation,
  AssertOptions,
  Observation,
  PlanStep,
  TestPlan,
} from "../src/index.js";
import { UNKNOWN_PROVENANCE } from "../src/index.js";

export interface FakeBehavior {
  failStart?: boolean;
  /** Throw when executing this action type (like a Playwright timeout). */
  failOn?: Action["type"];
  /** Decides each assertion's outcome; default: passes with actual = expected. */
  evaluate?: (assertion: Assertion) => AssertionEvaluation;
  /** Fail the evidence collection phase. */
  failCollect?: boolean;
  /** Make every action take this long (to exercise the run timeout). */
  actionDelayMs?: number;
}

export interface FakeAdapter extends Adapter {
  executed: Action[];
  asserted: Assertion[];
  assertOptions: AssertOptions[];
}

export const passes = (actual: unknown = "ok"): AssertionEvaluation => ({
  status: "passed",
  expected: actual as AssertionEvaluation["expected"],
  actual: actual as AssertionEvaluation["actual"],
  message: "ok",
  attempts: 1,
});

export const fails = (expected: string, actual: string): AssertionEvaluation => ({
  status: "failed",
  expected,
  actual,
  message: `was ${actual}, expected ${expected}`,
  attempts: 3,
});

export const errors = (message = "ambiguous target"): AssertionEvaluation => ({
  status: "error",
  errorKind: "target_ambiguous",
  expected: null,
  actual: null,
  message,
  attempts: 3,
});

export const timesOut = (message = "never appeared"): AssertionEvaluation => ({
  status: "timeout",
  timeoutReason: "subject_absent",
  expected: "visible",
  actual: null,
  message,
  attempts: 20,
});

/**
 * In-memory adapter for testing the runner without a browser. It records
 * real evidence artifacts (screenshot, accessibility...) as empty files so
 * verification criteria can be exercised end to end.
 */
export function fakeAdapter(behavior: FakeBehavior = {}): FakeAdapter {
  const executed: Action[] = [];
  const asserted: Assertion[] = [];
  const assertOptions: AssertOptions[] = [];
  return {
    executed,
    asserted,
    assertOptions,
    descriptor: {
      id: "fake",
      version: "0.0.0",
      description: "test adapter",
      capabilities: ["console", "screenshots", "accessibility"],
      actions: ["navigate", "click", "fill"],
      assertions: ["text", "visibility", "count"],
      produces: ["console", "network", "accessibility", "screenshot", "trace"],
    },
    config: { mode: "test" },
    async start(context): Promise<AdapterSession> {
      if (behavior.failStart === true) throw new Error("cannot start");
      const { recorder } = context;
      return {
        environment: { adapter: { id: "fake", version: "0.0.0" } },
        async execute(action: Action) {
          executed.push(action);
          if (behavior.actionDelayMs !== undefined) await new Promise((r) => setTimeout(r, behavior.actionDelayMs));
          if (action.type === behavior.failOn) throw new Error(`${action.type} timed out`);
        },
        async assert(assertion: Assertion, options) {
          asserted.push(assertion);
          assertOptions.push(options);
          return behavior.evaluate?.(assertion) ?? passes("expected" in assertion ? assertion.expected : null);
        },
        async observe(request): Promise<Observation> {
          const shot = recorder.ids.next("shot");
          const path = `screenshots/${shot}.png`;
          await recorder.writeBinary("screenshot", path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
          recorder.emit("SCREENSHOT", "adapter", { evidenceId: shot, path, reason: request.reason });
          const ax = recorder.ids.next("ax");
          recorder.emit("ACCESSIBILITY_SNAPSHOT", "adapter", { evidenceId: ax, nodeCount: 1 });
          const observation: Observation = {
            kind: "browser_page",
            id: recorder.ids.next("obs"),
            timestamp: recorder.timestamp(),
            ...(request.label === undefined ? {} : { label: request.label }),
            reason: request.reason,
            url: "http://fake/",
            title: "Fake",
            viewport: null,
            settled: true,
            evidence: { screenshot: shot, accessibility: ax },
            gaps: [],
          };
          recorder.emit("OBSERVATION", "adapter", { observationId: observation.id, url: observation.url, title: "Fake", settled: true });
          return observation;
        },
        async collectEvidence() {
          if (behavior.failCollect === true) throw new Error("collector crashed");
          await recorder.writeJson("console", "console.json", { messages: [] });
          await recorder.writeJson("network", "network.json", { exchanges: [] });
          await recorder.writeJson("accessibility", "accessibility.json", { snapshots: [] });
          await recorder.writeBinary("trace", "trace.zip", new Uint8Array([0x50, 0x4b]), "application/zip");
          return { console: { status: "ok" as const } };
        },
        async close() {},
      };
    },
  };
}

export function testPlan(steps: PlanStep[], id = "PLAN-1", extra: Partial<TestPlan> = {}): TestPlan {
  return {
    schemaVersion: "exegezis.test-plan/v1",
    id,
    title: "Test plan",
    target: { kind: "web", baseUrl: "http://fake/" },
    preconditions: [],
    provenance: UNKNOWN_PROVENANCE,
    steps,
    metadata: {},
    ...extra,
  };
}

export const badge = (expected: string, purpose: "anchor" | "expectation" = "expectation", id = "badge"): PlanStep => ({
  type: "assert",
  id,
  purpose,
  description: `badge shows ${expected}`,
  assertion: { kind: "text", target: { role: "link", name: "Cart" }, operator: "equals", expected },
});

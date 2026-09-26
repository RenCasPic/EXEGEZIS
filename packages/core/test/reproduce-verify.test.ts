import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBugReport,
  buildReproduction,
  BugReport,
  classifyReproduction,
  evaluateVerification,
  reproducePlan,
  Reproduction,
  silentLogger,
  validatePlan,
  VerificationPolicy,
  type Assertion,
  type CompiledTestExecution,
  type Provenance,
  type ReproductionResult,
  type TestPlan,
} from "../src/index.js";
import { badge, errors, fakeAdapter, fails, passes, testPlan, timesOut, type FakeBehavior } from "./fake-adapter.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "exegezis-repro-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A strongly anchored plan: known state, action, then the expectation (step 4). */
const PLAN = testPlan(
  [
    { type: "navigate", url: "/" },
    badge("Cart (1)", "anchor", "badge-after-add"),
    { type: "click", target: { text: "Remove" } },
    badge("Cart (0)", "expectation", "badge-after-remove"),
  ],
  "BUG-X",
);
const policy = VerificationPolicy.parse({});
const descriptor = fakeAdapter().descriptor;

const isExpectation = (a: Assertion): boolean => "expected" in a && a.expected === "Cart (0)";
/** The bug: the expectation fails, the anchor holds. */
const failing: FakeBehavior = { evaluate: (a) => (isExpectation(a) ? fails("Cart (0)", "Cart (1)") : passes("Cart (1)")) };
const passing: FakeBehavior = { evaluate: (a) => passes(isExpectation(a) ? "Cart (0)" : "Cart (1)") };
const timingOut: FakeBehavior = { evaluate: (a) => (isExpectation(a) ? timesOut() : passes("Cart (1)")) };

/** Reproduces a plan with one behavior per attempt. */
async function reproduce(behaviors: FakeBehavior[], plan: TestPlan = PLAN): Promise<ReproductionResult> {
  let attempt = 0;
  return reproducePlan({
    plan,
    attempts: behaviors.length,
    dir,
    createAdapter: () => fakeAdapter(behaviors[attempt++] ?? {}),
    createLogger: () => silentLogger,
    command: "reproduce",
    exegezisVersion: "test",
  });
}

function compiled(status: CompiledTestExecution["status"], failedAtStep?: number): CompiledTestExecution {
  return {
    specPath: "BUG-X.spec.ts",
    sha256: "0".repeat(64),
    status,
    exitCode: status === "passed" ? 0 : 1,
    runner: "@playwright/test test",
    ...(failedAtStep === undefined ? {} : { failedAtStep }),
  };
}

/** Verifies a plan the way the CLI pipeline does (without the browser). */
async function verify(plan: TestPlan, behaviors: FakeBehavior[], compiledTest?: CompiledTestExecution): Promise<BugReport> {
  const validation = validatePlan(plan, { descriptor, mode: "verification" });
  const executable = validation.status === "valid" || validation.status === "weakly_anchored";
  const result = executable ? await reproduce(behaviors, plan) : undefined;
  return buildBugReport({
    plan,
    planPath: "plans/BUG-X.json",
    planHash: "sha256:x",
    validation,
    reproduction:
      result?.reproduction ??
      buildReproduction({
        planId: plan.id,
        planHash: "sha256:x",
        planProvenance: plan.provenance,
        targetUrl: plan.target.baseUrl,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        runs: [],
      }),
    reproductionPath: ".",
    outcomes: result?.outcomes ?? [],
    ...(compiledTest === undefined ? {} : { compiledTest }),
    policy,
    exegezisVersion: "test",
  });
}

const times = <T>(n: number, value: T): T[] => Array<T>(n).fill(value);

describe("reproducePlan", () => {
  it("aborts on the first attempt when the engine is not available, instead of classifying the reproduction", async () => {
    await expect(reproduce([{ engineUnavailable: true }, failing, failing])).rejects.toMatchObject({ name: "EngineUnavailableError" });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { recursive: true });
    expect(entries.filter((e) => e.endsWith("metadata.json"))).toHaveLength(1);
  });

  it("10/10 identical failures → REPRODUCED, with one isolated run per attempt", async () => {
    const result = await reproduce(times(10, failing));
    expect(result.reproduction).toMatchObject({ attempts: 10, passes: 0, failures: 10, timeouts: 0, errors: 0, rate: 1, status: "REPRODUCED" });
    expect(new Set(result.reproduction.runs.map((r) => r.runId)).size).toBe(10);
    for (const run of result.reproduction.runs) {
      expect(existsSync(join(dir, run.runPath, "manifest.json")), run.runPath).toBe(true);
      expect(run.failureSignature).toBe('step:4|badge-after-remove|actual="Cart (1)"');
    }
    expect(Reproduction.parse(JSON.parse(readFileSync(join(dir, "reproduction.json"), "utf8"))).status).toBe("REPRODUCED");
  });

  it("10/10 passes → NOT_REPRODUCED", async () => {
    expect((await reproduce(times(10, passing))).reproduction).toMatchObject({ passes: 10, failures: 0, rate: 0, status: "NOT_REPRODUCED" });
  });

  it("mixed results → FLAKY with the observed rate", async () => {
    const result = await reproduce([...times(3, passing), ...times(7, failing)]);
    expect(result.reproduction).toMatchObject({ passes: 3, failures: 7, rate: 0.7, status: "FLAKY" });
  });

  it("timeouts make the reproduction INCONCLUSIVE and are not counted as failures", async () => {
    const result = await reproduce([...times(9, failing), timingOut]);
    expect(result.reproduction).toMatchObject({ failures: 9, timeouts: 1, errors: 0, status: "INCONCLUSIVE" });
    expect(result.reproduction.reason).toMatch(/timed out/);
    expect(result.reproduction.runs[9]).toMatchObject({ verdict: "timeout" });
  });

  it("an execution error makes the reproduction INCONCLUSIVE and is not counted as a failure", async () => {
    const result = await reproduce([...times(9, failing), { ...failing, failOn: "click" }]);
    expect(result.reproduction).toMatchObject({ failures: 9, errors: 1, status: "INCONCLUSIVE" });
    expect(result.reproduction.runs[9]).toMatchObject({ verdict: "error", error: "click timed out" });
  });

  it("failures that differ between attempts → INCONCLUSIVE", async () => {
    const other: FakeBehavior = { evaluate: (a) => (isExpectation(a) ? fails("Cart (0)", "Cart (2)") : passes("Cart (1)")) };
    const result = await reproduce([failing, failing, other]);
    expect(result.reproduction.status).toBe("INCONCLUSIVE");
    expect(result.reproduction.reason).toMatch(/2 different ways/);
  });

  it("carries the plan's provenance", async () => {
    const provenance: Provenance = { source: "model", generator: "claude", model: "M", version: "V", promptVersion: "p1", createdAt: null };
    const result = await reproduce(times(2, failing), { ...PLAN, provenance });
    expect(result.reproduction.planProvenance).toEqual(provenance);
  });

  it("rejects a non-positive attempt count", async () => {
    await expect(reproduce([])).rejects.toThrow(RangeError);
  });
});

describe("Reproduction model", () => {
  it("derives status deterministically", () => {
    const failed = { verdict: "failed" as const, failureSignature: "s" };
    expect(classifyReproduction([]).status).toBe("NOT_RUN");
    expect(classifyReproduction([failed, failed]).status).toBe("REPRODUCED");
    expect(classifyReproduction([{ verdict: "passed" }]).status).toBe("NOT_REPRODUCED");
    expect(classifyReproduction([failed, { verdict: "passed" }]).status).toBe("FLAKY");
    expect(classifyReproduction([failed, { verdict: "timeout" }]).status).toBe("INCONCLUSIVE");
    expect(classifyReproduction([failed, { verdict: "error" }]).status).toBe("INCONCLUSIVE");
    expect(classifyReproduction([{ verdict: "no_assertions" }]).status).toBe("INCONCLUSIVE");
  });

  it("rejects a status that does not follow from the attempts", async () => {
    const { reproduction } = await reproduce([failing, passing]);
    expect(Reproduction.safeParse({ ...reproduction, status: "REPRODUCED" }).success).toBe(false);
    expect(Reproduction.safeParse({ ...reproduction, failures: 2 }).success).toBe(false);
  });
});

describe("verification outcomes", () => {
  it("valid plan + reproducible failure + failing compiled test at the same step → VERIFIED", async () => {
    const bug = await verify(PLAN, times(3, failing), compiled("failed", 4));
    expect(bug.outcome).toBe("VERIFIED");
    expect(bug.criteria.map((c) => [c.id, c.met])).toEqual([
      ["plan_valid", true],
      ["expectation_defined", true],
      ["anchored", true],
      ["reproduced", true],
      ["evidence_captured", true],
      ["executable_test", true],
    ]);
    expect(bug.expected).toMatchObject({ description: "badge shows Cart (0)", value: "Cart (0)" });
    expect(bug.actual?.value).toBe("Cart (1)");
    expect(bug.failingStep).toEqual({ index: 4, id: "badge-after-remove" });
    expect(bug.evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(["assertion", "timeline", "screenshot", "network", "console", "trace"]));
    expect(bug.evidenceChain.map((l) => l.stage)).toEqual(["expectation", "action", "observation", "assertion", "failure", "evidence"]);
  });

  it("healthy plan (expectation holds) → NOT_VERIFIED", async () => {
    const bug = await verify(PLAN, times(3, passing), compiled("passed"));
    expect(bug.outcome).toBe("NOT_VERIFIED");
    expect(bug.expected).toBeNull();
  });

  it("invalid plan → INVALID_PLAN, and it is never executed", async () => {
    const invalid = testPlan([badge("Cart (0)", "anchor", "a"), { type: "click", target: { text: "Go" } }, badge("Cart (1)")], "BUG-I");
    const bug = await verify(invalid, times(3, failing), compiled("failed", 3));
    expect(bug.outcome).toBe("INVALID_PLAN");
    expect(bug.validation.issues.map((i) => i.code)).toContain("FIRST_STEP_NOT_NAVIGATE");
    expect(bug.reproduction).toMatchObject({ status: "NOT_RUN", attempts: 0 });
  });

  it("unsupported assertion → UNSUPPORTED, and it is never executed", async () => {
    const unsupported = testPlan(
      [
        { type: "navigate", url: "/" },
        badge("Cart (0)", "anchor", "a"),
        { type: "click", target: { text: "Add" } },
        { type: "assert", purpose: "expectation", assertion: { kind: "visual", baseline: "cart" } },
      ],
      "BUG-U",
    );
    const bug = await verify(unsupported, times(3, failing));
    expect(bug.outcome).toBe("UNSUPPORTED");
    expect(bug.validation.issues).toMatchObject([{ code: "UNSUPPORTED_ASSERTION", severity: "unsupported", stepIndex: 4 }]);
    expect(bug.reproduction.attempts).toBe(0);
  });

  it("timeouts → INCONCLUSIVE; a timeout alone can never produce VERIFIED", async () => {
    const bug = await verify(PLAN, times(3, timingOut), compiled("failed", 4));
    expect(bug.outcome).toBe("INCONCLUSIVE");
    expect(bug.reproduction).toMatchObject({ timeouts: 3, failures: 0 });
    // Even though the compiled Playwright test fails (Playwright cannot tell a timeout from a failure).
    expect(bug.criteria.find((c) => c.id === "reproduced")?.met).toBe(false);
  });

  it("flaky reproduction → FLAKY", async () => {
    const bug = await verify(PLAN, [failing, passing, failing], compiled("failed", 4));
    expect(bug.outcome).toBe("FLAKY");
  });

  it("weakly anchored plan → INCONCLUSIVE even when the failure reproduces and the spec fails", async () => {
    const weak = testPlan([{ type: "navigate", url: "/" }, badge("Cart (0)")], "BUG-W");
    const bug = await verify(weak, times(3, { evaluate: () => fails("Cart (0)", "Cart (1)") }), compiled("failed", 2));
    expect(bug.outcome).toBe("INCONCLUSIVE");
    expect(bug.validation.status).toBe("weakly_anchored");
    expect(bug.criteria.filter((c) => !c.met).map((c) => c.id)).toEqual(["anchored"]);
  });

  it("a failing anchor → INCONCLUSIVE: the premise of the plan is wrong, not the application", async () => {
    const wrongPremise: FakeBehavior = { evaluate: (a) => (isExpectation(a) ? passes("Cart (0)") : fails("Cart (1)", "Cart (2)")) };
    const bug = await verify(PLAN, times(3, wrongPremise), compiled("failed", 2));
    expect(bug.outcome).toBe("INCONCLUSIVE");
    expect(bug.criteria.find((c) => c.id === "anchored")?.detail).toMatch(/is an anchor/);
  });

  it("too few attempts, a passing/other-step/unrun compiled test → INCONCLUSIVE", async () => {
    expect((await verify(PLAN, times(2, failing), compiled("failed", 4))).outcome).toBe("INCONCLUSIVE");
    expect((await verify(PLAN, times(3, failing), compiled("passed"))).outcome).toBe("INCONCLUSIVE");
    const elsewhere = await verify(PLAN, times(3, failing), compiled("failed", 2));
    expect(elsewhere.criteria.find((c) => c.id === "executable_test")?.detail).toMatch(/failed at step 2 but EXEGEZIS observed the failure at step 4/);
    expect((await verify(PLAN, times(3, failing))).outcome).toBe("INCONCLUSIVE");
  });

  it("insufficient evidence fails the evidence criterion", async () => {
    const result = await reproduce(times(3, failing));
    const outcome = result.outcomes[0];
    const failed = outcome?.assertions.find((a) => a.status === "failed");
    if (outcome === undefined || failed === undefined) throw new Error("expected a failing attempt");
    const validation = validatePlan(PLAN, { descriptor, mode: "verification" });
    const withoutTrace = { ...outcome.manifest, artifacts: outcome.manifest.artifacts.filter((a) => a.type !== "trace") };
    const criteria = evaluateVerification({
      plan: PLAN,
      validation,
      reproduction: result.reproduction,
      representative: { assertion: failed, assertions: outcome.assertions, manifest: withoutTrace, stoppedAtStep: 4 },
      compiledTest: compiled("failed", 4),
      policy,
    });
    expect(criteria.find((c) => c.id === "evidence_captured")).toMatchObject({ met: false, detail: "missing evidence: trace" });
  });

  it("errors → INCONCLUSIVE", async () => {
    const bug = await verify(PLAN, times(3, { evaluate: (a) => (isExpectation(a) ? errors() : passes("Cart (1)")) }), compiled("failed", 4));
    expect(bug.outcome).toBe("INCONCLUSIVE");
  });
});

describe("provenance in reports", () => {
  it("copies human provenance into the report", async () => {
    const human: Provenance = { source: "human", generator: "ana", model: null, version: null, promptVersion: null, createdAt: null };
    const bug = await verify({ ...PLAN, provenance: human }, times(3, failing), compiled("failed", 4));
    expect(bug.provenance).toEqual(human);
  });

  it("copies model provenance into the report, whatever the outcome", async () => {
    const model: Provenance = {
      source: "model",
      generator: "claude",
      model: "MODEL_NAME",
      version: "VERSION",
      promptVersion: "symptom-to-plan/v0",
      createdAt: "2026-09-25T10:00:00.000Z",
    };
    const bug = await verify({ ...PLAN, provenance: model }, times(3, passing), compiled("passed"));
    expect(bug.outcome).toBe("NOT_VERIFIED");
    expect(bug.provenance).toEqual(model);
  });

  it("marks plans without provenance as unknown, never as human", async () => {
    const bug = await verify(PLAN, times(3, failing), compiled("failed", 4));
    expect(bug.provenance.source).toBe("unknown");
  });
});

describe("BugReport schema", () => {
  it("rejects a VERIFIED outcome with an unmet criterion (nobody can just declare a bug verified)", async () => {
    const bug = await verify(PLAN, times(3, passing), compiled("passed"));
    expect(BugReport.safeParse({ ...bug, outcome: "VERIFIED" }).success).toBe(false);
  });
});

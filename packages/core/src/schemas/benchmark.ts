import { z } from "zod";
import { Timestamp } from "./common.js";
import { Provenance } from "./policy.js";
import { VerificationOutcome } from "./verification.js";

/**
 * A benchmark is a fixed dataset of cases with a known correct outcome. It
 * measures the Verification Engine (and, later, whoever writes the plans)
 * both ways: true positives must be VERIFIED, and negatives must never be.
 */
export const BenchmarkSuite = z.strictObject({
  schemaVersion: z.literal("exegezis.benchmark-suite/v1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  /**
   * How to start the application under test on a free port. Trusted repo
   * content, like a package.json script: executed without a shell.
   */
  app: z.strictObject({
    command: z.array(z.string().min(1)).min(1),
    /** Relative to the suite file. */
    cwd: z.string(),
    portEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
    healthPath: z.string().regex(/^\//),
  }),
  /** Attempts per case unless overridden. */
  runs: z.int().min(1).max(100),
  /**
   * Where each case's plan comes from:
   * - `human`: the reference plan in the case (Benchmark A).
   * - `generated`: a planner writes it from the case's symptom (Benchmark B).
   */
  planSource: z.enum(["human", "generated"]).default("human"),
  /**
   * Generated suites only: solved cases (symptom + human plan) the planner may
   * see as examples. A case is never shown an example about its own bug.
   */
  examples: z.array(z.string()).default([]),
  /** Case directories, relative to the suite file; each holds a case.json. */
  cases: z.array(z.string()).min(1),
});
export type BenchmarkSuite = z.infer<typeof BenchmarkSuite>;

export const BenchmarkCase = z
  .strictObject({
    schemaVersion: z.literal("exegezis.benchmark-case/v1"),
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    /** positive: a real bug that must be VERIFIED. negative: must never be VERIFIED. */
    kind: z.enum(["positive", "negative"]),
    title: z.string(),
    /** The symptom as a user would report it. Iteration 3 will generate plans from it. */
    symptom: z.string(),
    /** Known bug this case is about (see the lab's KNOWN_BUGS.md), or null. */
    expectedBug: z.string().nullable(),
    /** The reference plan, relative to the case directory (required in human suites). */
    plan: z.string().optional(),
    /** Generated suites: a recorded model answer for the mock planner (CI), relative to the case directory. */
    mockResponse: z.string().optional(),
    expected: z.strictObject({
      outcome: VerificationOutcome,
      /** Plan step expected to fail, or null when not applicable. */
      step: z.int().positive().nullable(),
      /** Actual value expected at the failing step, or null when not applicable. */
      value: z.json().nullable(),
    }),
    /**
     * Other outcomes that are also correct. Used for negative cases of
     * generated suites, where several safe outcomes are legitimate (e.g. an
     * ambiguous symptom may be declined, or rejected as an invalid plan).
     * VERIFIED is never acceptable for a negative case.
     */
    acceptableOutcomes: z.array(VerificationOutcome).default([]),
  })
  .refine((c) => c.kind === "positive" || !c.acceptableOutcomes.includes("VERIFIED"), {
    message: "VERIFIED can never be an acceptable outcome for a negative case",
    path: ["acceptableOutcomes"],
  })
  .refine((c) => (c.kind === "positive") === (c.expected.outcome === "VERIFIED"), {
    message: "positive cases expect VERIFIED; negative cases expect anything else",
    path: ["expected", "outcome"],
  });
export type BenchmarkCase = z.infer<typeof BenchmarkCase>;

export const BenchmarkCaseResult = z.strictObject({
  id: z.string(),
  kind: BenchmarkCase.shape.kind,
  expectedBug: z.string().nullable(),
  expected: BenchmarkCase.shape.expected,
  actual: z.strictObject({
    outcome: VerificationOutcome,
    step: z.int().positive().nullable(),
    value: z.json().nullable(),
  }),
  /** `failures/attempts`, or null when the plan was not executed. */
  reproduction: z.string().nullable(),
  /** Generated suites: what the planner produced, before any verification. */
  generation: z
    .strictObject({
      status: z.enum(["generated", "declined", "invalid_generation", "error"]),
      detail: z.string().nullable(),
      provider: z.string(),
      model: z.string().nullable(),
      promptVersion: z.string().nullable(),
      latencyMs: z.number().nonnegative().nullable(),
      inputTokens: z.int().nonnegative().nullable(),
      outputTokens: z.int().nonnegative().nullable(),
      examples: z.int().nonnegative(),
      /** Generated plan, relative to the benchmark result directory. */
      plan: z.string().nullable(),
    })
    .nullable(),
  /** Semantic validation status of the plan (null when no plan existed). */
  validation: z.string().nullable(),
  /** Status of the compiled test run by Playwright (null when not executed). */
  compiledTest: z.string().nullable(),
  /** Targets checked against the observed page, and how many did not exist there. */
  selectors: z.strictObject({ checked: z.int().nonnegative(), missing: z.int().nonnegative() }).nullable(),
  provenance: Provenance,
  passed: z.boolean(),
  /** Why the case did not pass (empty when it passed). */
  mismatches: z.array(z.string()),
  /** Bug report of the case, relative to the benchmark result directory. */
  report: z.string(),
  durationMs: z.number().nonnegative(),
});
export type BenchmarkCaseResult = z.infer<typeof BenchmarkCaseResult>;

export const BenchmarkResult = z.strictObject({
  schemaVersion: z.literal("exegezis.benchmark-result/v1"),
  suite: z.string(),
  exegezisVersion: z.string(),
  startedAt: Timestamp,
  finishedAt: Timestamp,
  baseUrl: z.string(),
  runsPerCase: z.int().positive(),
  planSource: z.enum(["human", "generated"]),
  planner: z
    .strictObject({ provider: z.string(), model: z.string().nullable(), promptVersion: z.string(), examples: z.boolean() })
    .nullable(),
  cases: z.array(BenchmarkCaseResult),
  summary: z.strictObject({
    total: z.int().nonnegative(),
    passed: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    /** Positive cases VERIFIED. */
    truePositives: z.int().nonnegative(),
    /** Positive cases not VERIFIED. */
    falseNegatives: z.int().nonnegative(),
    /** Negative cases VERIFIED: the failure mode this engine must never have. */
    falsePositives: z.int().nonnegative(),
    /** Negative cases not VERIFIED. */
    trueNegatives: z.int().nonnegative(),
  }),
  metrics: z.strictObject({
    /** Answers that were schema-valid TestPlans / answers that attempted a plan (declines excluded). */
    planValidityRate: z.number().nullable(),
    /** Plans that passed semantic validation (valid or weakly anchored) / plans that exist. */
    semanticValidityRate: z.number().nullable(),
    /** Positive cases VERIFIED / positive cases. */
    verificationSuccess: z.number().nullable(),
    /** Negative cases VERIFIED / negative cases. Must be 0. */
    falsePositiveRate: z.number().nullable(),
    inconclusiveRate: z.number(),
    invalidPlanRate: z.number(),
    /** Mean failures/attempts over executed positive cases. */
    reproductionRate: z.number().nullable(),
    /** Strongly anchored plans / executable plans (valid or weakly anchored). */
    anchorQuality: z.number().nullable(),
    /** Targets found on the observed page / targets checked. */
    selectorQuality: z.number().nullable(),
    /** Executed cases where Playwright agrees with the engine / executed cases. */
    playwrightAgreement: z.number().nullable(),
  }),
});
export type BenchmarkResult = z.infer<typeof BenchmarkResult>;

/** Compares a case's expectation with what verification produced. */
export function scoreCase(
  expected: BenchmarkCase["expected"],
  actual: BenchmarkCaseResult["actual"],
  acceptableOutcomes: readonly BenchmarkCase["expected"]["outcome"][] = [],
): { passed: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (actual.outcome !== expected.outcome && !acceptableOutcomes.includes(actual.outcome)) {
    const acceptable = acceptableOutcomes.length === 0 ? "" : ` (or ${acceptableOutcomes.join(", ")})`;
    mismatches.push(`outcome ${actual.outcome}, expected ${expected.outcome}${acceptable}`);
    return { passed: false, mismatches };
  }
  // Step and value only describe the expected outcome itself.
  if (actual.outcome !== expected.outcome) return { passed: true, mismatches };
  if (expected.step !== null && actual.step !== expected.step) mismatches.push(`failed at step ${actual.step ?? "none"}, expected ${expected.step}`);
  if (expected.value !== null && JSON.stringify(actual.value) !== JSON.stringify(expected.value)) {
    mismatches.push(`actual value ${JSON.stringify(actual.value)}, expected ${JSON.stringify(expected.value)}`);
  }
  return { passed: mismatches.length === 0, mismatches };
}

export function summarize(cases: readonly BenchmarkCaseResult[]): BenchmarkResult["summary"] {
  const verified = (c: BenchmarkCaseResult): boolean => c.actual.outcome === "VERIFIED";
  return {
    total: cases.length,
    passed: cases.filter((c) => c.passed).length,
    failed: cases.filter((c) => !c.passed).length,
    truePositives: cases.filter((c) => c.kind === "positive" && verified(c)).length,
    falseNegatives: cases.filter((c) => c.kind === "positive" && !verified(c)).length,
    falsePositives: cases.filter((c) => c.kind === "negative" && verified(c)).length,
    trueNegatives: cases.filter((c) => c.kind === "negative" && !verified(c)).length,
  };
}

/** Metrics over case results (the same definitions for human and generated plans). */
export function computeMetrics(cases: readonly BenchmarkCaseResult[]): BenchmarkResult["metrics"] {
  const rate = (num: number, den: number): number | null => (den === 0 ? null : num / den);
  const positives = cases.filter((c) => c.kind === "positive");
  const negatives = cases.filter((c) => c.kind === "negative");
  const generated = cases.filter((c) => c.generation !== null);
  const withPlan = cases.filter((c) => c.validation !== null);
  const executed = cases.filter((c) => c.reproduction !== null);
  const executable = withPlan.filter((c) => c.validation === "valid" || c.validation === "weakly_anchored");
  const attempted = generated.filter((c) => c.generation?.status === "generated" || c.generation?.status === "invalid_generation");
  const reproduction = executed.filter((c) => c.kind === "positive").map((c) => {
    const [failures, attempts] = (c.reproduction ?? "0/1").split("/").map(Number);
    return (failures ?? 0) / (attempts ?? 1);
  });
  const agrees = (c: BenchmarkCaseResult): boolean =>
    c.actual.outcome === "VERIFIED"
      ? c.compiledTest === "failed"
      : c.actual.outcome === "NOT_VERIFIED"
        ? c.compiledTest === "passed"
        : true;
  const checked = cases.reduce((sum, c) => sum + (c.selectors?.checked ?? 0), 0);
  const missing = cases.reduce((sum, c) => sum + (c.selectors?.missing ?? 0), 0);
  return {
    planValidityRate: rate(attempted.filter((c) => c.generation?.status === "generated").length, attempted.length),
    semanticValidityRate: rate(withPlan.filter((c) => c.validation === "valid" || c.validation === "weakly_anchored").length, withPlan.length),
    verificationSuccess: rate(positives.filter((c) => c.actual.outcome === "VERIFIED").length, positives.length),
    falsePositiveRate: rate(negatives.filter((c) => c.actual.outcome === "VERIFIED").length, negatives.length),
    inconclusiveRate: rate(cases.filter((c) => c.actual.outcome === "INCONCLUSIVE").length, cases.length) ?? 0,
    invalidPlanRate: rate(cases.filter((c) => c.actual.outcome === "INVALID_PLAN").length, cases.length) ?? 0,
    reproductionRate: rate(reproduction.reduce((a, b) => a + b, 0), reproduction.length),
    anchorQuality: rate(executable.filter((c) => c.validation === "valid").length, executable.length),
    selectorQuality: rate(checked - missing, checked),
    playwrightAgreement: rate(executed.filter(agrees).length, executed.length),
  };
}

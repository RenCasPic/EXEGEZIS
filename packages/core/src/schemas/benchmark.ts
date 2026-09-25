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
    /** The reference plan, relative to the case directory. */
    plan: z.string(),
    expected: z.strictObject({
      outcome: VerificationOutcome,
      /** Plan step expected to fail, or null when not applicable. */
      step: z.int().positive().nullable(),
      /** Actual value expected at the failing step, or null when not applicable. */
      value: z.json().nullable(),
    }),
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
});
export type BenchmarkResult = z.infer<typeof BenchmarkResult>;

/** Compares a case's expectation with what verification produced. */
export function scoreCase(
  expected: BenchmarkCase["expected"],
  actual: BenchmarkCaseResult["actual"],
): { passed: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (actual.outcome !== expected.outcome) mismatches.push(`outcome ${actual.outcome}, expected ${expected.outcome}`);
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

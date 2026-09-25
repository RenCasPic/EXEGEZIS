import { z } from "zod";
import { RunId, Timestamp } from "./common.js";
import { Provenance } from "./policy.js";
import { RunVerdict } from "./run.js";

/**
 * - `NOT_RUN`: no attempts.
 * - `REPRODUCED`: every attempt failed the same way (same step, same actual value).
 * - `NOT_REPRODUCED`: every attempt passed.
 * - `FLAKY`: some attempts passed and some failed.
 * - `INCONCLUSIVE`: at least one attempt timed out or could not be
 *   evaluated, or the failures were not identical. Nothing can be concluded.
 */
export const ReproductionStatus = z.enum(["NOT_RUN", "REPRODUCED", "NOT_REPRODUCED", "FLAKY", "INCONCLUSIVE"]);
export type ReproductionStatus = z.infer<typeof ReproductionStatus>;

export const ReproductionAttempt = z.strictObject({
  attempt: z.int().positive(),
  runId: RunId,
  /** Path of the attempt's run directory, relative to the reproduction directory. */
  runPath: z.string(),
  verdict: RunVerdict,
  /** Step that stopped the attempt (failed assertion or error). */
  stoppedAtStep: z.int().positive().optional(),
  /**
   * Identity of a failure: `step:<n>|<assertion id>|actual=<canonical JSON>`.
   * Two attempts failed "the same way" only if their signatures are equal.
   */
  failureSignature: z.string().optional(),
  /** Why the attempt could not be evaluated (verdict `error`). */
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
});
export type ReproductionAttempt = z.infer<typeof ReproductionAttempt>;

export const Reproduction = z
  .strictObject({
    schemaVersion: z.literal("exegezis.reproduction/v1"),
    planId: z.string(),
    planHash: z.string(),
    planProvenance: Provenance,
    targetUrl: z.string(),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    attempts: z.int().nonnegative(),
    /** Attempts in which every assertion held (behavior not reproduced). */
    passes: z.int().nonnegative(),
    /** Attempts in which an assertion was evaluated and did not hold. */
    failures: z.int().nonnegative(),
    /** Attempts whose deciding assertion timed out (never counted as failures). */
    timeouts: z.int().nonnegative(),
    /** Attempts that could not be evaluated (never counted as failures). */
    errors: z.int().nonnegative(),
    /** failures / attempts; null when there were no attempts. */
    rate: z.number().min(0).max(1).nullable(),
    status: ReproductionStatus,
    /** Deterministic explanation of `status`. */
    reason: z.string(),
    runs: z.array(ReproductionAttempt),
  })
  .refine((r) => r.passes + r.failures + r.timeouts + r.errors === r.attempts, {
    message: "passes + failures + timeouts + errors must equal attempts",
  })
  .refine((r) => r.runs.length === r.attempts, { message: "runs must list one entry per attempt" })
  .refine(
    (r) => (r.attempts === 0 ? r.rate === null : r.rate !== null && Math.abs(r.rate - r.failures / r.attempts) < 1e-9),
    { message: "rate must equal failures / attempts (null when attempts is 0)" },
  )
  .refine((r) => r.status === classifyReproduction(r.runs).status, {
    message: "status must follow from the attempts",
  });
export type Reproduction = z.infer<typeof Reproduction>;

/** The deterministic rules behind `ReproductionStatus`. */
export function classifyReproduction(runs: readonly Pick<ReproductionAttempt, "verdict" | "failureSignature">[]): {
  status: ReproductionStatus;
  reason: string;
} {
  if (runs.length === 0) return { status: "NOT_RUN", reason: "no attempts were executed" };
  const errors = runs.filter((r) => r.verdict === "error" || r.verdict === "no_assertions").length;
  const timeouts = runs.filter((r) => r.verdict === "timeout").length;
  const failures = runs.filter((r) => r.verdict === "failed");
  const passes = runs.filter((r) => r.verdict === "passed").length;
  if (timeouts > 0) {
    return {
      status: "INCONCLUSIVE",
      reason: `${timeouts} of ${runs.length} attempts timed out without a conclusion; a timeout is never counted as a failure`,
    };
  }
  if (errors > 0) {
    return {
      status: "INCONCLUSIVE",
      reason: `${errors} of ${runs.length} attempts could not be evaluated; errors are never counted as failures`,
    };
  }
  if (passes === runs.length) {
    return { status: "NOT_REPRODUCED", reason: `all ${runs.length} attempts met every expectation` };
  }
  if (failures.length === runs.length) {
    const signatures = new Set(failures.map((r) => r.failureSignature));
    return signatures.size === 1
      ? { status: "REPRODUCED", reason: `all ${runs.length} attempts failed identically` }
      : {
          status: "INCONCLUSIVE",
          reason: `all attempts failed, but in ${signatures.size} different ways; the failure is not stable`,
        };
  }
  return {
    status: "FLAKY",
    reason: `${failures.length} of ${runs.length} attempts failed and ${passes} passed; the behavior is not deterministic`,
  };
}

export function buildReproduction(input: {
  planId: string;
  planHash: string;
  planProvenance: Provenance;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  runs: ReproductionAttempt[];
}): Reproduction {
  const { runs } = input;
  const failures = runs.filter((r) => r.verdict === "failed").length;
  const passes = runs.filter((r) => r.verdict === "passed").length;
  const timeouts = runs.filter((r) => r.verdict === "timeout").length;
  const { status, reason } = classifyReproduction(runs);
  return Reproduction.parse({
    schemaVersion: "exegezis.reproduction/v1",
    ...input,
    attempts: runs.length,
    passes,
    failures,
    timeouts,
    errors: runs.length - failures - passes - timeouts,
    rate: runs.length === 0 ? null : failures / runs.length,
    status,
    reason,
  });
}

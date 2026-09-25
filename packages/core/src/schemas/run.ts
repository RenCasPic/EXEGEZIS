import { z } from "zod";
import { ErrorInfo, RelativePath, RunId, Timestamp, Viewport } from "./common.js";
import { Provenance, TimeoutPolicy } from "./policy.js";

/** Whether EXEGEZIS itself managed to execute and record the run. */
export const RunStatus = z.enum(["running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunVerdict = z.enum(["passed", "failed", "timeout", "error", "no_assertions"]);
export type RunVerdict = z.infer<typeof RunVerdict>;

export const Target = z.strictObject({
  kind: z.literal("web"),
  url: z.url(),
});
export type Target = z.infer<typeof Target>;

export const CollectorStatus = z.strictObject({
  status: z.enum(["ok", "failed", "skipped"]),
  detail: z.string().optional(),
});
export type CollectorStatus = z.infer<typeof CollectorStatus>;

/**
 * Everything needed to explain *where* a run happened. Two runs with equal
 * `configHash`, `planHash` and environment should behave the same unless the
 * target itself changed; that is the basis for comparing runs.
 */
export const RunEnvironment = z.strictObject({
  exegezis: z.strictObject({ version: z.string() }),
  runtime: z.strictObject({
    name: z.literal("node"),
    version: z.string(),
    platform: z.string(),
    arch: z.string(),
    osRelease: z.string(),
  }),
  adapter: z.strictObject({ id: z.string(), version: z.string() }),
  browser: z
    .strictObject({
      name: z.string(),
      version: z.string(),
      userAgent: z.string(),
      headless: z.boolean(),
      viewport: Viewport,
    })
    .optional(),
  automation: z.strictObject({ name: z.string(), version: z.string() }).optional(),
});
export type RunEnvironment = z.infer<typeof RunEnvironment>;

export const RunMetadata = z.strictObject({
  schemaVersion: z.literal("exegezis.run/v1"),
  runId: RunId,
  command: z.string(),
  status: RunStatus,
  startedAt: Timestamp,
  finishedAt: Timestamp.optional(),
  durationMs: z.number().nonnegative().optional(),
  target: Target,
  /** Adapter configuration used for the run (validated by the adapter). */
  config: z.record(z.string(), z.unknown()),
  /** sha256 of the canonical JSON of `{ target, config }`. */
  configHash: z.string(),
  /** sha256 of the canonical JSON of the (redacted) plan. */
  planHash: z.string(),
  environment: RunEnvironment.optional(),
  collectors: z.record(z.string(), CollectorStatus),
  error: ErrorInfo.extend({ phase: z.string() }).optional(),
  /**
   * What the plan concluded, independent of `status`:
   * - `passed`: every assertion held.
   * - `failed`: an assertion was evaluated, its value was stable, and it did not hold.
   * - `timeout`: an assertion reached its timeout without a conclusion.
   * - `error`: the plan could not be evaluated (action failed, target not found,
   *   app unreachable...). Never evidence of a bug.
   * - `no_assertions`: the plan only observes; there is nothing to conclude.
   */
  verdict: RunVerdict.optional(),
  plan: z
    .strictObject({ id: z.string(), title: z.string(), steps: z.int().positive(), provenance: Provenance })
    .optional(),
  /** Effective timeout policy (defaults + plan overrides). */
  timeouts: TimeoutPolicy.optional(),
  assertions: z
    .strictObject({
      total: z.int().nonnegative(),
      passed: z.int().nonnegative(),
      failed: z.int().nonnegative(),
      timedOut: z.int().nonnegative(),
      errored: z.int().nonnegative(),
      /** Declared in the plan but not reached because an earlier step stopped the run. */
      notRun: z.int().nonnegative(),
    })
    .optional(),
  /** 1-based index of the step that stopped the plan (failed assertion or error). */
  stoppedAtStep: z.int().positive().optional(),
  redaction: z.strictObject({
    policy: z.string(),
    /** Number of distinct secret values that were scrubbed from artifacts. */
    secretValuesTracked: z.int().nonnegative(),
  }),
  manifest: RelativePath,
});
export type RunMetadata = z.infer<typeof RunMetadata>;

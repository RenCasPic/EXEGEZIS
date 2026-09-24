import { z } from "zod";
import { ErrorInfo, RelativePath, RunId, Timestamp, Viewport } from "./common.js";

export const RunStatus = z.enum(["running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

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

export const Reproduction = z
  .strictObject({
    /** Number of executions of the same plan. */
    attempts: z.int().nonnegative(),
    /** Executions in which the behavior under study was reproduced. */
    successes: z.int().nonnegative(),
    /** Executions in which it was not reproduced. */
    failures: z.int().nonnegative(),
    /** successes / attempts, or null when there were no attempts. */
    rate: z.number().min(0).max(1).nullable(),
    runIds: z.array(RunId).optional(),
  })
  .refine((r) => r.successes + r.failures === r.attempts, {
    message: "successes + failures must equal attempts",
  })
  .refine(
    (r) =>
      r.attempts === 0 ? r.rate === null : r.rate !== null && Math.abs(r.rate - r.successes / r.attempts) < 1e-9,
    { message: "rate must equal successes / attempts (null when attempts is 0)" },
  )
  .refine((r) => r.runIds === undefined || r.runIds.length === r.attempts, {
    message: "runIds must list one run per attempt",
  });
export type Reproduction = z.infer<typeof Reproduction>;

/** Builds a Reproduction from per-attempt outcomes (true = reproduced). */
export function computeReproduction(outcomes: readonly boolean[], runIds?: readonly string[]): Reproduction {
  const successes = outcomes.filter(Boolean).length;
  const attempts = outcomes.length;
  return Reproduction.parse({
    attempts,
    successes,
    failures: attempts - successes,
    rate: attempts === 0 ? null : successes / attempts,
    ...(runIds === undefined ? {} : { runIds: [...runIds] }),
  });
}

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
  reproduction: Reproduction.optional(),
  redaction: z.strictObject({
    policy: z.string(),
    /** Number of distinct secret values that were scrubbed from artifacts. */
    secretValuesTracked: z.int().nonnegative(),
  }),
  manifest: RelativePath,
});
export type RunMetadata = z.infer<typeof RunMetadata>;

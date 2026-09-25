import { z } from "zod";

/**
 * The single source of truth for timeouts. Engine and compiled specs both
 * derive every wait from it; nothing is hardcoded in individual steps unless
 * a step explicitly overrides its own timeout.
 */
export const TimeoutPolicy = z.strictObject({
  /** Max wait for an action (click, fill...) to find and act on its target. */
  actionMs: z.int().positive().max(600_000),
  /** Max wait for a navigation to reach its load state. */
  navigationMs: z.int().positive().max(600_000),
  /** How long an assertion retries before settling as failed or timeout. */
  assertionMs: z.int().positive().max(60_000),
  /**
   * A failed assertion requires its observed value to have been stable for
   * this long (capped at half the assertion timeout). A value still changing
   * at the deadline is a timeout, not a failure.
   */
  stabilityMs: z.int().nonnegative().max(10_000),
  /** Budget for the whole run, adapter start included. */
  runMs: z.int().positive().max(3_600_000),
});
export type TimeoutPolicy = z.infer<typeof TimeoutPolicy>;

export const DEFAULT_TIMEOUT_POLICY: TimeoutPolicy = {
  actionMs: 10_000,
  navigationMs: 30_000,
  assertionMs: 5_000,
  stabilityMs: 250,
  runMs: 120_000,
};

export const TimeoutOverrides = TimeoutPolicy.partial();
export type TimeoutOverrides = z.infer<typeof TimeoutOverrides>;

export function resolveTimeouts(...overrides: (TimeoutOverrides | undefined)[]): TimeoutPolicy {
  const merged: TimeoutPolicy = { ...DEFAULT_TIMEOUT_POLICY };
  for (const override of overrides) {
    if (override === undefined) continue;
    for (const [key, value] of Object.entries(override) as [keyof TimeoutPolicy, number | undefined][]) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return TimeoutPolicy.parse(merged);
}

/** Stability window actually applied for an assertion with the given timeout. */
export function effectiveStabilityMs(policy: TimeoutPolicy, assertionTimeoutMs: number): number {
  return Math.min(policy.stabilityMs, Math.floor(assertionTimeoutMs / 2));
}

/**
 * Where a plan came from. Nothing is inferred: unknown fields stay null, and
 * a plan without provenance is `unknown`, never assumed to be human.
 */
export const Provenance = z.strictObject({
  source: z.enum(["human", "model", "tool", "unknown"]),
  /** Who or what produced it, e.g. a person's handle, "claude", a tool name. */
  generator: z.string().max(200).nullable().default(null),
  model: z.string().max(200).nullable().default(null),
  version: z.string().max(200).nullable().default(null),
  promptVersion: z.string().max(200).nullable().default(null),
  createdAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type Provenance = z.infer<typeof Provenance>;

export const UNKNOWN_PROVENANCE: Provenance = {
  source: "unknown",
  generator: null,
  model: null,
  version: null,
  promptVersion: null,
  createdAt: null,
};

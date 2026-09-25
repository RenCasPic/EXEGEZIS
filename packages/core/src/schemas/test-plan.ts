import { z } from "zod";
import { Action, REDACTED } from "./action.js";
import { AssertStep } from "./assertion.js";
import { Provenance, TimeoutOverrides, UNKNOWN_PROVENANCE } from "./policy.js";

/** A plan step that asks the adapter for a full observation of current state. */
export const ObserveStep = z.strictObject({
  type: z.literal("observe"),
  label: z.string().max(48).optional(),
});
export type ObserveStep = z.infer<typeof ObserveStep>;

/**
 * One step of a plan. Actions, assertions and observations share a single
 * ordered sequence because order is meaning: an assertion checks the state
 * produced by the actions before it (`click → assert → click → assert`).
 */
export const PlanStep = z.union([Action, AssertStep, ObserveStep]);
export type PlanStep = z.infer<typeof PlanStep>;
export type PlanStepInput = z.input<typeof PlanStep>;

/** Steps without a target: the format of `exegezis observe --actions`. */
export const Plan = z.strictObject({
  schemaVersion: z.literal("exegezis.plan/v1"),
  name: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  steps: z.array(PlanStep).min(1),
});
export type Plan = z.infer<typeof Plan>;

const MetadataValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/**
 * A self-contained, executable test: where to run, what to do and what must
 * be true. Everything EXEGEZIS needs to execute, reproduce and compile it.
 */
export const TestPlan = z.strictObject({
  schemaVersion: z.literal("exegezis.test-plan/v1"),
  /** Stable identifier, e.g. `BUG-001`. Used for file names and reports. */
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "letters, digits, '.', '_' and '-' only"),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  target: z.strictObject({
    kind: z.literal("web"),
    /** Default environment. Overridable at execution (`--base-url`). */
    baseUrl: z.url(),
  }),
  /**
   * Conditions assumed true before step 1, in plain language. Documentation
   * only: anything that must be *done* is a step. Every execution starts from
   * a fresh browser context.
   */
  preconditions: z.array(z.string().max(300)).default([]),
  /** Overrides of the default timeout policy for this plan. */
  timeouts: TimeoutOverrides.optional(),
  /** Who or what wrote the plan. Carried into every run, reproduction and report. */
  provenance: Provenance.default(UNKNOWN_PROVENANCE),
  steps: z.array(PlanStep).min(1),
  metadata: z.record(z.string(), MetadataValue).default({}),
});
export type TestPlan = z.infer<typeof TestPlan>;
export type TestPlanInput = z.input<typeof TestPlan>;

/**
 * Returns a copy of the step that is safe to persist. Only `fill` carries
 * user-provided values; sensitive ones are replaced by a marker.
 */
export function redactAction<T extends PlanStep>(step: T, isSensitive = false): T {
  if (step.type === "fill" && (step.sensitive === true || isSensitive)) {
    return { ...step, value: REDACTED };
  }
  return step;
}

export function redactPlan<T extends { steps: PlanStep[] }>(plan: T): T {
  return { ...plan, steps: plan.steps.map((step) => redactAction(step)) };
}

/** Wraps an `observe --actions` plan (or a bare URL) as a TestPlan. */
export function toTestPlan(plan: Plan, baseUrl: string, id = "observe"): TestPlan {
  return TestPlan.parse({
    schemaVersion: "exegezis.test-plan/v1",
    id,
    title: plan.name ?? "Observe",
    ...(plan.description === undefined ? {} : { description: plan.description }),
    target: { kind: "web", baseUrl },
    steps: plan.steps,
  });
}

export function hasAssertions(plan: { steps: readonly PlanStep[] }): boolean {
  return plan.steps.some((step) => step.type === "assert");
}

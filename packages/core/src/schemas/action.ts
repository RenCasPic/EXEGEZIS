import { z } from "zod";

/**
 * How an action refers to an element. Semantic targets (role, label, text)
 * are preferred: they survive markup changes and are what an accessibility
 * snapshot exposes, so an observation can be turned directly into an action.
 * `css` exists as an explicit escape hatch.
 */
export const ElementTarget = z.union([
  z.strictObject({
    role: z.string().min(1),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.strictObject({ label: z.string().min(1), exact: z.boolean().optional() }),
  z.strictObject({ text: z.string().min(1), exact: z.boolean().optional() }),
  z.strictObject({ placeholder: z.string().min(1), exact: z.boolean().optional() }),
  z.strictObject({ testId: z.string().min(1) }),
  z.strictObject({ css: z.string().min(1) }),
]);
export type ElementTarget = z.infer<typeof ElementTarget>;

const TimeoutMs = z.int().positive().max(600_000);

export const LoadState = z.enum(["load", "domcontentloaded", "networkidle"]);
export type LoadState = z.infer<typeof LoadState>;

export const NavigateAction = z.strictObject({
  type: z.literal("navigate"),
  url: z.url(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
  timeoutMs: TimeoutMs.optional(),
});

export const ClickAction = z.strictObject({
  type: z.literal("click"),
  target: ElementTarget,
  timeoutMs: TimeoutMs.optional(),
});

export const FillAction = z.strictObject({
  type: z.literal("fill"),
  target: ElementTarget,
  value: z.string(),
  /**
   * Marks the value as a secret: it is never written to any artifact and is
   * scrubbed from the trace. Password fields are treated as sensitive even
   * when this flag is omitted.
   */
  sensitive: z.boolean().optional(),
  timeoutMs: TimeoutMs.optional(),
});

export const PressAction = z.strictObject({
  type: z.literal("press"),
  key: z.string().min(1),
  /** Element to focus before pressing; defaults to the focused element. */
  target: ElementTarget.optional(),
  timeoutMs: TimeoutMs.optional(),
});

export const WaitCondition = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("timeout"), ms: z.int().nonnegative().max(60_000) }),
  z.strictObject({
    kind: z.literal("element"),
    target: ElementTarget,
    state: z.enum(["visible", "hidden", "attached", "detached"]),
  }),
  z.strictObject({ kind: z.literal("loadState"), state: LoadState }),
]);
export type WaitCondition = z.infer<typeof WaitCondition>;

export const WaitAction = z.strictObject({
  type: z.literal("wait"),
  condition: WaitCondition,
  timeoutMs: TimeoutMs.optional(),
});

export const ScreenshotAction = z.strictObject({
  type: z.literal("screenshot"),
  /** Human label, used in the file name. */
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes")
    .max(48)
    .optional(),
  fullPage: z.boolean().optional(),
});

/** An action executed against a target. Actions are data, never code. */
export const Action = z.discriminatedUnion("type", [
  NavigateAction,
  ClickAction,
  FillAction,
  PressAction,
  WaitAction,
  ScreenshotAction,
]);
export type Action = z.infer<typeof Action>;
export type ActionType = Action["type"];
export const ActionType = z.enum(["navigate", "click", "fill", "press", "wait", "screenshot"]);

/** A plan step that asks the adapter for a full observation of current state. */
export const ObserveStep = z.strictObject({
  type: z.literal("observe"),
  label: z.string().max(48).optional(),
});
export type ObserveStep = z.infer<typeof ObserveStep>;

export const PlanStep = z.union([Action, ObserveStep]);
export type PlanStep = z.infer<typeof PlanStep>;

export const Plan = z.strictObject({
  schemaVersion: z.literal("exegezis.plan/v1"),
  name: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  steps: z.array(PlanStep).min(1),
});
export type Plan = z.infer<typeof Plan>;

export const REDACTED = "[REDACTED]";

/**
 * Returns a copy of the action that is safe to persist. Only `fill` carries
 * user-provided values; sensitive ones are replaced by a marker.
 */
export function redactAction<T extends PlanStep>(step: T, isSensitive = false): T {
  if (step.type === "fill" && (step.sensitive === true || isSensitive)) {
    return { ...step, value: REDACTED };
  }
  return step;
}

/** Compact, human-readable description of a target, e.g. `button "Checkout"`. */
export function describeTarget(target: ElementTarget): string {
  if ("role" in target) {
    return target.name === undefined ? target.role : `${target.role} "${target.name}"`;
  }
  if ("label" in target) return `label "${target.label}"`;
  if ("text" in target) return `text "${target.text}"`;
  if ("placeholder" in target) return `placeholder "${target.placeholder}"`;
  if ("testId" in target) return `testId "${target.testId}"`;
  return `css "${target.css}"`;
}

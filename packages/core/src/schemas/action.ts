import { z } from "zod";
import { ElementTarget } from "./target.js";

export { describeTarget, ElementTarget } from "./target.js";

const TimeoutMs = z.int().positive().max(600_000);

export const LoadState = z.enum(["load", "domcontentloaded", "networkidle"]);
export type LoadState = z.infer<typeof LoadState>;

/**
 * An absolute URL, or a path (`/cart`) resolved against the target's base
 * URL at execution time, so the same plan runs against any environment.
 */
export const NavigationUrl = z.union([z.url(), z.string().regex(/^\/(?!\/)/, "must be an absolute URL or a path starting with /")]);

export const NavigateAction = z.strictObject({
  type: z.literal("navigate"),
  url: NavigationUrl,
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
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;
export const ActionType = z.enum(["navigate", "click", "fill", "press", "wait", "screenshot"]);

export const REDACTED = "[REDACTED]";

/** Resolves a navigation URL (absolute or `/path`) against a base URL. */
export function resolveNavigationUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

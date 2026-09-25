import { z } from "zod";

/**
 * How a step refers to an element. Strategies in order of preference:
 * role + accessible name, label, text, placeholder, test id, CSS.
 * Semantic targets survive markup changes and are what an accessibility
 * snapshot exposes, so an observation can be turned directly into a step.
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

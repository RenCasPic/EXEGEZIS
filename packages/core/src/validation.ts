import { z } from "zod";
import { EngineMessage, englishOf, msg } from "./messages.js";
import type { AdapterDescriptor } from "./adapter.js";
import { resolveNavigationUrl } from "./schemas/action.js";
import { normalizeText } from "./schemas/assertion.js";
import { AccessibilityNode } from "./schemas/evidence.js";
import { resolveTimeouts, TimeoutPolicy } from "./schemas/policy.js";
import { describeTarget, type ElementTarget } from "./schemas/target.js";
import type { PlanStep, TestPlan } from "./schemas/test-plan.js";

/**
 * Semantic validation runs after schema validation and before execution. The
 * schema says a plan is well-formed; this says whether it can support the
 * conclusion it is trying to reach. It is deterministic: it reports only what
 * it can prove from the plan, the adapter descriptor and (optionally) a
 * reference observation of the target. It never "fixes" a plan.
 */

/** A page observed before execution (preflight), used to check targets. */
export const ReferencePage = z.strictObject({
  url: z.string(),
  accessibility: z.array(AccessibilityNode),
  latency: z
    .strictObject({
      /** Time for the navigation to load. */
      navigationMs: z.number().nonnegative(),
      /** Slowest fetch/XHR response observed while loading. */
      slowestResponseMs: z.number().nonnegative(),
    })
    .optional(),
});
export type ReferencePage = z.infer<typeof ReferencePage>;

export const IssueCode = z.enum([
  // → UNSUPPORTED
  "UNSUPPORTED_ACTION",
  "UNSUPPORTED_ASSERTION",
  // → INVALID_PLAN
  "FIRST_STEP_NOT_NAVIGATE",
  "DUPLICATE_STEP_ID",
  "NO_EXPECTATION",
  "TARGET_NOT_IN_REFERENCE",
  // → WEAKLY_ANCHORED
  "EXPECTATION_WITHOUT_ANCHOR",
  "EXPECTATION_WITHOUT_ACTION",
  // Warnings: reported, do not change the status
  "ANCHOR_AFTER_LAST_EXPECTATION",
  "TIMEOUT_BELOW_OBSERVED_LATENCY",
]);
export type IssueCode = z.infer<typeof IssueCode>;

/**
 * - `unsupported`: the adapter cannot execute or evaluate a step.
 * - `error`: the plan cannot support a conclusion as written.
 * - `anchoring`: the plan can run, but a failure would be weak evidence.
 * - `warning`: worth knowing; does not change the status.
 */
export const IssueSeverity = z.enum(["unsupported", "error", "anchoring", "warning"]);
export type IssueSeverity = z.infer<typeof IssueSeverity>;

export const ValidationIssue = z.strictObject({
  code: IssueCode,
  severity: IssueSeverity,
  stepIndex: z.int().positive().optional(),
  /** English. */
  message: z.string(),
  /** The same message as a code and parameters, for every language (absent in older reports). */
  detail: EngineMessage.optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const PlanValidationStatus = z.enum(["valid", "weakly_anchored", "invalid", "unsupported"]);
export type PlanValidationStatus = z.infer<typeof PlanValidationStatus>;

export const PlanValidation = z.strictObject({
  schemaVersion: z.literal("exegezis.plan-validation/v1"),
  planId: z.string(),
  mode: z.enum(["verification", "execution"]),
  status: PlanValidationStatus,
  issues: z.array(ValidationIssue),
  timeouts: TimeoutPolicy,
  reference: z
    .strictObject({
      pages: z.array(z.string()),
      /** Targets compared against the reference accessibility tree. */
      targetsChecked: z.int().nonnegative(),
      /** Targets that could not be checked (after a state change, css/testId...). */
      targetsUnchecked: z.int().nonnegative(),
    })
    .nullable(),
});
export type PlanValidation = z.infer<typeof PlanValidation>;

export interface ValidateOptions {
  descriptor: Pick<AdapterDescriptor, "actions" | "assertions">;
  /**
   * `verification`: the plan must be able to demonstrate a bug (it needs an
   * expectation, and anchoring is assessed). `execution`: just run it.
   */
  mode: "verification" | "execution";
  reference?: readonly ReferencePage[];
  baseUrl?: string;
}

/** Steps that change application state. Waits, assertions and observations do not. */
const STATE_CHANGING = new Set<PlanStep["type"]>(["click", "fill", "press"]);

/** Roles that receive their accessible name from a <label>. */
const LABELLED_ROLES = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "spinbutton", "slider", "switch", "listbox"]);

export function validatePlan(plan: TestPlan, options: ValidateOptions): PlanValidation {
  const issues: ValidationIssue[] = [];
  const issue = (code: IssueCode, severity: IssueSeverity, detail: EngineMessage, stepIndex?: number): void => {
    issues.push({ code, severity, message: englishOf(detail), detail, ...(stepIndex === undefined ? {} : { stepIndex }) });
  };
  const timeouts = resolveTimeouts(plan.timeouts);
  const steps = plan.steps.map((step, i) => ({ step, index: i + 1 }));

  // Capabilities: the adapter must declare every action and assertion.
  for (const { step, index } of steps) {
    if (step.type === "assert") {
      if (!options.descriptor.assertions.includes(step.assertion.kind)) {
        issue("UNSUPPORTED_ASSERTION", "unsupported", msg("valUnsupportedAssertion", { kind: step.assertion.kind }), index);
      }
    } else if (step.type !== "observe" && !options.descriptor.actions.includes(step.type)) {
      issue("UNSUPPORTED_ACTION", "unsupported", msg("valUnsupportedAction", { type: step.type }), index);
    }
  }

  // Structure.
  const first = steps.find(({ step }) => step.type !== "observe");
  if (first !== undefined && first.step.type !== "navigate") {
    issue("FIRST_STEP_NOT_NAVIGATE", "error", msg("valFirstNotNavigate"), first.index);
  }
  const seen = new Map<string, number>();
  for (const { step, index } of steps) {
    if (step.type !== "assert" || step.id === undefined) continue;
    const previous = seen.get(step.id);
    if (previous !== undefined) issue("DUPLICATE_STEP_ID", "error", msg("valDuplicateId", { id: step.id, step: previous }), index);
    seen.set(step.id, index);
  }

  // Expectations and anchoring.
  const expectations = steps.filter(({ step }) => step.type === "assert" && step.purpose === "expectation");
  if (expectations.length === 0) {
    issue(
      "NO_EXPECTATION",
      options.mode === "verification" ? "error" : "warning",
      msg("valNoExpectation"),
    );
  }
  if (options.mode === "verification") {
    for (const { index } of expectations) {
      const before = steps.filter((s) => s.index < index);
      if (!before.some(({ step }) => step.type === "assert" && step.purpose === "anchor")) {
        issue(
          "EXPECTATION_WITHOUT_ANCHOR",
          "anchoring",
          msg("valNoAnchor"),
          index,
        );
      }
      if (!before.some(({ step }) => STATE_CHANGING.has(step.type))) {
        issue(
          "EXPECTATION_WITHOUT_ACTION",
          "anchoring",
          msg("valNoAction"),
          index,
        );
      }
    }
    const lastExpectation = expectations.at(-1)?.index ?? 0;
    for (const { step, index } of steps) {
      if (step.type === "assert" && step.purpose === "anchor" && index > lastExpectation && lastExpectation > 0) {
        issue("ANCHOR_AFTER_LAST_EXPECTATION", "warning", msg("valAnchorAfter"), index);
      }
    }
  }

  // Reference: targets used before any state change must exist on the observed page.
  let reference: PlanValidation["reference"] = null;
  if (options.reference !== undefined && options.reference.length > 0) {
    const baseUrl = options.baseUrl ?? plan.target.baseUrl;
    const pages = new Map(options.reference.map((page) => [page.url, flatten(page.accessibility)]));
    let current: AccessibilityNode[] | undefined;
    let checked = 0;
    let unchecked = 0;
    for (const { step, index } of steps) {
      if (step.type === "navigate") {
        current = pages.get(resolveNavigationUrl(step.url, baseUrl));
        continue;
      }
      const check = targetToCheck(step);
      if (check !== undefined) {
        const found = current === undefined ? undefined : matchesTarget(check.target, current);
        if (found === undefined) {
          unchecked++;
        } else {
          checked++;
          if (!found) {
            issue(
              "TARGET_NOT_IN_REFERENCE",
              check.required ? "error" : "warning",
              msg("valTargetMissing", { target: describeTarget(check.target) }),
              index,
            );
          }
        }
      }
      // After a state change the reference no longer describes the page.
      if (STATE_CHANGING.has(step.type)) current = undefined;
    }
    reference = { pages: [...pages.keys()], targetsChecked: checked, targetsUnchecked: unchecked };

    // Calibration: timeouts must leave room for the latency actually observed.
    for (const page of options.reference) {
      if (page.latency === undefined) continue;
      const needed = Math.ceil(page.latency.slowestResponseMs * 2);
      for (const { step, index } of steps) {
        if (step.type !== "assert") continue;
        const timeout = step.timeoutMs ?? timeouts.assertionMs;
        if (timeout < needed) {
          issue(
            "TIMEOUT_BELOW_OBSERVED_LATENCY",
            "warning",
            msg("valAssertionTimeout", { timeout, slowest: Math.round(page.latency.slowestResponseMs) }),
            index,
          );
        }
      }
      if (timeouts.navigationMs < page.latency.navigationMs * 2) {
        issue(
          "TIMEOUT_BELOW_OBSERVED_LATENCY",
          "warning",
          msg("valNavigationTimeout", { timeout: timeouts.navigationMs, load: Math.round(page.latency.navigationMs) }),
        );
      }
    }
  }

  const has = (severity: IssueSeverity): boolean => issues.some((i) => i.severity === severity);
  const status: PlanValidationStatus = has("unsupported")
    ? "unsupported"
    : has("error")
      ? "invalid"
      : has("anchoring")
        ? "weakly_anchored"
        : "valid";

  return PlanValidation.parse({
    schemaVersion: "exegezis.plan-validation/v1",
    planId: plan.id,
    mode: options.mode,
    status,
    issues,
    timeouts,
    reference,
  });
}

/**
 * Which target a step depends on, and whether its absence makes the plan
 * invalid (`required`) or only suspicious. Hidden elements are not in the
 * accessibility tree, so only targets that must be visible are required.
 */
function targetToCheck(step: PlanStep): { target: ElementTarget; required: boolean } | undefined {
  switch (step.type) {
    case "click":
    case "fill":
      return { target: step.target, required: true };
    case "press":
      return step.target === undefined ? undefined : { target: step.target, required: true };
    case "wait":
      return step.condition.kind === "element" && step.condition.state === "visible"
        ? { target: step.condition.target, required: true }
        : undefined;
    case "assert": {
      const a = step.assertion;
      if (a.kind === "visibility") return a.expected === "visible" ? { target: a.target, required: true } : undefined;
      if (a.kind === "existence") return a.expected === "present" ? { target: a.target, required: false } : undefined;
      if (a.kind === "text" || a.kind === "attribute") return { target: a.target, required: false };
      if (a.kind === "count") return a.expected > 0 ? { target: a.target, required: false } : undefined;
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Whether a target matches any node, following Playwright's default matching
 * (case-insensitive substring, whitespace-normalized; exact when requested).
 * `undefined` when the target cannot be checked against an accessibility tree.
 */
export function matchesTarget(target: ElementTarget, tree: readonly AccessibilityNode[]): boolean | undefined {
  const nodes = flatten(tree);
  const matches = (value: unknown, expected: string, exact = false): boolean => {
    if (typeof value !== "string") return false;
    const a = normalizeText(value);
    const b = normalizeText(expected);
    return exact ? a === b : a.toLowerCase().includes(b.toLowerCase());
  };
  if ("role" in target) {
    return nodes.some((n) => n.role === target.role && (target.name === undefined || matches(n.name, target.name, target.exact)));
  }
  if ("label" in target) return nodes.some((n) => LABELLED_ROLES.has(n.role) && matches(n.name, target.label, target.exact));
  if ("text" in target) return nodes.some((n) => matches(n.text, target.text, target.exact) || matches(n.name, target.text, target.exact));
  if ("placeholder" in target) return nodes.some((n) => matches(n["placeholder"], target.placeholder, target.exact));
  return undefined;
}

function flatten(nodes: readonly AccessibilityNode[]): AccessibilityNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/** Human summary of a validation, one line per issue. */
export function describeValidation(validation: Pick<PlanValidation, "issues">): string[] {
  return validation.issues.map(
    (i) => `${i.severity.toUpperCase().padEnd(11)} ${i.code}${i.stepIndex === undefined ? "" : ` (step ${i.stepIndex})`}: ${i.message}`,
  );
}

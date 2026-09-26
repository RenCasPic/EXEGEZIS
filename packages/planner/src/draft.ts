import { StringOperator, TestPlan, type ElementTarget, type PlanStep, type Provenance } from "@exegezis/core";
import { z } from "zod";

/*
 * What the model is allowed to write: the plan-authoring part of the TestPlan
 * contract, in a wire format the provider's structured-output grammar accepts.
 *
 * Measured limits (see docs/04-ai-planner.md): an array of discriminated
 * unions, many nullable fields, or many optional fields each make the API
 * reject the schema ("compiled grammar is too large", "too many parameters
 * with union types", "schema is too complex"). So steps and assertions are
 * flat objects with a few optional fields, and `value` / `expected` carry the
 * type-specific argument as a string. Some fields are not the model's to
 * decide at all (id, target, provenance, timeouts).
 *
 * `assemblePlan` translates this into a TestPlan and validates it with the
 * canonical `TestPlan` schema. There is one plan model; this is how a model
 * writes it.
 */

/** A target: `by` says which strategy `value` is for; `name` only with by=role. */
export const DraftTarget = z.strictObject({
  by: z.enum(["role", "label", "text", "placeholder", "testId", "css"]),
  value: z.string(),
  name: z.string().optional(),
});
export type DraftTarget = z.infer<typeof DraftTarget>;

/**
 * `expected` by kind: text/attribute/url → the string (with `operator`);
 * visibility → "visible" | "hidden"; existence → "present" | "absent";
 * count → an integer; http → "status=<code>" or "<json-pointer>=<json value>"
 * (e.g. "/itemCount=0"); visual → the baseline name.
 */
export const DraftAssertion = z.strictObject({
  kind: z.enum(["text", "visibility", "existence", "attribute", "url", "count", "http", "visual"]),
  target: DraftTarget.optional(),
  operator: StringOperator.optional(),
  expected: z.string(),
  /** Attribute name (kind=attribute). */
  attribute: z.string().optional(),
  /** Request of an http assertion. */
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  path: z.string().optional(),
});
export type DraftAssertion = z.infer<typeof DraftAssertion>;

/**
 * `value` by type: navigate → path ("/"); fill → text; press → key;
 * wait → an element state ("visible", "hidden"...) with a target, or a number
 * of milliseconds without one.
 */
export const DraftStep = z.strictObject({
  type: z.enum(["navigate", "click", "fill", "press", "wait", "assert"]),
  target: DraftTarget.optional(),
  value: z.string().optional(),
  id: z.string().optional(),
  purpose: z.enum(["anchor", "expectation"]).optional(),
  description: z.string().optional(),
  assertion: DraftAssertion.optional(),
});
export type DraftStep = z.infer<typeof DraftStep>;

export const PlanDraft = z.strictObject({
  title: z.string(),
  description: z.string(),
  preconditions: z.array(z.string()),
  steps: z.array(DraftStep),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

/**
 * The model's whole answer: a plan, or an explicit statement that the symptom
 * does not contain enough information to write one. Never a verdict: there is
 * deliberately no field for "bug", "verified", "confidence", "root cause" or "fix".
 */
export const PlannerOutput = z.strictObject({
  plan: PlanDraft.optional(),
  /** Why no plan could be written (e.g. the symptom is too ambiguous). */
  cannotPlanReason: z.string().optional(),
});
export type PlannerOutput = z.infer<typeof PlannerOutput>;

export interface AssembleOptions {
  planId: string;
  baseUrl: string;
  provenance: Provenance;
  symptom: string;
}

/**
 * Translates a draft into a candidate TestPlan and validates it with the
 * canonical schema (regexes, refinements, defaults...). The translation is
 * mechanical and unvalidated; the canonical parse is the contract.
 */
export function assemblePlan(draft: PlanDraft, options: AssembleOptions) {
  return TestPlan.safeParse({
    schemaVersion: "exegezis.test-plan/v1",
    id: options.planId,
    title: draft.title,
    description: draft.description,
    target: { kind: "web", baseUrl: options.baseUrl },
    preconditions: draft.preconditions,
    provenance: options.provenance,
    steps: draft.steps.map(fromDraftStep),
    metadata: { generatedFrom: "symptom", symptom: options.symptom.slice(0, 500) },
  });
}

function fromTarget(target: DraftTarget | undefined): unknown {
  if (target === undefined) return undefined;
  switch (target.by) {
    case "role":
      return { role: target.value, ...(target.name === undefined ? {} : { name: target.name }) };
    case "testId":
      return { testId: target.value };
    case "css":
      return { css: target.value };
    default:
      return { [target.by]: target.value };
  }
}

const withTarget = (target: DraftTarget | undefined): Record<string, unknown> =>
  target === undefined ? {} : { target: fromTarget(target) };

function fromDraftStep(step: DraftStep): unknown {
  switch (step.type) {
    case "navigate":
      return { type: "navigate", url: step.value };
    case "click":
      return { type: "click", ...withTarget(step.target) };
    case "fill":
      return { type: "fill", ...withTarget(step.target), value: step.value };
    case "press":
      return { type: "press", key: step.value, ...withTarget(step.target) };
    case "wait":
      return {
        type: "wait",
        condition:
          step.target === undefined
            ? { kind: "timeout", ms: Number(step.value) }
            : { kind: "element", target: fromTarget(step.target), state: step.value ?? "visible" },
      };
    case "assert":
      return {
        type: "assert",
        ...(step.id === undefined ? {} : { id: step.id }),
        ...(step.purpose === undefined ? {} : { purpose: step.purpose }),
        ...(step.description === undefined ? {} : { description: step.description }),
        assertion: step.assertion === undefined ? undefined : fromAssertion(step.assertion),
      };
  }
}

function fromAssertion(a: DraftAssertion): unknown {
  switch (a.kind) {
    case "text":
    case "url":
      return { kind: a.kind, ...withTarget(a.target), ...(a.operator === undefined ? {} : { operator: a.operator }), expected: a.expected };
    case "attribute":
      return { kind: "attribute", ...withTarget(a.target), name: a.attribute, ...(a.operator === undefined ? {} : { operator: a.operator }), expected: a.expected };
    case "visibility":
    case "existence":
      return { kind: a.kind, ...withTarget(a.target), expected: a.expected };
    case "count":
      return { kind: "count", ...withTarget(a.target), expected: /^\d+$/.test(a.expected) ? Number(a.expected) : a.expected };
    case "visual":
      return { kind: "visual", ...withTarget(a.target), baseline: a.expected };
    case "http":
      return { kind: "http", request: { ...(a.method === undefined ? {} : { method: a.method }), path: a.path }, expected: parseHttpExpected(a.expected) };
  }
}

/** "status=200" → {status: 200}; "/itemCount=0" → {body: {pointer, equals}}. Anything else is left for the schema to reject. */
function parseHttpExpected(expected: string): unknown {
  const status = /^status=(\d{3})$/.exec(expected.trim());
  if (status !== null) return { status: Number(status[1]) };
  const body = /^(\/[^=]*)=(.*)$/s.exec(expected.trim());
  if (body !== null) {
    let equals: unknown;
    try {
      equals = JSON.parse(body[2] ?? "");
    } catch {
      equals = body[2];
    }
    return { body: { pointer: body[1], equals } };
  }
  return { invalid: expected };
}

/** The draft form of an existing plan step (examples shown to the model). */
export function toDraftStep(step: PlanStep): DraftStep | undefined {
  const target = (t: ElementTarget): DraftTarget => {
    if ("role" in t) return t.name === undefined ? { by: "role", value: t.role } : { by: "role", value: t.role, name: t.name };
    if ("testId" in t) return { by: "testId", value: t.testId };
    if ("css" in t) return { by: "css", value: t.css };
    if ("label" in t) return { by: "label", value: t.label };
    if ("text" in t) return { by: "text", value: t.text };
    return { by: "placeholder", value: t.placeholder };
  };
  switch (step.type) {
    case "navigate":
      return { type: "navigate", value: step.url };
    case "click":
      return { type: "click", target: target(step.target) };
    case "fill":
      return { type: "fill", target: target(step.target), value: step.value };
    case "press":
      return { type: "press", value: step.key, ...(step.target === undefined ? {} : { target: target(step.target) }) };
    case "wait":
      if (step.condition.kind === "loadState") return undefined;
      return step.condition.kind === "timeout"
        ? { type: "wait", value: String(step.condition.ms) }
        : { type: "wait", target: target(step.condition.target), value: step.condition.state };
    case "assert": {
      const a = step.assertion;
      let assertion: DraftAssertion;
      switch (a.kind) {
        case "http":
          assertion = {
            kind: "http",
            ...(a.request.method === undefined ? {} : { method: a.request.method }),
            path: a.request.path,
            expected:
              a.expected.body !== undefined
                ? `${a.expected.body.pointer}=${JSON.stringify(a.expected.body.equals)}`
                : `status=${a.expected.status ?? 200}`,
          };
          break;
        case "count":
          assertion = { kind: "count", target: target(a.target), expected: String(a.expected) };
          break;
        case "visual":
          assertion = { kind: "visual", expected: a.baseline, ...(a.target === undefined ? {} : { target: target(a.target) }) };
          break;
        case "url":
          assertion = { kind: "url", operator: a.operator, expected: a.expected };
          break;
        case "attribute":
          assertion = { kind: "attribute", target: target(a.target), attribute: a.name, operator: a.operator, expected: a.expected };
          break;
        case "text":
          assertion = { kind: "text", target: target(a.target), operator: a.operator, expected: a.expected };
          break;
        case "visibility":
        case "existence":
          assertion = { kind: a.kind, target: target(a.target), expected: a.expected };
          break;
        case "console":
        case "page_error":
        case "request":
        case "link":
        case "a11y":
          // Page-health assertions (web inspection) are not part of the planner's wire format.
          return undefined;
      }
      return {
        type: "assert",
        ...(step.id === undefined ? {} : { id: step.id }),
        purpose: step.purpose,
        ...(step.description === undefined ? {} : { description: step.description }),
        assertion,
      };
    }
    default:
      return undefined;
  }
}

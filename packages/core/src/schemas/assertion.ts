import { z } from "zod";
import { ElementTarget, describeTarget } from "./target.js";
import { Timestamp } from "./common.js";

/**
 * Assertions are data: they declare an expectation, never how to check it.
 * Evaluation belongs to adapters (deterministic code), compilation to
 * compilers. A model may one day write this JSON; it never decides whether
 * an assertion passed.
 *
 * Adding a kind: add its schema to `Assertion`, then TypeScript requires an
 * evaluator in each adapter that declares it and an emitter in each compiler.
 */

export const StringOperator = z.enum(["equals", "contains", "matches"]);
export type StringOperator = z.infer<typeof StringOperator>;

const RegexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid regular expression" },
);

/** `expected` is a regex source when the operator is `matches`. */
function withValidPattern<T extends { operator: StringOperator; expected: string }>(value: T): boolean {
  return value.operator !== "matches" || RegexSource.safeParse(value.expected).success;
}

export const TextAssertion = z
  .strictObject({
    kind: z.literal("text"),
    target: ElementTarget,
    operator: StringOperator.default("equals"),
    /** Compared against the element's text content, whitespace-normalized. */
    expected: z.string(),
  })
  .refine(withValidPattern, { message: "expected must be a valid regular expression", path: ["expected"] });

export const VisibilityAssertion = z.strictObject({
  kind: z.literal("visibility"),
  target: ElementTarget,
  expected: z.enum(["visible", "hidden"]),
});

export const ExistenceAssertion = z.strictObject({
  kind: z.literal("existence"),
  target: ElementTarget,
  expected: z.enum(["present", "absent"]),
});

export const AttributeAssertion = z
  .strictObject({
    kind: z.literal("attribute"),
    target: ElementTarget,
    name: z.string().min(1),
    operator: StringOperator.default("equals"),
    expected: z.string(),
  })
  .refine(withValidPattern, { message: "expected must be a valid regular expression", path: ["expected"] });

export const UrlAssertion = z
  .strictObject({
    kind: z.literal("url"),
    operator: StringOperator.default("equals"),
    /** Absolute URL, or a path resolved against the target base URL for `equals`. */
    expected: z.string().min(1),
  })
  .refine(withValidPattern, { message: "expected must be a valid regular expression", path: ["expected"] });

export const CountAssertion = z.strictObject({
  kind: z.literal("count"),
  target: ElementTarget,
  expected: z.int().nonnegative(),
});

/** RFC 6901 JSON Pointer ("" is the whole document). */
export const JsonPointer = z.string().regex(/^(\/([^~/]|~[01])*)*$/, "must be a JSON Pointer (RFC 6901)");

export const HttpAssertion = z
  .strictObject({
    kind: z.literal("http"),
    /** Matches the most recent response to this request observed so far. */
    request: z.strictObject({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
      /** URL pathname, e.g. `/api/cart/coupon` (query string ignored). */
      path: z.string().regex(/^\//, "must start with /"),
    }),
    expected: z.strictObject({
      status: z.int().min(100).max(599).optional(),
      body: z.strictObject({ pointer: JsonPointer, equals: z.json() }).optional(),
    }),
  })
  .refine((a) => a.expected.status !== undefined || a.expected.body !== undefined, {
    message: "expected must define status and/or body",
    path: ["expected"],
  });

/**
 * Visual comparison against a named baseline image. Part of the model because
 * plans may need to express it, but no adapter or compiler implements it yet:
 * a plan using it is UNSUPPORTED, never silently skipped.
 */
export const VisualAssertion = z.strictObject({
  kind: z.literal("visual"),
  target: ElementTarget.optional(),
  baseline: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  maxDiffPixelRatio: z.number().min(0).max(1).optional(),
});

/*
 * Page-health assertions (used by web inspection). Each states the CORRECT
 * behaviour, like every other assertion: it fails while the defect exists.
 * They observe what the page did during the run, not a target element.
 */

/** No console message of `level` whose text contains `contains` was logged during the run. */
export const ConsoleAssertion = z.strictObject({
  kind: z.literal("console"),
  level: z.enum(["error", "warning"]),
  contains: z.string().min(1),
  expected: z.literal("absent"),
});

/** No uncaught page error (JS exception) whose message contains `contains` was raised during the run. */
export const PageErrorAssertion = z.strictObject({
  kind: z.literal("page_error"),
  contains: z.string().min(1),
  expected: z.literal("absent"),
});

/**
 * Every request the page made to `url` (absolute, or a path matched against
 * pathname + search) got a response below 400 and none failed.
 */
export const RequestAssertion = z.strictObject({
  kind: z.literal("request"),
  request: z.strictObject({
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).optional(),
    url: z.string().min(1),
  }),
  expected: z.literal("ok"),
});

/** A GET of `url` (absolute, or relative to the current page) answers below 400. */
export const LinkAssertion = z.strictObject({
  kind: z.literal("link"),
  url: z.string().min(1),
  expected: z.literal("ok"),
});

/**
 * The axe-core rule `rule` reports no violation on the node `selector` (axe's
 * own target selector). Compared by rule + node, never by a total count.
 */
export const A11yAssertion = z.strictObject({
  kind: z.literal("a11y"),
  rule: z.string().regex(/^[a-z0-9-]+$/, "an axe-core rule id"),
  selector: z.string().min(1),
  expected: z.literal("no_violation"),
});

export const Assertion = z.discriminatedUnion("kind", [
  TextAssertion,
  VisibilityAssertion,
  ExistenceAssertion,
  AttributeAssertion,
  UrlAssertion,
  CountAssertion,
  HttpAssertion,
  VisualAssertion,
  ConsoleAssertion,
  PageErrorAssertion,
  RequestAssertion,
  LinkAssertion,
  A11yAssertion,
]);
export type Assertion = z.infer<typeof Assertion>;
export type AssertionInput = z.input<typeof Assertion>;
export type AssertionKind = Assertion["kind"];
export type AssertionOf<K extends AssertionKind> = Extract<Assertion, { kind: K }>;
export const AssertionKind = z.enum([
  "text",
  "visibility",
  "existence",
  "attribute",
  "url",
  "count",
  "http",
  "visual",
  "console",
  "page_error",
  "request",
  "link",
  "a11y",
]);

/**
 * - `anchor`: establishes that the application is in the state the plan
 *   believes it is in (e.g. "the badge shows Cart (1)" after adding an item).
 *   A failing anchor means the plan's premise is wrong, not that there is a bug.
 * - `expectation`: the behavior under test. Only an expectation can fail as a bug.
 */
export const AssertionPurpose = z.enum(["anchor", "expectation"]);
export type AssertionPurpose = z.infer<typeof AssertionPurpose>;

export const AssertStep = z.strictObject({
  type: z.literal("assert"),
  /** Stable id for this expectation, used to compare failures across runs. */
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes")
    .max(64)
    .optional(),
  /** The expectation in plain language, e.g. "Cart badge shows Cart (0)". */
  description: z.string().max(300).optional(),
  /** Defaults to `expectation`: something is an anchor only if the plan says so. */
  purpose: AssertionPurpose.default("expectation"),
  assertion: Assertion,
  /** Overrides the plan's assertion timeout for this step. */
  timeoutMs: z.int().positive().max(60_000).optional(),
});
export type AssertStep = z.infer<typeof AssertStep>;

/**
 * Why an assertion could not be evaluated. An `error` is never evidence of a
 * bug: the expectation was not checked.
 */
export const AssertionErrorKind = z.enum([
  "target_ambiguous",
  "body_unavailable",
  "value_redacted",
  "unsupported",
  "evaluation_error",
]);
export type AssertionErrorKind = z.infer<typeof AssertionErrorKind>;

/**
 * Why the timeout elapsed without a conclusion:
 * - `subject_absent`: the element or response never appeared. Absence is
 *   never positive evidence: the app may be slow, the target may be wrong, or
 *   there may be a bug — they cannot be told apart.
 * - `value_unsettled`: the subject was observed but its value was still
 *   changing when the timeout elapsed.
 */
export const AssertionTimeoutReason = z.enum(["subject_absent", "value_unsettled"]);
export type AssertionTimeoutReason = z.infer<typeof AssertionTimeoutReason>;

/**
 * What an adapter reports for one assertion.
 * - `passed`: the expectation holds.
 * - `failed`: the subject was observed, its value was stable, and it
 *   contradicts the expectation. This proves expected != actual — no more.
 * - `timeout`: no conclusion within the timeout (see `timeoutReason`).
 * - `error`: the expectation could not be checked (see `errorKind`).
 */
export const AssertionStatus = z.enum(["passed", "failed", "timeout", "error"]);
export type AssertionStatus = z.infer<typeof AssertionStatus>;

export const AssertionEvaluation = z.strictObject({
  status: AssertionStatus,
  expected: z.json(),
  actual: z.json(),
  message: z.string(),
  errorKind: AssertionErrorKind.optional(),
  timeoutReason: AssertionTimeoutReason.optional(),
  /** Elements (or responses) matched by the target at the last attempt. */
  matches: z.int().nonnegative().optional(),
  /** Number of evaluations performed before settling (retry-until-timeout). */
  attempts: z.int().positive(),
});
export type AssertionEvaluation = z.infer<typeof AssertionEvaluation>;

/** Pointers from a failed assertion to the evidence that shows the failure. */
export const EvidenceLinks = z.strictObject({
  /** Last action executed before the assertion (what led to this state). */
  actionEventId: z.string().optional(),
  assertionEventId: z.string(),
  observationId: z.string().optional(),
  screenshot: z.strictObject({ id: z.string(), path: z.string() }).optional(),
  accessibilitySnapshotId: z.string().optional(),
  domSnapshot: z.strictObject({ id: z.string(), path: z.string() }).optional(),
  /** Evidence ids recorded between the last action and the assertion result. */
  network: z.array(z.string()),
  console: z.array(z.string()),
  pageErrors: z.array(z.string()),
  window: z.strictObject({ fromEventId: z.string(), toEventId: z.string() }),
});
export type EvidenceLinks = z.infer<typeof EvidenceLinks>;

export const AssertionResult = z.strictObject({
  id: z.string(),
  stepIndex: z.int().positive(),
  stepId: z.string().optional(),
  kind: AssertionKind,
  purpose: AssertionPurpose,
  /** Human form of the expectation (from the plan, or derived). */
  description: z.string(),
  assertion: Assertion,
  ...AssertionEvaluation.shape,
  startedAt: Timestamp,
  finishedAt: Timestamp,
  durationMs: z.number().nonnegative(),
  timeoutMs: z.int().positive(),
  evidence: EvidenceLinks.optional(),
});
export type AssertionResult = z.infer<typeof AssertionResult>;

export const AssertionsFile = z.strictObject({
  schemaVersion: z.literal("exegezis.assertions/v1"),
  results: z.array(AssertionResult),
});
export type AssertionsFile = z.infer<typeof AssertionsFile>;

/** One-line, human-readable form of an assertion. */
export function describeAssertion(assertion: Assertion): string {
  const op = (operator: StringOperator): string =>
    operator === "equals" ? "equals" : operator === "contains" ? "contains" : "matches";
  switch (assertion.kind) {
    case "text":
      return `text of ${describeTarget(assertion.target)} ${op(assertion.operator)} ${JSON.stringify(assertion.expected)}`;
    case "visibility":
      return `${describeTarget(assertion.target)} is ${assertion.expected}`;
    case "existence":
      return `${describeTarget(assertion.target)} is ${assertion.expected}`;
    case "attribute":
      return `attribute ${assertion.name} of ${describeTarget(assertion.target)} ${op(assertion.operator)} ${JSON.stringify(assertion.expected)}`;
    case "url":
      return `page URL ${op(assertion.operator)} ${JSON.stringify(assertion.expected)}`;
    case "count":
      return `count of ${describeTarget(assertion.target)} equals ${assertion.expected}`;
    case "visual":
      return `${assertion.target === undefined ? "page" : describeTarget(assertion.target)} matches visual baseline "${assertion.baseline}"`;
    case "console":
      return `no console ${assertion.level} containing ${JSON.stringify(assertion.contains)}`;
    case "page_error":
      return `no page error containing ${JSON.stringify(assertion.contains)}`;
    case "request":
      return `requests to ${assertion.request.method ?? "ANY"} ${assertion.request.url} succeed (status < 400)`;
    case "link":
      return `GET ${assertion.url} answers status < 400`;
    case "a11y":
      return `axe rule ${assertion.rule} reports no violation on ${JSON.stringify(assertion.selector)}`;
    case "http": {
      const request = `${assertion.request.method ?? "ANY"} ${assertion.request.path}`;
      const parts: string[] = [];
      if (assertion.expected.status !== undefined) parts.push(`status ${assertion.expected.status}`);
      if (assertion.expected.body !== undefined) {
        parts.push(`body${assertion.expected.body.pointer} equals ${JSON.stringify(assertion.expected.body.equals)}`);
      }
      return `response to ${request} has ${parts.join(" and ")}`;
    }
  }
}

/** Resolves an RFC 6901 pointer; `undefined` when the path does not exist. */
export function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  let current: unknown = document;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (current !== null && typeof current === "object") {
      if (!Object.hasOwn(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Whitespace normalization matching Playwright's text assertions. */
export function normalizeText(text: string): string {
  return text.replace(/[\u200b\u00ad]/g, "").replace(/\s+/g, " ").trim();
}

export function matchesString(actual: string, operator: StringOperator, expected: string): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "contains":
      return actual.includes(expected);
    case "matches":
      return new RegExp(expected).test(actual);
  }
}

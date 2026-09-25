import {
  canonicalJson,
  describeAssertion,
  describeTarget,
  matchesString,
  normalizeText,
  REDACTED,
  resolveJsonPointer,
  toErrorInfo,
  type Assertion,
  type AssertionErrorKind,
  type AssertionEvaluation,
  type AssertionKind,
  type AssertionOf,
  type NetworkExchangeEvidence,
} from "@exegezis/core";
import type { Page } from "playwright";
import { toLocator } from "./locator.js";

type Json = AssertionEvaluation["expected"];

/**
 * One evaluation attempt:
 * - `pass`: the expectation holds.
 * - `contradicts`: the subject was observed and contradicts the expectation.
 * - `absent`: the subject (element, response) was not there. Absence is never
 *   positive evidence of a bug: it may be slowness or a wrong target.
 * - `error`: the subject cannot be evaluated (ambiguous, unreadable...).
 */
interface Sample {
  outcome: "pass" | "contradicts" | "absent" | "error";
  expected: Json;
  actual: Json;
  message: string;
  errorKind?: AssertionErrorKind;
  matches?: number;
}

export interface AssertionContext {
  page: Page;
  baseUrl: string;
  /** Most recent exchange with a response for method + pathname, after pending captures settle. */
  lastResponse(method: string | undefined, path: string): Promise<NetworkExchangeEvidence | undefined>;
}

type Evaluator<K extends AssertionKind> = (context: AssertionContext, assertion: AssertionOf<K>) => Promise<Sample>;

/** Delay between evaluations while retrying. */
const RETRY_INTERVAL_MS = 100;
/** Upper bound for a single DOM read, so one attempt never consumes the whole timeout. */
const READ_TIMEOUT_MS = 1_000;

/**
 * One entry per assertion kind; `null` means "not supported by this adapter".
 * The mapped type forces an explicit decision for every kind in the model:
 * a new kind does not compile until it is implemented or declared unsupported.
 */
const EVALUATORS: { [K in AssertionKind]: Evaluator<K> | null } = {
  async text({ page }, assertion) {
    const resolved = await resolveSingle(page, assertion);
    if ("sample" in resolved) return resolved.sample;
    const actual = normalizeText((await resolved.locator.textContent({ timeout: READ_TIMEOUT_MS })) ?? "");
    const expected = assertion.operator === "matches" ? assertion.expected : normalizeText(assertion.expected);
    return {
      outcome: matchesString(actual, assertion.operator, expected) ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: 1,
      message: `text of ${describeTarget(assertion.target)} was ${JSON.stringify(actual)}; expected it to ${verb(assertion.operator)} ${JSON.stringify(assertion.expected)}`,
    };
  },

  async visibility({ page }, assertion) {
    const locator = toLocator(page, assertion.target);
    const count = await locator.count();
    const subject = describeTarget(assertion.target);
    if (count > 1) return ambiguous(assertion.target, assertion.expected, count);
    if (count === 0) {
      return assertion.expected === "hidden"
        ? { outcome: "pass", expected: "hidden", actual: "absent", matches: 0, message: `${subject} is absent` }
        : absent(assertion.expected, `${subject} never appeared`);
    }
    const actual = (await locator.isVisible()) ? "visible" : "hidden";
    return {
      outcome: actual === assertion.expected ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: 1,
      message: `${subject} was ${actual}; expected ${assertion.expected}`,
    };
  },

  async existence({ page }, assertion) {
    const count = await toLocator(page, assertion.target).count();
    const subject = describeTarget(assertion.target);
    if (count === 0) {
      return assertion.expected === "absent"
        ? { outcome: "pass", expected: "absent", actual: "absent", matches: 0, message: `${subject} is absent` }
        : absent(assertion.expected, `${subject} never appeared`);
    }
    return {
      outcome: assertion.expected === "present" ? "pass" : "contradicts",
      expected: assertion.expected,
      actual: "present",
      matches: count,
      message: `${subject} was present (${count} match${count === 1 ? "" : "es"}); expected ${assertion.expected}`,
    };
  },

  async attribute({ page }, assertion) {
    const resolved = await resolveSingle(page, assertion);
    if ("sample" in resolved) return resolved.sample;
    const actual = await resolved.locator.getAttribute(assertion.name, { timeout: READ_TIMEOUT_MS });
    return {
      outcome: actual !== null && matchesString(actual, assertion.operator, assertion.expected) ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: 1,
      message: `attribute ${assertion.name} of ${describeTarget(assertion.target)} was ${JSON.stringify(actual)}; expected it to ${verb(assertion.operator)} ${JSON.stringify(assertion.expected)}`,
    };
  },

  url({ page, baseUrl }, assertion) {
    const actual = page.url();
    const expected = assertion.operator === "equals" ? new URL(assertion.expected, baseUrl).toString() : assertion.expected;
    return Promise.resolve({
      outcome: matchesString(actual, assertion.operator, expected) ? "pass" : "contradicts",
      expected,
      actual,
      message: `page URL was ${JSON.stringify(actual)}; expected it to ${verb(assertion.operator)} ${JSON.stringify(expected)}`,
    });
  },

  async count({ page }, assertion) {
    const actual = await toLocator(page, assertion.target).count();
    const subject = describeTarget(assertion.target);
    if (actual === 0 && assertion.expected > 0) return absent(assertion.expected, `${subject} matched no element`);
    return {
      outcome: actual === assertion.expected ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: actual,
      message: `${subject} matched ${actual} element(s); expected ${assertion.expected}`,
    };
  },

  async http(context, assertion) {
    const { request, expected } = assertion;
    const label = `${request.method ?? "ANY"} ${request.path}`;
    const expectedJson: Json = {
      ...(expected.status === undefined ? {} : { status: expected.status }),
      ...(expected.body === undefined ? {} : { body: { pointer: expected.body.pointer, equals: expected.body.equals } }),
    };
    const exchange = await context.lastResponse(request.method, request.path);
    const response = exchange?.response;
    if (exchange === undefined || response === undefined) return absent(expectedJson, `no response to ${label} was observed`);

    const actual: { status: number; body?: { pointer: string; value: Json } } = { status: response.status };
    let pass = expected.status === undefined || response.status === expected.status;
    const problems: string[] = [];
    if (!pass) problems.push(`status was ${response.status}, expected ${expected.status}`);

    if (expected.body !== undefined) {
      const body = response.body;
      if (body === undefined || !body.captured) {
        return error("body_unavailable", expectedJson, `the body of the response to ${label} was not captured`, 1);
      }
      let document: unknown;
      try {
        document = JSON.parse(body.text);
      } catch {
        return error("body_unavailable", expectedJson, `the body of the response to ${label} is not JSON`, 1);
      }
      const value = resolveJsonPointer(document, expected.body.pointer);
      if (value === REDACTED) {
        return error("value_redacted", expectedJson, `body${expected.body.pointer} is redacted evidence and cannot be compared`, 1);
      }
      actual.body = { pointer: expected.body.pointer, value: (value === undefined ? null : value) as Json };
      const bodyPass = value !== undefined && canonicalJson(value) === canonicalJson(expected.body.equals);
      if (!bodyPass) {
        problems.push(
          value === undefined
            ? `body${expected.body.pointer} does not exist`
            : `body${expected.body.pointer} was ${JSON.stringify(value)}, expected ${JSON.stringify(expected.body.equals)}`,
        );
      }
      pass = pass && bodyPass;
    }

    return {
      outcome: pass ? "pass" : "contradicts",
      expected: expectedJson,
      actual,
      matches: 1,
      message: pass ? `response to ${label} met the expectation` : `response to ${label}: ${problems.join("; ")}`,
    };
  },

  visual: null,
};

/** Assertion kinds this adapter evaluates (the non-null registry entries). */
export const SUPPORTED_ASSERTIONS = (Object.keys(EVALUATORS) as AssertionKind[]).filter((kind) => EVALUATORS[kind] !== null);

export interface EvaluateOptions {
  timeoutMs: number;
  /** A failure requires the observed value to be unchanged for this long. */
  stabilityMs: number;
}

/**
 * Evaluates an assertion, retrying until it holds or the timeout elapses,
 * like Playwright's `expect`. What the last attempts saw decides the status:
 * - held at any attempt → `passed`
 * - subject observed and contradicting, with a value stable for
 *   `stabilityMs` → `failed`
 * - subject observed but its value still changing → `timeout` (value_unsettled)
 * - subject never observed → `timeout` (subject_absent)
 * - subject could not be evaluated → `error`
 */
export async function evaluateAssertion(
  context: AssertionContext,
  assertion: Assertion,
  options: EvaluateOptions,
): Promise<AssertionEvaluation> {
  const evaluator = EVALUATORS[assertion.kind] as ((context: AssertionContext, assertion: Assertion) => Promise<Sample>) | null;
  if (evaluator === null) {
    return {
      status: "error",
      errorKind: "unsupported",
      expected: null,
      actual: null,
      message: `"${assertion.kind}" assertions are not supported by the browser adapter`,
      attempts: 1,
    };
  }

  const deadline = performance.now() + options.timeoutMs;
  let attempts = 0;
  let last: Sample;
  let lastKey = "";
  let stableSince = performance.now();
  let lastAt: number;
  for (;;) {
    attempts++;
    try {
      last = await evaluator(context, assertion);
    } catch (thrown) {
      last = error("evaluation_error", null, `${describeAssertion(assertion)}: ${toErrorInfo(thrown).message}`);
    }
    lastAt = performance.now();
    const key = `${last.outcome}|${canonicalJson(last.actual)}`;
    if (key !== lastKey) {
      lastKey = key;
      stableSince = lastAt;
    }
    if (last.outcome === "pass") break;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_INTERVAL_MS, remaining)));
  }

  const base = {
    expected: last.expected,
    actual: last.actual,
    ...(last.matches === undefined ? {} : { matches: last.matches }),
    attempts,
  };
  switch (last.outcome) {
    case "pass":
      return { status: "passed", message: last.message, ...base };
    case "contradicts": {
      const stableFor = lastAt - stableSince;
      return stableFor >= options.stabilityMs
        ? { status: "failed", message: last.message, ...base }
        : {
            status: "timeout",
            timeoutReason: "value_unsettled",
            message: `${last.message} (value still changing at the timeout: stable for ${Math.round(stableFor)} of ${options.stabilityMs} ms)`,
            ...base,
          };
    }
    case "absent":
      return {
        status: "timeout",
        timeoutReason: "subject_absent",
        message: `${last.message} within ${options.timeoutMs} ms`,
        ...base,
      };
    case "error":
      return { status: "error", errorKind: last.errorKind ?? "evaluation_error", message: last.message, ...base };
  }
}

/**
 * Assertions about a *property* of an element need exactly one element. Zero
 * matches is absence (inconclusive); several is ambiguity (an error).
 */
async function resolveSingle(
  page: Page,
  assertion: AssertionOf<"text"> | AssertionOf<"attribute">,
): Promise<{ locator: ReturnType<typeof toLocator> } | { sample: Sample }> {
  const locator = toLocator(page, assertion.target);
  const count = await locator.count();
  if (count === 0) return { sample: absent(assertion.expected, `${describeTarget(assertion.target)} matched no element`) };
  if (count > 1) return { sample: ambiguous(assertion.target, assertion.expected, count) };
  return { locator };
}

function absent(expected: Json, message: string): Sample {
  return { outcome: "absent", expected, actual: null, message, matches: 0 };
}

function ambiguous(target: Parameters<typeof describeTarget>[0], expected: Json, count: number): Sample {
  return error("target_ambiguous", expected, `${describeTarget(target)} matched ${count} elements; a target must match exactly one`, count);
}

function error(errorKind: AssertionErrorKind, expected: Json, message: string, matches?: number): Sample {
  return { outcome: "error", errorKind, expected, actual: null, message, ...(matches === undefined ? {} : { matches }) };
}

function verb(operator: "equals" | "contains" | "matches"): string {
  return operator === "equals" ? "equal" : operator === "contains" ? "contain" : "match";
}

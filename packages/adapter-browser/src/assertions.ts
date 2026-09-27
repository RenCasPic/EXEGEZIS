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
  type ConsoleMessageEvidence,
  type NetworkExchangeEvidence,
  type PageErrorEvidence,
  englishOf,
  msg,
  type EngineCode,
  type EngineMessage,
  type MessageParam,
} from "@exegezis/core";
import { AxeBuilder } from "@axe-core/playwright";
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
  /** English (older readers). */
  message: string;
  /** The same message as a code and parameters, for every language. */
  detail: EngineMessage;
  errorKind?: AssertionErrorKind;
  matches?: number;
}

export interface AssertionContext {
  page: Page;
  baseUrl: string;
  /** Most recent exchange with a response for method + pathname, after pending captures settle. */
  lastResponse(method: string | undefined, path: string): Promise<NetworkExchangeEvidence | undefined>;
  /** Everything the page did so far, after pending captures settle (page-health assertions). */
  consoleMessages(): Promise<readonly ConsoleMessageEvidence[]>;
  pageErrors(): Promise<readonly PageErrorEvidence[]>;
  exchanges(): Promise<readonly NetworkExchangeEvidence[]>;
}

/** axe's node target as one selector string (iframe / shadow parts joined with " >>> "). */
export function axeSelector(target: readonly (string | readonly string[])[]): string {
  return target.map((t) => (typeof t === "string" ? t : t.join(" >>> "))).join(" ");
}

/** Whether a request URL is the one an assertion names: absolute URL (fragment ignored), or a path matched against pathname + search. */
export function matchesRequestUrl(url: string, pattern: string): boolean {
  try {
    const u = new URL(url);
    if (pattern.startsWith("/")) return `${u.pathname}${u.search}` === pattern || u.pathname === pattern;
    const p = new URL(pattern);
    u.hash = "";
    p.hash = "";
    return u.toString() === p.toString();
  } catch {
    return url === pattern;
  }
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
      ...say("evalText", { target: describeTarget(assertion.target), actual: JSON.stringify(actual), op: assertion.operator, expected: JSON.stringify(assertion.expected) }),
    };
  },

  async visibility({ page }, assertion) {
    const locator = toLocator(page, assertion.target);
    const count = await locator.count();
    const subject = describeTarget(assertion.target);
    if (count > 1) return ambiguous(assertion.target, assertion.expected, count);
    if (count === 0) {
      return assertion.expected === "hidden"
        ? { outcome: "pass", expected: "hidden", actual: "absent", matches: 0, ...say("evalAbsent", { subject }) }
        : absent(assertion.expected, msg("evalNeverAppeared", { subject }));
    }
    const actual = (await locator.isVisible()) ? "visible" : "hidden";
    return {
      outcome: actual === assertion.expected ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: 1,
      ...say("evalState", { subject, actual, expected: assertion.expected }),
    };
  },

  async existence({ page }, assertion) {
    const count = await toLocator(page, assertion.target).count();
    const subject = describeTarget(assertion.target);
    if (count === 0) {
      return assertion.expected === "absent"
        ? { outcome: "pass", expected: "absent", actual: "absent", matches: 0, ...say("evalAbsent", { subject }) }
        : absent(assertion.expected, msg("evalNeverAppeared", { subject }));
    }
    return {
      outcome: assertion.expected === "present" ? "pass" : "contradicts",
      expected: assertion.expected,
      actual: "present",
      matches: count,
      ...say("evalPresent", { subject, count, expected: assertion.expected }),
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
      ...say("evalAttribute", { name: assertion.name, target: describeTarget(assertion.target), actual: JSON.stringify(actual), op: assertion.operator, expected: JSON.stringify(assertion.expected) }),
    };
  },

  url({ page, baseUrl }, assertion) {
    const actual = page.url();
    const expected = assertion.operator === "equals" ? new URL(assertion.expected, baseUrl).toString() : assertion.expected;
    return Promise.resolve({
      outcome: matchesString(actual, assertion.operator, expected) ? "pass" : "contradicts",
      expected,
      actual,
      ...say("evalUrl", { actual: JSON.stringify(actual), op: assertion.operator, expected: JSON.stringify(expected) }),
    });
  },

  async count({ page }, assertion) {
    const actual = await toLocator(page, assertion.target).count();
    const subject = describeTarget(assertion.target);
    if (actual === 0 && assertion.expected > 0) return absent(assertion.expected, msg("evalNoMatch", { subject }));
    return {
      outcome: actual === assertion.expected ? "pass" : "contradicts",
      expected: assertion.expected,
      actual,
      matches: actual,
      ...say("evalCount", { subject, actual, expected: assertion.expected }),
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
    if (exchange === undefined || response === undefined) return absent(expectedJson, msg("evalNoResponse", { request: label }));

    const actual: { status: number; body?: { pointer: string; value: Json } } = { status: response.status };
    let pass = expected.status === undefined || response.status === expected.status;
    const problems: EngineMessage[] = [];
    if (!pass) problems.push(msg("evalStatusWas", { actual: response.status, expected: expected.status ?? "?" }));

    if (expected.body !== undefined) {
      const body = response.body;
      if (body === undefined || !body.captured) {
        return error("body_unavailable", expectedJson, msg("evalBodyNotCaptured", { request: label }), 1);
      }
      let document: unknown;
      try {
        document = JSON.parse(body.text);
      } catch {
        return error("body_unavailable", expectedJson, msg("evalBodyNotJson", { request: label }), 1);
      }
      const value = resolveJsonPointer(document, expected.body.pointer);
      if (value === REDACTED) {
        return error("value_redacted", expectedJson, msg("evalBodyRedacted", { pointer: expected.body.pointer }), 1);
      }
      actual.body = { pointer: expected.body.pointer, value: (value === undefined ? null : value) as Json };
      const bodyPass = value !== undefined && canonicalJson(value) === canonicalJson(expected.body.equals);
      if (!bodyPass) {
        problems.push(
          value === undefined
            ? msg("evalBodyMissing", { pointer: expected.body.pointer })
            : msg("evalBodyWas", { pointer: expected.body.pointer, actual: JSON.stringify(value), expected: JSON.stringify(expected.body.equals) }),
        );
      }
      pass = pass && bodyPass;
    }

    return {
      outcome: pass ? "pass" : "contradicts",
      expected: expectedJson,
      actual,
      matches: 1,
      ...(pass ? say("evalResponseMet", { request: label }) : say("evalResponseProblems", { request: label, problems })),
    };
  },

  visual: null,

  async console(context, assertion) {
    const hits = (await context.consoleMessages()).filter((m) => m.level === assertion.level && m.text.includes(assertion.contains)).map((m) => m.text);
    return {
      outcome: hits.length === 0 ? "pass" : "contradicts",
      expected: "absent",
      actual: hits.length === 0 ? "absent" : hits.slice(0, 5),
      matches: hits.length,
      ...(hits.length === 0
        ? say("evalNoConsole", { level: assertion.level, text: JSON.stringify(assertion.contains) })
        : say("evalConsoleHits", { count: hits.length, level: assertion.level, text: JSON.stringify(assertion.contains), first: JSON.stringify(hits[0]) })),
    };
  },

  async page_error(context, assertion) {
    const hits = (await context.pageErrors()).map((e) => `${e.name}: ${e.message}`).filter((m) => m.includes(assertion.contains));
    return {
      outcome: hits.length === 0 ? "pass" : "contradicts",
      expected: "absent",
      actual: hits.length === 0 ? "absent" : hits.slice(0, 5),
      matches: hits.length,
      ...(hits.length === 0 ? say("evalNoPageError", { text: JSON.stringify(assertion.contains) }) : say("evalPageError", { first: hits[0] ?? "" })),
    };
  },

  async request(context, assertion) {
    const { method, url } = assertion.request;
    const matching = (await context.exchanges()).filter((x) => (method === undefined || x.request.method === method) && matchesRequestUrl(x.request.url, url));
    const bad = matching.filter((x) => x.failure !== undefined || (x.response !== undefined && x.response.status >= 400));
    const describe = (x: NetworkExchangeEvidence) => (x.failure !== undefined ? `failed: ${x.failure.errorText}` : `${x.response?.status ?? "no response"}`);
    const first = bad[0];
    return {
      outcome: bad.length === 0 ? "pass" : "contradicts",
      expected: "ok",
      actual: bad.length === 0 ? (matching.length === 0 ? "not requested" : "ok") : bad.slice(0, 5).map(describe),
      matches: matching.length,
      ...(first === undefined
        ? matching.length === 0
          ? say("evalNoRequest", { url })
          : say("evalRequestsOk", { count: matching.length, url })
        : first.failure !== undefined
          ? say("evalRequestFailed", { method: method ?? "ANY", url, error: first.failure.errorText })
          : say("evalRequestStatus", { method: method ?? "ANY", url, status: first.response?.status ?? "no response" })),
    };
  },

  async link({ page }, assertion) {
    const url = new URL(assertion.url, page.url()).toString();
    // An inspection's own request: GET only, never anything else.
    const response = await page.request.get(url, { failOnStatusCode: false, maxRedirects: 10, timeout: READ_TIMEOUT_MS * 10 });
    const status = response.status();
    await response.dispose();
    return {
      outcome: status < 400 ? "pass" : "contradicts",
      expected: "ok",
      actual: status,
      matches: 1,
      ...say(status < 400 ? "evalLink" : "evalLinkBad", { url, status }),
    };
  },

  async a11y({ page }, assertion) {
    const results = await new AxeBuilder({ page }).withRules([assertion.rule]).analyze();
    const hits = results.violations
      .filter((v) => v.id === assertion.rule)
      .flatMap((v) => v.nodes.map((n) => axeSelector(n.target as (string | string[])[])))
      .filter((selector) => selector === assertion.selector);
    return {
      outcome: hits.length === 0 ? "pass" : "contradicts",
      expected: "no_violation",
      actual: hits.length === 0 ? "no_violation" : "violation",
      matches: hits.length,
      ...say(hits.length === 0 ? "evalA11yOk" : "evalA11yViolated", { version: results.testEngine.version, rule: assertion.rule, selector: JSON.stringify(assertion.selector) }),
    };
  },
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
      ...say("evalUnsupported", { kind: assertion.kind }),
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
      last = error("evaluation_error", null, msg("evalError", { assertion: describeAssertion(assertion), error: toErrorInfo(thrown).message }));
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
      return { status: "passed", message: last.message, detail: last.detail, ...base };
    case "contradicts": {
      const stableFor = lastAt - stableSince;
      return stableFor >= options.stabilityMs
        ? { status: "failed", message: last.message, detail: last.detail, ...base }
        : {
            status: "timeout",
            timeoutReason: "value_unsettled",
            ...say("evalUnsettled", { base: last.detail, stable: Math.round(stableFor), needed: options.stabilityMs }),
            ...base,
          };
    }
    case "absent":
      return {
        status: "timeout",
        timeoutReason: "subject_absent",
        ...say("evalWithin", { base: last.detail, ms: options.timeoutMs }),
        ...base,
      };
    case "error":
      return { status: "error", errorKind: last.errorKind ?? "evaluation_error", message: last.message, detail: last.detail, ...base };
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
  if (count === 0) return { sample: absent(assertion.expected, msg("evalNoMatch", { subject: describeTarget(assertion.target) })) };
  if (count > 1) return { sample: ambiguous(assertion.target, assertion.expected, count) };
  return { locator };
}

/** A message in English (older readers) and as a code with parameters (every language). */
function say(code: EngineCode, params: Record<string, MessageParam>): { message: string; detail: EngineMessage } {
  const detail = msg(code, params);
  return { message: englishOf(detail), detail };
}

function absent(expected: Json, detail: EngineMessage): Sample {
  return { outcome: "absent", expected, actual: null, message: englishOf(detail), detail, matches: 0 };
}

function ambiguous(target: Parameters<typeof describeTarget>[0], expected: Json, count: number): Sample {
  return error("target_ambiguous", expected, msg("evalAmbiguous", { target: describeTarget(target), count }), count);
}

function error(errorKind: AssertionErrorKind, expected: Json, detail: EngineMessage, matches?: number): Sample {
  return { outcome: "error", errorKind, expected, actual: null, message: englishOf(detail), detail, ...(matches === undefined ? {} : { matches }) };
}

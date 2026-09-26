import {
  describeAssertion,
  resolveTimeouts,
  describeTarget,
  type ActionOf,
  type ActionType,
  type Assertion,
  type AssertionKind,
  type AssertionOf,
  type ElementTarget,
  type PlanStep,
  type TestPlan,
  type TimeoutPolicy,
} from "@exegezis/core";

/**
 * Browser settings the spec pins so it behaves like the EXEGEZIS run it was
 * compiled from. Defaults match the browser adapter's defaults. Timeouts are
 * not here: they come from the plan's timeout policy, like in the engine.
 */
export interface SpecRuntime {
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
}

export const DEFAULT_SPEC_RUNTIME: SpecRuntime = {
  viewport: { width: 1280, height: 720 },
  locale: "en-US",
  timezoneId: "UTC",
};

/** A plan step that this compiler cannot express as Playwright code. */
export class UnsupportedStepError extends Error {
  override readonly name = "UnsupportedStepError";

  constructor(readonly steps: { stepIndex: number; kind: string }[]) {
    super(`cannot compile: ${steps.map((s) => `step ${s.stepIndex} uses unsupported "${s.kind}"`).join(", ")}`);
  }
}

export interface CompileOptions {
  exegezisVersion: string;
  planHash: string;
  /** Shown in the header as the regeneration command. */
  planPath: string;
  runtime?: SpecRuntime;
}

/** Source lines (1-based, inclusive) generated for one plan step. */
export interface StepLines {
  stepIndex: number;
  startLine: number;
  endLine: number;
}

export interface CompiledSpec {
  fileName: string;
  source: string;
  steps: StepLines[];
}

/** Environment variable that overrides the plan's base URL in the spec. */
export const BASE_URL_ENV = "BASE_URL";

interface EmitContext {
  stepIndex: number;
  timeouts: TimeoutPolicy;
  /** Set when an emitter needs the observed-responses helper. */
  usesResponses: boolean;
  /** Set when an emitter needs the JSON Pointer helper. */
  usesJsonPointer: boolean;
  /** Set when an emitter needs the `baseURL` fixture. */
  usesBaseUrl: boolean;
  /** Page-health recorders (console, page errors, requests) and axe. */
  usesConsole: boolean;
  usesPageErrors: boolean;
  usesRequests: boolean;
  usesAxe: boolean;
}

type ActionEmitter<T extends ActionType> = (action: ActionOf<T>, ctx: EmitContext) => string[];
type AssertionEmitter<K extends AssertionKind> = (assertion: AssertionOf<K>, timeoutMs: number, ctx: EmitContext) => string[];

/**
 * The plan is already a validated, declarative, target-independent structure,
 * so it serves as the intermediate representation: the compiler is a set of
 * pure emitters over it. The mapped types make both registries exhaustive —
 * a new action or assertion kind does not compile until it has an emitter.
 */
const ACTION_EMITTERS: { [T in ActionType]: ActionEmitter<T> } = {
  navigate(action) {
    const options = objectLiteral({
      waitUntil: action.waitUntil === undefined ? undefined : str(action.waitUntil),
      timeout: action.timeoutMs,
    });
    return [`await page.goto(${str(action.url)}${options === "" ? "" : `, ${options}`});`];
  },
  click(action) {
    return [`await ${locator(action.target)}.click(${objectLiteral({ timeout: action.timeoutMs })});`];
  },
  fill(action, ctx) {
    const options = objectLiteral({ timeout: action.timeoutMs });
    const suffix = options === "" ? "" : `, ${options}`;
    if (action.sensitive === true || looksLikePassword(action.target)) {
      const env = `EXEGEZIS_SECRET_STEP_${ctx.stepIndex}`;
      return [
        `// Sensitive value: never stored in this file. Provide it with the ${env} environment variable.`,
        `await ${locator(action.target)}.fill(process.env[${str(env)}] ?? ""${suffix});`,
      ];
    }
    return [`await ${locator(action.target)}.fill(${str(action.value)}${suffix});`];
  },
  press(action) {
    if (action.target === undefined) return [`await page.keyboard.press(${str(action.key)});`];
    const options = objectLiteral({ timeout: action.timeoutMs });
    return [`await ${locator(action.target)}.press(${str(action.key)}${options === "" ? "" : `, ${options}`});`];
  },
  wait(action) {
    const { condition } = action;
    const timeout = action.timeoutMs;
    switch (condition.kind) {
      case "timeout":
        return [`await page.waitForTimeout(${condition.ms});`];
      case "element":
        return [`await ${locator(condition.target)}.waitFor(${objectLiteral({ state: str(condition.state), timeout })});`];
      case "loadState": {
        const options = objectLiteral({ timeout });
        return [`await page.waitForLoadState(${str(condition.state)}${options === "" ? "" : `, ${options}`});`];
      }
    }
  },
  screenshot(action, ctx) {
    const name = action.name ?? `step-${ctx.stepIndex}`;
    return [
      `await page.screenshot(${objectLiteral({ path: `test.info().outputPath(${str(`${name}.png`)})`, fullPage: action.fullPage ?? true })});`,
    ];
  },
};

/** `null` marks a kind this compiler does not support; compiling it fails explicitly. */
const ASSERTION_EMITTERS: { [K in AssertionKind]: AssertionEmitter<K> | null } = {
  text(assertion, timeoutMs) {
    const matcher = assertion.operator === "contains" ? "toContainText" : "toHaveText";
    const expected = assertion.operator === "matches" ? regex(assertion.expected) : str(assertion.expected);
    return [`await expect(${locator(assertion.target)}).${matcher}(${expected}, ${objectLiteral({ timeout: timeoutMs })});`];
  },
  visibility(assertion, timeoutMs) {
    const matcher = assertion.expected === "visible" ? "toBeVisible" : "toBeHidden";
    return [`await expect(${locator(assertion.target)}).${matcher}(${objectLiteral({ timeout: timeoutMs })});`];
  },
  existence(assertion, timeoutMs) {
    // Presence is "at least one match", absence is "zero matches" — the same
    // semantics EXEGEZIS evaluates, without Playwright's strictness on counts.
    const negation = assertion.expected === "present" ? ".not" : "";
    return [`await expect(${locator(assertion.target)})${negation}.toHaveCount(0, ${objectLiteral({ timeout: timeoutMs })});`];
  },
  attribute(assertion, timeoutMs) {
    const expected =
      assertion.operator === "equals"
        ? str(assertion.expected)
        : regex(assertion.operator === "contains" ? escapeRegExp(assertion.expected) : assertion.expected);
    return [
      `await expect(${locator(assertion.target)}).toHaveAttribute(${str(assertion.name)}, ${expected}, ${objectLiteral({ timeout: timeoutMs })});`,
    ];
  },
  url(assertion, timeoutMs, ctx) {
    let expected: string;
    if (assertion.operator === "equals") {
      ctx.usesBaseUrl = true;
      expected = `new URL(${str(assertion.expected)}, baseURL).toString()`;
    } else {
      expected = regex(assertion.operator === "contains" ? escapeRegExp(assertion.expected) : assertion.expected);
    }
    return [`await expect(page).toHaveURL(${expected}, ${objectLiteral({ timeout: timeoutMs })});`];
  },
  count(assertion, timeoutMs) {
    return [`await expect(${locator(assertion.target)}).toHaveCount(${assertion.expected}, ${objectLiteral({ timeout: timeoutMs })});`];
  },
  http(assertion, timeoutMs, ctx) {
    ctx.usesResponses = true;
    const { request, expected } = assertion;
    const find = `lastResponse(responses, ${request.method === undefined ? "undefined" : str(request.method)}, ${str(request.path)})`;
    const options = objectLiteral({ timeout: timeoutMs });
    const lines: string[] = [];
    if (expected.status !== undefined) {
      lines.push(`await expect.poll(() => ${find}?.status(), ${options}).toBe(${expected.status});`);
    }
    if (expected.body !== undefined) {
      ctx.usesJsonPointer = true;
      lines.push(
        `await expect`,
        `  .poll(async () => jsonPointer(await ${find}?.json(), ${str(expected.body.pointer)}), ${options})`,
        `  .toEqual(${JSON.stringify(expected.body.equals)});`,
      );
    }
    return lines;
  },
  visual: null,
  // Page-health assertions state the correct behaviour: the spec fails while
  // the defect exists. They wait for the network to go idle first, so late
  // errors and requests are included, like in the inspection.
  console(assertion, timeoutMs, ctx) {
    ctx.usesConsole = true;
    return [
      `await page.waitForLoadState("networkidle", ${objectLiteral({ timeout: timeoutMs })}).catch(() => undefined);`,
      `expect(consoleMessages.filter((m) => m.type === ${str(assertion.level)} && m.text.includes(${str(assertion.contains)})).map((m) => m.text)).toEqual([]);`,
    ];
  },
  page_error(assertion, timeoutMs, ctx) {
    ctx.usesPageErrors = true;
    return [
      `await page.waitForLoadState("networkidle", ${objectLiteral({ timeout: timeoutMs })}).catch(() => undefined);`,
      `expect(pageErrors.filter((e) => \`\${e.name}: \${e.message}\`.includes(${str(assertion.contains)})).map((e) => e.message)).toEqual([]);`,
    ];
  },
  request(assertion, timeoutMs, ctx) {
    ctx.usesRequests = true;
    const method = assertion.request.method === undefined ? "undefined" : str(assertion.request.method);
    return [
      `await page.waitForLoadState("networkidle", ${objectLiteral({ timeout: timeoutMs })}).catch(() => undefined);`,
      `expect(requestLog.filter((r) => (${method} === undefined || r.method === ${method}) && matchesRequestUrl(r.url, ${str(assertion.request.url)}) && (r.failed !== undefined || (r.status ?? 0) >= 400))).toEqual([]);`,
    ];
  },
  link(assertion, timeoutMs) {
    return [
      `const response = await page.request.get(new URL(${str(assertion.url)}, page.url()).toString(), ${objectLiteral({ failOnStatusCode: false, timeout: timeoutMs })});`,
      `expect(response.status(), ${str(`GET ${assertion.url}`)}).toBeLessThan(400);`,
    ];
  },
  a11y(assertion, _timeoutMs, ctx) {
    ctx.usesAxe = true;
    return [
      `const results = await new AxeBuilder({ page }).withRules([${str(assertion.rule)}]).analyze();`,
      `const violating = results.violations.flatMap((v) => v.nodes.map((n) => axeSelector(n.target as (string | string[])[])));`,
      `expect(violating.filter((selector) => selector === ${str(assertion.selector)})).toEqual([]);`,
    ];
  },
};

/**
 * Compiles a test plan to a standalone Playwright spec. The output depends
 * only on its inputs (no timestamps), so compiling the same plan twice yields
 * byte-identical files that can be versioned and diffed.
 */
export function compileToPlaywright(plan: TestPlan, options: CompileOptions): CompiledSpec {
  const runtime = options.runtime ?? DEFAULT_SPEC_RUNTIME;
  const timeouts = resolveTimeouts(plan.timeouts);
  const unsupported = plan.steps.flatMap((step, i) =>
    step.type === "assert" && ASSERTION_EMITTERS[step.assertion.kind] === null ? [{ stepIndex: i + 1, kind: step.assertion.kind }] : [],
  );
  if (unsupported.length > 0) throw new UnsupportedStepError(unsupported);
  const ctx: EmitContext = {
    stepIndex: 0,
    timeouts,
    usesResponses: false,
    usesJsonPointer: false,
    usesBaseUrl: false,
    usesConsole: false,
    usesPageErrors: false,
    usesRequests: false,
    usesAxe: false,
  };

  // Steps are emitted first so we know which helpers and fixtures they need.
  const body: { stepIndex: number; lines: string[] }[] = plan.steps.map((step, index) => {
    ctx.stepIndex = index + 1;
    return { stepIndex: index + 1, lines: emitStep(step, ctx) };
  });

  const out = new SourceBuilder();
  out.line(`// ${plan.id}: ${oneLine(plan.title)}`);
  out.line("//");
  out.line(`// Generated by EXEGEZIS ${options.exegezisVersion} from test plan ${plan.id} (${options.planHash.slice(0, 19)}…).`);
  out.line(`// Do not edit by hand. Regenerate with: exegezis compile --plan ${options.planPath}`);
  out.line(`// Standalone: it needs only @playwright/test${ctx.usesAxe ? " and @axe-core/playwright" : ""}. Run it with:`);
  out.line(`//   npx playwright test ${plan.id}.spec.ts`);
  out.line(`// Target: ${plan.target.baseUrl} (override with the ${BASE_URL_ENV} environment variable).`);
  if (plan.preconditions.length > 0) {
    out.line("//");
    out.line("// Preconditions:");
    for (const precondition of plan.preconditions) out.line(`//   - ${oneLine(precondition)}`);
  }
  out.line("");
  out.line(`import { expect, test${ctx.usesResponses ? ", type Response" : ""} } from "@playwright/test";`);
  if (ctx.usesAxe) out.line(`import { AxeBuilder } from "@axe-core/playwright";`);
  out.line("");
  out.line("test.use({");
  out.line(`  baseURL: process.env[${str(BASE_URL_ENV)}] ?? ${str(plan.target.baseUrl)},`);
  out.line(`  viewport: { width: ${runtime.viewport.width}, height: ${runtime.viewport.height} },`);
  out.line(`  locale: ${str(runtime.locale)},`);
  out.line(`  timezoneId: ${str(runtime.timezoneId)},`);
  out.line(`  actionTimeout: ${timeouts.actionMs},`);
  out.line(`  navigationTimeout: ${timeouts.navigationMs},`);
  out.line("});");
  out.line("");
  const fixtures = ctx.usesBaseUrl ? "{ page, baseURL }" : "{ page }";
  out.line(`test(${str(`${plan.id}: ${oneLine(plan.title)}`)}, async (${fixtures}) => {`);
  out.line(`  test.setTimeout(${timeouts.runMs});`);
  out.line("");
  if (ctx.usesConsole) {
    out.line("  // Console messages of the page, for console assertions.");
    out.line("  const consoleMessages: { type: string; text: string }[] = [];");
    out.line('  page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));');
    out.line("");
  }
  if (ctx.usesPageErrors) {
    out.line("  // Uncaught exceptions of the page, for page-error assertions.");
    out.line("  const pageErrors: Error[] = [];");
    out.line('  page.on("pageerror", (error) => pageErrors.push(error));');
    out.line("");
  }
  if (ctx.usesRequests) {
    out.line("  // Requests of the page and how they ended, for request assertions.");
    out.line("  const requestLog: { method: string; url: string; status?: number; failed?: string }[] = [];");
    out.line('  page.on("response", (response) => requestLog.push({ method: response.request().method(), url: response.url(), status: response.status() }));');
    out.line('  page.on("requestfailed", (request) => requestLog.push({ method: request.method(), url: request.url(), failed: request.failure()?.errorText ?? "failed" }));');
    out.line("");
  }
  if (ctx.usesResponses) {
    out.line("  // Responses observed during the test, for HTTP assertions.");
    out.line("  const responses: Response[] = [];");
    out.line('  page.on("response", (response) => responses.push(response));');
    out.line("");
  }

  const steps: StepLines[] = [];
  for (const [i, { stepIndex, lines }] of body.entries()) {
    const step = plan.steps[stepIndex - 1] as PlanStep;
    const startLine = out.nextLine;
    out.line(`  await test.step(${str(`${stepIndex}. ${stepTitle(step)}`)}, async () => {`);
    for (const line of lines) out.line(`    ${line}`);
    out.line("  });");
    steps.push({ stepIndex, startLine, endLine: out.nextLine - 1 });
    if (i < body.length - 1) out.line("");
  }
  out.line("});");

  if (ctx.usesResponses) {
    out.line("");
    out.line("/** Most recent response to `method path` observed so far (query string ignored). */");
    out.line("function lastResponse(responses: Response[], method: string | undefined, path: string): Response | undefined {");
    out.line("  for (let i = responses.length - 1; i >= 0; i--) {");
    out.line("    const response = responses[i]!;");
    out.line("    if (method !== undefined && response.request().method() !== method) continue;");
    out.line("    if (new URL(response.url()).pathname === path) return response;");
    out.line("  }");
    out.line("  return undefined;");
    out.line("}");
  }
  if (ctx.usesRequests) {
    out.line("");
    out.line("/** An absolute URL (fragment ignored), or a path matched against pathname + search. */");
    out.line("function matchesRequestUrl(url: string, pattern: string): boolean {");
    out.line("  const u = new URL(url);");
    out.line('  if (pattern.startsWith("/")) return `${u.pathname}${u.search}` === pattern || u.pathname === pattern;');
    out.line("  const p = new URL(pattern);");
    out.line('  u.hash = "";');
    out.line('  p.hash = "";');
    out.line("  return u.toString() === p.toString();");
    out.line("}");
  }
  if (ctx.usesAxe) {
    out.line("");
    out.line("/** axe's node target as one selector string (iframe / shadow parts joined with \" >>> \"). */");
    out.line("function axeSelector(target: (string | string[])[]): string {");
    out.line('  return target.map((t) => (typeof t === "string" ? t : t.join(" >>> "))).join(" ");');
    out.line("}");
  }
  if (ctx.usesJsonPointer) {
    out.line("");
    out.line("/** Resolves an RFC 6901 JSON Pointer; undefined when the path does not exist. */");
    out.line("function jsonPointer(document: unknown, pointer: string): unknown {");
    out.line("  let current = document;");
    out.line('  for (const raw of pointer === "" ? [] : pointer.slice(1).split("/")) {');
    out.line('    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");');
    out.line('    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;');
    out.line("    current = (current as Record<string, unknown>)[key];");
    out.line("  }");
    out.line("  return current;");
    out.line("}");
  }

  return { fileName: `${plan.id}.spec.ts`, source: out.toString(), steps };
}

function emitStep(step: PlanStep, ctx: EmitContext): string[] {
  switch (step.type) {
    case "observe":
      return ["// Observation point in EXEGEZIS (evidence capture); nothing to do in a test."];
    case "assert": {
      const emitter = ASSERTION_EMITTERS[step.assertion.kind] as (a: Assertion, t: number, c: EmitContext) => string[];
      return emitter(step.assertion, step.timeoutMs ?? ctx.timeouts.assertionMs, ctx);
    }
    default: {
      const emitter = ACTION_EMITTERS[step.type] as (a: typeof step, c: EmitContext) => string[];
      return emitter(step, ctx);
    }
  }
}

function stepTitle(step: PlanStep): string {
  switch (step.type) {
    case "assert":
      return `${step.purpose === "anchor" ? "anchor" : "expect"}: ${oneLine(step.description ?? describeAssertion(step.assertion))}`;
    case "observe":
      return `observe${step.label === undefined ? "" : ` ${step.label}`}`;
    case "navigate":
      return `navigate ${step.url}`;
    case "click":
      return `click ${describeTarget(step.target)}`;
    case "fill":
      return `fill ${describeTarget(step.target)}`;
    case "press":
      return `press ${step.key}`;
    case "wait":
      return step.condition.kind === "element"
        ? `wait for ${describeTarget(step.condition.target)} to be ${step.condition.state}`
        : step.condition.kind === "timeout"
          ? `wait ${step.condition.ms} ms`
          : `wait for ${step.condition.state}`;
    case "screenshot":
      return `screenshot${step.name === undefined ? "" : ` ${step.name}`}`;
  }
}

/** Idiomatic Playwright locator, preferring semantic strategies. */
export function locator(target: ElementTarget): string {
  if ("role" in target) {
    const options = objectLiteral({
      name: target.name === undefined ? undefined : str(target.name),
      exact: target.exact,
    });
    return `page.getByRole(${str(target.role)}${options === "" ? "" : `, ${options}`})`;
  }
  const exact = "exact" in target && target.exact !== undefined ? `, ${objectLiteral({ exact: target.exact })}` : "";
  if ("label" in target) return `page.getByLabel(${str(target.label)}${exact})`;
  if ("text" in target) return `page.getByText(${str(target.text)}${exact})`;
  if ("placeholder" in target) return `page.getByPlaceholder(${str(target.placeholder)}${exact})`;
  if ("testId" in target) return `page.getByTestId(${str(target.testId)})`;
  return `page.locator(${str(target.css)})`;
}

function looksLikePassword(target: ElementTarget): boolean {
  const text = "label" in target ? target.label : "role" in target ? (target.name ?? "") : "placeholder" in target ? target.placeholder : "";
  return /pass(word|code|phrase)/i.test(text);
}

/** Renders `{ a: 1, b: "x" }` from already-rendered values, skipping undefined. */
function objectLiteral(fields: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  return `{ ${entries.map(([key, value]) => `${key}: ${String(value)}`).join(", ")} }`;
}

function str(value: string): string {
  return JSON.stringify(value);
}

function regex(source: string): string {
  return `new RegExp(${str(source)})`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

class SourceBuilder {
  private readonly lines: string[] = [];

  get nextLine(): number {
    return this.lines.length + 1;
  }

  line(text: string): void {
    this.lines.push(text);
  }

  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

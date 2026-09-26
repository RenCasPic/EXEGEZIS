import { parseArgs } from "node:util";

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export const BROWSER_CHANNELS = ["auto", "chromium", "chrome", "msedge"] as const;
export type BrowserChannelArg = (typeof BROWSER_CHANNELS)[number];

interface Common {
  output: string;
  headed: boolean;
  verbose: boolean;
  browserChannel: BrowserChannelArg;
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | ({ kind: "observe"; url: string; actionsFile?: string } & Common)
  | ({ kind: "run"; planFile: string; baseUrl?: string } & Common)
  | ({ kind: "reproduce"; planFile: string; baseUrl?: string; runs: number } & Common)
  | { kind: "compile"; planFile: string; output: string }
  | ({ kind: "verify"; planFile: string; baseUrl?: string; runs: number } & Common)
  | ({ kind: "validate"; planFile: string; baseUrl?: string } & Common)
  | ({
      kind: "benchmark";
      suite: string;
      runs?: number;
      baseUrl?: string;
      caseIds?: string[];
      planner?: Planner;
      model?: string;
      examples: boolean;
    } & Common)
  | ({ kind: "generate-plan"; symptom: string; baseUrl: string; examples?: string } & PlannerArgs & Common)
  | ({ kind: "ai-verify"; symptom: string; baseUrl: string; runs: number; examples?: string } & PlannerArgs & Common)
  | ({ kind: "root-cause"; suite: string; runs?: number; caseIds?: string[] } & Common)
  | ({ kind: "inspect" } & InspectArgs & Common)
  | { kind: "doctor"; install: boolean; json: boolean };

export interface InspectArgs {
  url: string;
  runs: number;
  maxPages?: number;
  maxDepth?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  delayMs?: number;
  checks?: string[];
  storageState?: string;
  strictReadonly: boolean;
  ignoreRobots: boolean;
}

export type Planner = "anthropic" | "mock";

interface PlannerArgs {
  planner: Planner;
  model?: string;
  mockResponse?: string;
}

/** Target of the AI commands when --base-url is not given (the buggy-shop lab). */
export const DEFAULT_AI_BASE_URL = "http://localhost:3000/";

export const EXIT = {
  ok: 0,
  /** An expectation did not hold: plan failed, bug not verified, reproduction flaky. */
  expectationFailed: 1,
  usage: 2,
  internal: 3,
  /** Nothing could be concluded: execution error, timeout, INCONCLUSIVE. */
  inconclusive: 4,
  /** Semantic validation rejected the plan: it was not executed. */
  invalidPlan: 5,
  /** The plan needs capabilities the adapter does not have: it was not executed. */
  unsupported: 6,
  /** No browser could be started on this machine: nothing was concluded about the target. */
  engineError: 7,
} as const;

export const MAX_RUNS = 100;

export const HELP = `EXEGEZIS — Software that explains itself.

Usage:
  exegezis observe   --url <url> [--actions <plan.json>] [options]
  exegezis run       --plan <test-plan.json> [--base-url <url>] [options]
  exegezis reproduce --plan <test-plan.json> [--runs 10] [--base-url <url>] [options]
  exegezis compile   --plan <test-plan.json> [--output <dir>]
  exegezis verify    --plan <test-plan.json> [--runs 10] [--base-url <url>] [options]
  exegezis validate  --plan <test-plan.json> [--base-url <url>] [options]
  exegezis benchmark --suite <name|suite.json> [--runs N] [--case <id>]... [--base-url <url>]
                     [--planner anthropic|mock] [--model <id>] [--no-examples] [options]
  exegezis generate-plan --symptom "<text>" [--base-url <url>] [--planner ...] [--examples <suite>] [options]
  exegezis ai-verify     --symptom "<text>" [--runs 10] [--base-url <url>] [--planner ...] [--examples <suite>] [options]
  exegezis root-cause    [--suite buggy-shop-root-cause] [--case <id>]... [--runs 5] [options]
  exegezis inspect       --url <url> [--runs 3] [--max-pages 20] [--max-depth 2] [--checks a,b]
                         [--storage-state <file>] [--strict-readonly] [--ignore-robots] [options]
  exegezis doctor        [--install] [--json]
  exegezis --help | --version

Commands:
  observe     Open <url>, run optional actions and record the evidence.
  run         Execute a test plan once: actions + assertions + evidence.
  reproduce   Execute a test plan N times in isolation and classify the result
              (REPRODUCED, NOT_REPRODUCED, FLAKY, INCONCLUSIVE).
  compile     Compile a test plan into a standalone Playwright spec.
  verify      preflight + semantic validation + reproduce + compile + run the
              compiled spec with Playwright + criteria -> bug report with one
              outcome: VERIFIED, NOT_VERIFIED, INCONCLUSIVE, FLAKY,
              INVALID_PLAN or UNSUPPORTED.
  validate    Semantic validation of a plan against a preflight observation.
  benchmark   Verify every case of a suite (e.g. benchmarks/buggy-shop) and
              score each outcome against its known answer. Suites whose plans
              are generated (e.g. buggy-shop-ai) need --planner.
  generate-plan  A planner (LLM) turns a symptom into a TestPlan, which is
              validated but NOT executed.
  ai-verify   symptom -> planner -> TestPlan -> the same verification as
              "verify". The planner proposes; only the engine decides.
  inspect     Open a URL without a symptom, walk it read-only (same origin,
              GET only, no clicks or forms) and report deterministic findings:
              JS exceptions, console errors, failed requests, broken internal
              links, accessibility (axe-core, WCAG 2.1 A/AA), mixed content and
              basic metadata. A finding is VERIFIED only if it appears in every
              run (fresh contexts); others are INTERMITTENT. Each VERIFIED finding
              gets evidence and a standalone Playwright spec. Anti-bot, CAPTCHA
              and login walls give BLOCKED; nothing tries to get past them.
  doctor      Check this machine: Node.js, pnpm and the browsers EXEGEZIS can
              drive (Playwright's Chromium, Google Chrome, Microsoft Edge), with
              their versions, and say what is missing and how to install it.
              Nothing is downloaded unless you pass --install, which downloads
              Playwright's Chromium (~150 MB).
  root-cause  For each case: reproduce the bug on an isolated copy of the app
              (baseline), then apply each hypothesis' code mutation to its own
              copy and reproduce again. A cause is VALIDATED only if its
              intervention removed the bug in every run and the competing
              hypotheses were refuted. The source tree is never modified.

Options:
  --output <dir>     Where results are written. Default: ./runs
  --runs <n>         Attempts for reproduce/verify/benchmark (1-${MAX_RUNS}). Default: 10
                     (benchmark: the suite's default)
  --suite <s>        Benchmark suite name (benchmarks/<s>/suite.json) or path.
  --case <id>        Only this benchmark case (repeatable).
  --symptom <text>   The reported problem, in plain language (AI commands).
  --planner <p>      anthropic (default; needs ANTHROPIC_API_KEY) or mock.
  --model <id>       Model for the anthropic planner. Default: claude-opus-5.
  --mock-response <f>  Mock planner: file with a recorded model answer.
  --examples <suite> Show that suite's solved cases to the planner (AI commands).
  --no-examples      Benchmark of generated plans: no examples in the prompt.
  AI commands target ${DEFAULT_AI_BASE_URL} unless --base-url is given.
  --base-url <url>   Run the plan against another environment.
  --headed           Show the browser window.
  --browser-channel <c>  Which browser to drive: auto (default: Playwright's
                     Chromium if installed, else Google Chrome, else Microsoft
                     Edge, which comes with Windows), chromium, chrome or msedge.
                     The browser actually used is recorded in every run.
  --verbose          Also stream structured logs to stderr.

Exit codes:
  0  success (run passed, reproduction conclusive, VERIFIED, plan valid,
     all benchmark cases passed, observe completed)
  1  expectation not met (assertion failed, NOT_VERIFIED, FLAKY, weakly
     anchored plan, benchmark case failed)
  2  usage error          3  internal error
  4  inconclusive (execution error, timeout, INCONCLUSIVE)
  5  invalid plan (not executed)
  6  unsupported plan (not executed)
  7  engine error: no browser could be started on this machine. Nothing was
     concluded about the site or the application. Run "pnpm exegezis doctor"
     (the same command works in Windows CMD, PowerShell, macOS and Linux).
`;

const COMMANDS = ["observe", "run", "reproduce", "compile", "verify", "validate", "benchmark", "generate-plan", "ai-verify", "root-cause", "inspect", "doctor"] as const;
const PLANNERS: readonly Planner[] = ["anthropic", "mock"];

export function parseCliArgs(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        url: { type: "string" },
        plan: { type: "string" },
        "base-url": { type: "string" },
        runs: { type: "string" },
        suite: { type: "string" },
        case: { type: "string", multiple: true },
        symptom: { type: "string" },
        planner: { type: "string" },
        model: { type: "string" },
        "mock-response": { type: "string" },
        examples: { type: "string" },
        "no-examples": { type: "boolean", default: false },
        "max-pages": { type: "string" },
        "max-depth": { type: "string" },
        "page-timeout": { type: "string" },
        "total-timeout": { type: "string" },
        delay: { type: "string" },
        checks: { type: "string" },
        "storage-state": { type: "string" },
        "strict-readonly": { type: "boolean", default: false },
        "ignore-robots": { type: "boolean", default: false },
        "browser-channel": { type: "string" },
        install: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        output: { type: "string", default: "./runs" },
        actions: { type: "string" },
        headed: { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const [command, ...extra] = positionals;
  if (command === undefined) return { kind: "help" };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(`Unknown command "${command}". Run "exegezis --help".`);
  }
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}".`);
  if (values.output === "") throw new UsageError("--output must not be empty.");

  const allowed: Record<(typeof COMMANDS)[number], string[]> = {
    observe: ["url", "actions", "browser-channel"],
    run: ["plan", "base-url", "browser-channel"],
    reproduce: ["plan", "base-url", "runs", "browser-channel"],
    compile: ["plan"],
    verify: ["plan", "base-url", "runs", "browser-channel"],
    validate: ["plan", "base-url", "browser-channel"],
    benchmark: ["suite", "base-url", "runs", "case", "planner", "model", "no-examples", "browser-channel"],
    "generate-plan": ["symptom", "base-url", "planner", "model", "mock-response", "examples", "browser-channel"],
    "ai-verify": ["symptom", "base-url", "runs", "planner", "model", "mock-response", "examples", "browser-channel"],
    "root-cause": ["suite", "runs", "case", "browser-channel"],
    inspect: ["url", "runs", "max-pages", "max-depth", "page-timeout", "total-timeout", "delay", "checks", "storage-state", "strict-readonly", "ignore-robots", "browser-channel"],
    doctor: ["install", "json"],
  };
  for (const option of [
    "url",
    "plan",
    "base-url",
    "runs",
    "actions",
    "suite",
    "case",
    "symptom",
    "planner",
    "model",
    "mock-response",
    "examples",
    "no-examples",
    "max-pages",
    "max-depth",
    "page-timeout",
    "total-timeout",
    "delay",
    "checks",
    "storage-state",
    "strict-readonly",
    "ignore-robots",
    "browser-channel",
    "install",
    "json",
  ] as const) {
    const value = values[option];
    if (value === undefined || value === false) continue;
    if (!allowed[command as (typeof COMMANDS)[number]].includes(option)) {
      throw new UsageError(`Option --${option} is not valid for "${command}".`);
    }
  }
  if ((command === "compile" || command === "doctor") && (values.headed || values.verbose)) {
    throw new UsageError(`Options --headed and --verbose are not valid for "${command}".`);
  }

  const channel = values["browser-channel"] ?? "auto";
  if (!(BROWSER_CHANNELS as readonly string[]).includes(channel)) {
    throw new UsageError(`--browser-channel must be one of ${BROWSER_CHANNELS.join(", ")}, got "${channel}".`);
  }
  const common: Common = { output: values.output, headed: values.headed, verbose: values.verbose, browserChannel: channel as BrowserChannelArg };
  const baseUrl = values["base-url"] === undefined ? {} : { baseUrl: httpUrl("--base-url", values["base-url"]) };

  switch (command) {
    case "observe": {
      if (values.url === undefined || values.url === "") throw new UsageError("Missing required option --url <url>.");
      return {
        kind: "observe",
        url: httpUrl("--url", values.url),
        ...(values.actions === undefined ? {} : { actionsFile: values.actions }),
        ...common,
      };
    }
    case "compile":
      return { kind: "compile", planFile: requirePlan(values.plan), output: values.output };
    case "doctor":
      return { kind: "doctor", install: values.install, json: values.json };
    case "run":
      return { kind: "run", planFile: requirePlan(values.plan), ...baseUrl, ...common };
    case "reproduce":
    case "verify":
      return { kind: command, planFile: requirePlan(values.plan), runs: parseRuns(values.runs), ...baseUrl, ...common };
    case "validate":
      return { kind: "validate", planFile: requirePlan(values.plan), ...baseUrl, ...common };
    case "benchmark": {
      if (values.suite === undefined || values.suite === "") throw new UsageError("Missing required option --suite <name|suite.json>.");
      return {
        kind: "benchmark",
        suite: values.suite,
        ...(values.runs === undefined ? {} : { runs: parseRuns(values.runs) }),
        ...(values.case === undefined ? {} : { caseIds: values.case }),
        ...(values.planner === undefined ? {} : { planner: parsePlanner(values.planner) }),
        ...(values.model === undefined ? {} : { model: values.model }),
        examples: !values["no-examples"],
        ...baseUrl,
        ...common,
      };
    }
    case "generate-plan":
    case "ai-verify": {
      const symptom = values.symptom?.trim();
      if (symptom === undefined || symptom === "") throw new UsageError('Missing required option --symptom "<text>".');
      const planner: PlannerArgs = {
        planner: values.planner === undefined ? "anthropic" : parsePlanner(values.planner),
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(values["mock-response"] === undefined ? {} : { mockResponse: values["mock-response"] }),
      };
      if (planner.planner === "mock" && planner.mockResponse === undefined) {
        throw new UsageError("--planner mock needs --mock-response <file>.");
      }
      const shared = {
        symptom,
        baseUrl: baseUrl.baseUrl ?? DEFAULT_AI_BASE_URL,
        ...(values.examples === undefined ? {} : { examples: values.examples }),
        ...planner,
        ...common,
      };
      return command === "ai-verify" ? { kind: "ai-verify", runs: parseRuns(values.runs), ...shared } : { kind: "generate-plan", ...shared };
    }
    case "inspect": {
      if (values.url === undefined || values.url === "") throw new UsageError("Missing required option --url <url>.");
      const int = (option: string, raw: string | undefined, min: number, max: number): number | undefined => {
        if (raw === undefined) return undefined;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${option} must be an integer between ${min} and ${max}, got "${raw}".`);
        return n;
      };
      const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));
      return {
        kind: "inspect",
        url: httpUrl("--url", values.url),
        runs: int("runs", values.runs, 1, 20) ?? 3,
        ...optional("maxPages", int("max-pages", values["max-pages"], 1, 500)),
        ...optional("maxDepth", int("max-depth", values["max-depth"], 0, 10)),
        ...optional("pageTimeoutMs", int("page-timeout", values["page-timeout"], 1_000, 300_000)),
        ...optional("totalTimeoutMs", int("total-timeout", values["total-timeout"], 10_000, 7_200_000)),
        ...optional("delayMs", int("delay", values.delay, 0, 60_000)),
        ...optional("checks", values.checks?.split(",").map((c) => c.trim()).filter((c) => c !== "")),
        ...optional("storageState", values["storage-state"]),
        strictReadonly: values["strict-readonly"],
        ignoreRobots: values["ignore-robots"],
        ...common,
      };
    }
    case "root-cause":
      return {
        kind: "root-cause",
        suite: values.suite === undefined || values.suite === "" ? "buggy-shop-root-cause" : values.suite,
        ...(values.runs === undefined ? {} : { runs: parseRuns(values.runs) }),
        ...(values.case === undefined ? {} : { caseIds: values.case }),
        ...common,
      };
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

function parsePlanner(value: string): Planner {
  if (!(PLANNERS as readonly string[]).includes(value)) {
    throw new UsageError(`--planner must be one of ${PLANNERS.join(", ")}, got "${value}".`);
  }
  return value as Planner;
}

function requirePlan(plan: string | undefined): string {
  if (plan === undefined || plan === "") throw new UsageError("Missing required option --plan <test-plan.json>.");
  return plan;
}

function parseRuns(runs: string | undefined): number {
  if (runs === undefined) return 10;
  const value = Number(runs);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RUNS) {
    throw new UsageError(`--runs must be an integer between 1 and ${MAX_RUNS}, got "${runs}".`);
  }
  return value;
}

function httpUrl(option: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`Invalid ${option} "${raw}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`${option} must use http or https, got "${url.protocol}".`);
  }
  return url.toString();
}

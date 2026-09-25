import { parseArgs } from "node:util";

export class UsageError extends Error {
  override readonly name = "UsageError";
}

interface Common {
  output: string;
  headed: boolean;
  verbose: boolean;
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
  | ({ kind: "benchmark"; suite: string; runs?: number; baseUrl?: string; caseIds?: string[] } & Common);

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
  exegezis benchmark --suite <name|suite.json> [--runs N] [--case <id>]... [--base-url <url>] [options]
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
              score each outcome against its known answer.

Options:
  --output <dir>     Where results are written. Default: ./runs
  --runs <n>         Attempts for reproduce/verify/benchmark (1-${MAX_RUNS}). Default: 10
                     (benchmark: the suite's default)
  --suite <s>        Benchmark suite name (benchmarks/<s>/suite.json) or path.
  --case <id>        Only this benchmark case (repeatable).
  --base-url <url>   Run the plan against another environment.
  --headed           Show the browser window.
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
`;

const COMMANDS = ["observe", "run", "reproduce", "compile", "verify", "validate", "benchmark"] as const;

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
    observe: ["url", "actions"],
    run: ["plan", "base-url"],
    reproduce: ["plan", "base-url", "runs"],
    compile: ["plan"],
    verify: ["plan", "base-url", "runs"],
    validate: ["plan", "base-url"],
    benchmark: ["suite", "base-url", "runs", "case"],
  };
  for (const option of ["url", "plan", "base-url", "runs", "actions", "suite", "case"] as const) {
    if (values[option] !== undefined && !allowed[command as (typeof COMMANDS)[number]].includes(option)) {
      throw new UsageError(`Option --${option} is not valid for "${command}".`);
    }
  }
  if (command === "compile" && (values.headed || values.verbose)) {
    throw new UsageError('Options --headed and --verbose are not valid for "compile".');
  }

  const common: Common = { output: values.output, headed: values.headed, verbose: values.verbose };
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
        ...baseUrl,
        ...common,
      };
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
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

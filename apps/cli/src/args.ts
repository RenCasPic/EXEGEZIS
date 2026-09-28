import { parseArgs } from "node:util";
import { t } from "./i18n.js";
import { parseSearchArgs, type SearchCommand } from "./search-args.js";

export class UsageError extends Error {
  override readonly name = "UsageError";
}

/** Node's parseArgs errors (English only) in the current language; unknown ones as Node wrote them. */
export function parseArgsError(error: unknown): UsageError {
  const e = error as { code?: string; message?: string };
  const option = /'(-{1,2}[^' ]+)/.exec(e.message ?? "")?.[1] ?? "";
  if (e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return new UsageError(t("args.unknownOption", { option }));
  if (e.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") return new UsageError(t("args.optionValue", { option }));
  if (e.code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") return new UsageError(t("args.unexpected", { arg: /'([^']+)'/.exec(e.message ?? "")?.[1] ?? "" }));
  return new UsageError(error instanceof Error ? error.message : String(error));
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
  | { kind: "doctor"; install: boolean; json: boolean }
  | SessionCommand
  | SearchCommand;

export const SESSION_ACTIONS = ["login", "list", "delete", "http-auth", "waf-token", "set"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];

export interface SessionCommand {
  kind: "session";
  action: SessionAction;
  /** Required for every action except list. */
  url?: string;
  browserChannel: BrowserChannelArg;
  /** login: the UI's "Done" button creates this file (the terminal uses Enter). */
  doneFile?: string;
  /** http-auth: read {"username","password"} as JSON from stdin instead of prompting (never from argv). */
  stdin: boolean;
  /** waf-token: create a new token even if one exists. */
  rotate: boolean;
  /** set: "This site is mine: also inspect what robots.txt excludes." */
  robotsOwner?: boolean;
  /** set: extra link patterns never visited with a session. */
  unsafePatterns?: string[];
  json: boolean;
}

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
  /** undefined: the default (strict with a saved session, off without). */
  strictReadonly?: boolean;
  ignoreRobots: boolean;
  /** Inspect as an anonymous visitor, without the saved access of the origin. */
  noSession: boolean;
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


const COMMANDS = ["observe", "run", "reproduce", "compile", "verify", "validate", "benchmark", "generate-plan", "ai-verify", "root-cause", "inspect", "doctor", "session"] as const;
const PLANNERS: readonly Planner[] = ["anthropic", "mock"];

export function parseCliArgs(argv: readonly string[]): Command {
  // `search` has its own sub-actions and options (search-args.ts).
  if (argv[0] === "search") return parseSearchArgs(argv.slice(1));
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
        "no-session": { type: "boolean", default: false },
        "allow-page-writes": { type: "boolean", default: false },
        "done-file": { type: "string" },
        stdin: { type: "boolean", default: false },
        rotate: { type: "boolean", default: false },
        "robots-owner": { type: "string" },
        "unsafe-pattern": { type: "string", multiple: true },
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
    throw parseArgsError(error);
  }

  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const [command, ...rest] = positionals;
  if (command === undefined) return { kind: "help" };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(t("args.unknownCommand", { command }));
  }
  // `session` takes its action as a positional: `exegezis session login --url …`.
  const [action, ...extra] = command === "session" ? rest : [undefined, ...rest];
  if (command === "session" && (action === undefined || !(SESSION_ACTIONS as readonly string[]).includes(action))) {
    throw new UsageError(t("args.sessionAction", { actions: SESSION_ACTIONS.join(", ") }));
  }
  if (extra.length > 0) throw new UsageError(t("args.unexpected", { arg: String(extra[0]) }));
  if (values.output === "") throw new UsageError(t("args.outputEmpty"));

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
    inspect: ["url", "runs", "max-pages", "max-depth", "page-timeout", "total-timeout", "delay", "checks", "storage-state", "strict-readonly", "ignore-robots", "browser-channel", "no-session", "allow-page-writes"],
    session: ["url", "browser-channel", "done-file", "stdin", "rotate", "robots-owner", "unsafe-pattern", "json"],
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
    "no-session",
    "allow-page-writes",
    "done-file",
    "stdin",
    "rotate",
    "robots-owner",
    "unsafe-pattern",
  ] as const) {
    const value = values[option];
    if (value === undefined || value === false) continue;
    if (!allowed[command as (typeof COMMANDS)[number]].includes(option)) {
      throw new UsageError(t("args.notValidFor", { option, command }));
    }
  }
  if ((command === "compile" || command === "doctor") && (values.headed || values.verbose)) {
    throw new UsageError(t("args.headedVerbose", { command }));
  }

  const channel = values["browser-channel"] ?? "auto";
  if (!(BROWSER_CHANNELS as readonly string[]).includes(channel)) {
    throw new UsageError(t("args.oneOf", { option: "--browser-channel", values: BROWSER_CHANNELS.join(", "), value: channel }));
  }
  const common: Common = { output: values.output, headed: values.headed, verbose: values.verbose, browserChannel: channel as BrowserChannelArg };
  const baseUrl = values["base-url"] === undefined ? {} : { baseUrl: httpUrl("--base-url", values["base-url"]) };

  switch (command) {
    case "observe": {
      if (values.url === undefined || values.url === "") throw new UsageError(t("args.missing", { option: "--url <url>" }));
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
    case "session": {
      const act = action as SessionAction;
      if (act !== "list" && (values.url === undefined || values.url === "")) throw new UsageError(t("args.missingFor", { option: "--url <site>", command: `session ${act}` }));
      if (values["robots-owner"] !== undefined && !["yes", "no"].includes(values["robots-owner"])) throw new UsageError(t("args.robotsOwner"));
      return {
        kind: "session",
        action: act,
        ...(values.url === undefined ? {} : { url: httpUrl("--url", values.url) }),
        browserChannel: channel as BrowserChannelArg,
        ...(values["done-file"] === undefined ? {} : { doneFile: values["done-file"] }),
        stdin: values.stdin,
        rotate: values.rotate,
        ...(values["robots-owner"] === undefined ? {} : { robotsOwner: values["robots-owner"] === "yes" }),
        ...(values["unsafe-pattern"] === undefined ? {} : { unsafePatterns: values["unsafe-pattern"] }),
        json: values.json,
      };
    }
    case "run":
      return { kind: "run", planFile: requirePlan(values.plan), ...baseUrl, ...common };
    case "reproduce":
    case "verify":
      return { kind: command, planFile: requirePlan(values.plan), runs: parseRuns(values.runs), ...baseUrl, ...common };
    case "validate":
      return { kind: "validate", planFile: requirePlan(values.plan), ...baseUrl, ...common };
    case "benchmark": {
      if (values.suite === undefined || values.suite === "") throw new UsageError(t("args.missing", { option: "--suite <name|suite.json>" }));
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
      if (symptom === undefined || symptom === "") throw new UsageError(t("args.missing", { option: '--symptom "<text>"' }));
      const planner: PlannerArgs = {
        planner: values.planner === undefined ? "anthropic" : parsePlanner(values.planner),
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(values["mock-response"] === undefined ? {} : { mockResponse: values["mock-response"] }),
      };
      if (planner.planner === "mock" && planner.mockResponse === undefined) {
        throw new UsageError(t("args.mockNeedsResponse"));
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
      if (values.url === undefined || values.url === "") throw new UsageError(t("args.missing", { option: "--url <url>" }));
      const int = (option: string, raw: string | undefined, min: number, max: number): number | undefined => {
        if (raw === undefined) return undefined;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(t("args.intRange", { option, min: String(min), max: String(max), value: raw }));
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
        ...(values["strict-readonly"] ? { strictReadonly: true } : values["allow-page-writes"] ? { strictReadonly: false } : {}),
        ignoreRobots: values["ignore-robots"],
        noSession: values["no-session"],
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
      throw new UsageError(t("args.unknownCommand", { command }));
  }
}

function parsePlanner(value: string): Planner {
  if (!(PLANNERS as readonly string[]).includes(value)) {
    throw new UsageError(t("args.oneOf", { option: "--planner", values: PLANNERS.join(", "), value }));
  }
  return value as Planner;
}

function requirePlan(plan: string | undefined): string {
  if (plan === undefined || plan === "") throw new UsageError(t("args.missing", { option: "--plan <test-plan.json>" }));
  return plan;
}

function parseRuns(runs: string | undefined): number {
  if (runs === undefined) return 10;
  const value = Number(runs);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RUNS) {
    throw new UsageError(t("args.intRange", { option: "runs", min: "1", max: String(MAX_RUNS), value: runs }));
  }
  return value;
}

function httpUrl(option: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(t("args.invalidUrl", { option, value: raw }));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(t("args.httpOnly", { option, protocol: url.protocol }));
  }
  return url.toString();
}

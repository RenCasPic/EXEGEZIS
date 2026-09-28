import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BrowserAdapter, type BrowserChannel } from "@exegezis/adapter-browser";
import type { SpecRuntime } from "@exegezis/compiler-playwright";
import {
  describeAssertion,
  describeTarget,
  assertionMessage,
  validatePlan,
  hashJson,
  JsonlFileSink,
  Logger,
  redactPlan,
  RUN_FILES,
  StreamSink,
  TestPlan,
  type LogSink,
  type PlanValidation,
  type RunRecorder,
  type TimelineEvent,
} from "@exegezis/core";
import { EXIT, UsageError } from "./args.js";
import { engineText, t } from "./i18n.js";

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: NodeJS.WritableStream;
  cwd: string;
}

export interface LoadedPlan {
  plan: TestPlan;
  /** Path as the user gave it, with forward slashes. */
  path: string;
  hash: string;
}

export function printer(io: CliIo): (line?: string) => void {
  return (line = "") => void io.stdout.write(`${line}\n`);
}

export function absolute(io: Pick<CliIo, "cwd">, path: string): string {
  return isAbsolute(path) ? path : resolve(io.cwd, path);
}

/** `./runs/x/` style path for display, relative to the working directory when possible. */
export function displayPath(io: Pick<CliIo, "cwd">, path: string, trailingSlash = true): string {
  const rel = relative(io.cwd, path);
  const shown = rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : `./${rel}`;
  return `${shown.replaceAll("\\", "/")}${trailingSlash ? "/" : ""}`;
}

export async function loadTestPlan(io: CliIo, file: string): Promise<LoadedPlan> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(absolute(io, file), "utf8"));
  } catch (error) {
    throw new UsageError(t("common.cannotReadPlan", { file, message: error instanceof Error ? error.message : String(error) }));
  }
  const result = TestPlan.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(t("common.invalidPlan", { file, issues }));
  }
  return { plan: result.data, path: file.replaceAll("\\", "/"), hash: hashJson(redactPlan(result.data)) };
}

/** --browser-channel, set once per CLI invocation (main.ts); every adapter of the command uses it. */
let browserChannel: BrowserChannel = "auto";
export function useBrowserChannel(channel: BrowserChannel): void {
  browserChannel = channel;
}
export function currentBrowserChannel(): BrowserChannel {
  return browserChannel;
}

export function createAdapter(headed: boolean, options: { coverage?: boolean } = {}): BrowserAdapter {
  return new BrowserAdapter({ headless: !headed, browserChannel, ...(options.coverage === true ? { coverage: true } : {}) });
}

/** Spec settings mirroring the adapter, so the compiled test runs like EXEGEZIS did. */
export function specRuntime(adapter: BrowserAdapter): SpecRuntime {
  const { viewport, locale, timezoneId } = adapter.options;
  return { viewport, locale, timezoneId };
}

/** Every run logs to its own JSONL file; `--verbose` also streams to stderr. */
export function runLogger(io: CliIo, recorder: RunRecorder, verbose: boolean): Logger {
  const sinks: LogSink[] = [new JsonlFileSink(join(recorder.dir, RUN_FILES.log))];
  if (verbose) sinks.push(new StreamSink(io.stderr, "debug"));
  return new Logger(sinks, { runId: recorder.runId });
}

export function percent(rate: number | null): string {
  return rate === null ? t("common.notAvailable") : `${Math.round(rate * 100)}%`;
}

/**
 * Step-by-step rendering of a run, derived from its timeline:
 * `STEP 3  CLICK button "Add to cart"` / `STEP 4  ASSERT ... FAIL`.
 */
export function renderSteps(events: readonly TimelineEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case "ACTION_STARTED": {
        const step = event.payload.step;
        const what =
          step.type === "navigate"
            ? step.url
            : "target" in step && step.target !== undefined
              ? describeTarget(step.target)
              : step.type === "press"
                ? step.key
                : step.type === "wait"
                  ? step.condition.kind === "element"
                    ? `${describeTarget(step.condition.target)} ${step.condition.state}`
                    : step.condition.kind
                  : "";
        lines.push(`STEP ${pad(event.payload.stepIndex)} ${step.type.toUpperCase()} ${what}`.trimEnd());
        break;
      }
      case "ACTION_FAILED":
        lines.push(`        ERROR  ${firstLine(event.payload.error.message)}`);
        break;
      case "ASSERTION_STARTED":
        lines.push(`STEP ${pad(event.payload.stepIndex)} ${event.payload.purpose === "anchor" ? "ANCHOR" : "EXPECT"} ${event.payload.description || engineText(assertionMessage(event.payload.assertion), describeAssertion(event.payload.assertion))}`);
        break;
      case "ASSERTION_PASSED":
        lines.push("        PASS");
        break;
      case "ASSERTION_FAILED":
        lines.push("        FAIL");
        lines.push(`        ${t("common.expectedValue", { value: JSON.stringify(event.payload.expected) })}`);
        lines.push(`        ${t("common.actualValue", { value: JSON.stringify(event.payload.actual) })}`);
        break;
      case "ASSERTION_TIMEOUT":
        lines.push(`        TIMEOUT  ${event.payload.timeoutReason}: ${event.payload.message}`);
        break;
      case "ASSERTION_ERROR":
        lines.push(`        ERROR  ${event.payload.errorKind}: ${event.payload.message}`);
        break;
      default:
        break;
    }
  }
  return lines;
}

function pad(step: number | undefined): string {
  return String(step ?? "?").padEnd(3);
}

export function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

/**
 * Static semantic validation before `run` / `reproduce` (no preflight). A plan
 * the adapter cannot execute, or that is structurally wrong, is refused
 * before any browser starts. Returns the exit code when refused.
 */
export function rejectUnexecutable(io: CliIo, plan: TestPlan): number | undefined {
  const validation = validatePlan(plan, { descriptor: createAdapter(false).descriptor, mode: "execution" });
  if (validation.status !== "unsupported" && validation.status !== "invalid") return undefined;
  const out = printer(io);
  out("EXEGEZIS");
  out();
  out(t("common.rejected", { id: plan.id, status: validation.status === "unsupported" ? "UNSUPPORTED" : "INVALID" }));
  for (const line of validationLines(validation)) out(`  ${line}`);
  return validation.status === "unsupported" ? EXIT.unsupported : EXIT.invalidPlan;
}

/** The issues of a validation, one per line, in the current language (codes and severities as they are). */
export function validationLines(validation: Pick<PlanValidation, "issues">): string[] {
  return validation.issues.map((i) => `${i.severity.toUpperCase().padEnd(11)} ${i.code}${i.stepIndex === undefined ? "" : ` ${t("common.stepParen", { step: String(i.stepIndex) })}`}: ${engineText(i.detail, i.message)}`);
}

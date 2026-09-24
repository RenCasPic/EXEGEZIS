import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BrowserAdapter } from "@exegezis/adapter-browser";
import {
  executeRun,
  JsonlFileSink,
  Logger,
  Plan,
  RUN_FILES,
  RunRecorder,
  StreamSink,
  type CollectorStatus,
  type RunOutcome,
  type TimelineEvent,
} from "@exegezis/core";
import { UsageError } from "./args.js";

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: NodeJS.WritableStream;
  cwd: string;
}

export interface ObserveOptions {
  url: string;
  output: string;
  actionsFile?: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** Builds the plan for `observe`: load the page, run optional actions, observe. */
export async function buildObservePlan(url: string, actionsFile: string | undefined, cwd: string): Promise<Plan> {
  if (actionsFile === undefined) {
    return {
      schemaVersion: "exegezis.plan/v1",
      name: "observe",
      steps: [{ type: "navigate", url }, { type: "observe", label: "page" }],
    };
  }
  const path = isAbsolute(actionsFile) ? actionsFile : resolve(cwd, actionsFile);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(`Cannot read actions file ${actionsFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = Plan.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(`Invalid actions file ${actionsFile}:\n${issues}`);
  }
  return {
    ...result.data,
    steps: [{ type: "navigate", url }, ...result.data.steps, { type: "observe", label: "final" }],
  };
}

export async function observeCommand(options: ObserveOptions, io: CliIo): Promise<number> {
  const out = (line = ""): void => void io.stdout.write(`${line}\n`);
  // Validate everything that can be validated before creating a run directory.
  const plan = await buildObservePlan(options.url, options.actionsFile, io.cwd);
  const adapter = new BrowserAdapter({ headless: !options.headed });

  const outputDir = isAbsolute(options.output) ? options.output : resolve(io.cwd, options.output);
  const recorder = await RunRecorder.create({ outputDir });
  const sinks = [new JsonlFileSink(join(recorder.dir, RUN_FILES.log))];
  const logger = new Logger(options.verbose ? [...sinks, new StreamSink(io.stderr, "debug")] : sinks, { runId: recorder.runId });

  out("EXEGEZIS");
  out();
  out("Target:");
  out(options.url);
  out();
  out("Run:");
  out(recorder.runId);
  out();
  out("Collecting evidence...");
  out();

  const outcome = await executeRun({
    adapter,
    plan,
    target: { kind: "web", url: options.url },
    recorder,
    logger,
    command: "observe",
    exegezisVersion: options.exegezisVersion,
  });

  for (const line of summarize(outcome, recorder.timeline)) out(line);
  out();
  if (outcome.status === "completed") {
    out("Run completed.");
  } else {
    const error = outcome.metadata.error;
    out(`Run failed during ${error?.phase ?? "unknown phase"}: ${firstLine(error?.message ?? "unknown error")}`);
    out("Evidence captured up to the failure was kept.");
  }
  out();
  out("Artifacts:");
  out(displayPath(io.cwd, recorder.dir));
  return outcome.status === "completed" ? 0 : 1;
}

const COLLECTOR_LABELS: [key: string, label: string][] = [
  ["browser", "Browser"],
  ["console", "Console"],
  ["network", "Network"],
  ["accessibility", "Accessibility"],
  ["screenshots", "Screenshot"],
  ["trace", "Trace"],
];

function summarize(outcome: RunOutcome, events: readonly TimelineEvent[]): string[] {
  const count = (type: TimelineEvent["type"], noun: string): string => {
    const n = events.filter((e) => e.type === type).length;
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
  };
  const details: Record<string, string> = {
    browser: outcome.metadata.environment?.browser === undefined
      ? ""
      : `chromium ${outcome.metadata.environment.browser.version}`,
    console: `${count("CONSOLE_MESSAGE", "message")}, ${count("PAGE_ERROR", "page error")}`,
    network: `${count("NETWORK_REQUEST", "request")}, ${count("NETWORK_FAILED", "failure")}`,
    accessibility: count("ACCESSIBILITY_SNAPSHOT", "snapshot"),
    screenshots: count("SCREENSHOT", "screenshot"),
    trace: "trace.zip",
  };
  return COLLECTOR_LABELS.map(([key, label]) => {
    const status: CollectorStatus | undefined = outcome.metadata.collectors[key];
    const mark = status?.status === "ok" ? "✓" : status?.status === "skipped" ? "-" : "✗";
    const detail = status?.status === "ok" ? details[key] : (status?.detail ?? "not captured");
    return `${mark} ${label.padEnd(14)} ${detail ?? ""}`.trimEnd();
  });
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

function displayPath(cwd: string, dir: string): string {
  const rel = relative(cwd, dir);
  const shown = rel === "" || rel.startsWith("..") || isAbsolute(rel) ? dir : `./${rel}`;
  return `${shown.replaceAll("\\", "/")}/`;
}

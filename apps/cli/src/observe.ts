import { readFile } from "node:fs/promises";
import {
  executeRun,
  Plan,
  RunRecorder,
  toTestPlan,
  type CollectorStatus,
  type RunOutcome,
  type TestPlan,
  type TimelineEvent,
} from "@exegezis/core";
import { EXIT, UsageError } from "./args.js";
import { absolute, createAdapter, displayPath, firstLine, printer, runLogger, type CliIo } from "./shared.js";

export interface ObserveOptions {
  url: string;
  output: string;
  actionsFile?: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** Builds the plan for `observe`: load the page, run optional actions, observe. */
export async function buildObservePlan(url: string, actionsFile: string | undefined, io: Pick<CliIo, "cwd">): Promise<TestPlan> {
  if (actionsFile === undefined) {
    return toTestPlan(
      { schemaVersion: "exegezis.plan/v1", name: "observe", steps: [{ type: "navigate", url }, { type: "observe", label: "page" }] },
      url,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(absolute(io, actionsFile), "utf8"));
  } catch (error) {
    throw new UsageError(`Cannot read actions file ${actionsFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = Plan.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(`Invalid actions file ${actionsFile}:\n${issues}`);
  }
  return toTestPlan(
    { ...result.data, steps: [{ type: "navigate", url }, ...result.data.steps, { type: "observe", label: "final" }] },
    url,
  );
}

export async function observeCommand(options: ObserveOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  // Validate everything that can be validated before creating a run directory.
  const plan = await buildObservePlan(options.url, options.actionsFile, io);
  const adapter = createAdapter(options.headed);
  const recorder = await RunRecorder.create({ outputDir: absolute(io, options.output) });

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
    recorder,
    logger: runLogger(io, recorder, options.verbose),
    command: "observe",
    exegezisVersion: options.exegezisVersion,
  });

  for (const line of summarizeCollectors(outcome, recorder.timeline)) out(line);
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
  out(displayPath(io, recorder.dir));
  return outcome.status === "completed" ? EXIT.ok : EXIT.inconclusive;
}

const COLLECTOR_LABELS: [key: string, label: string][] = [
  ["browser", "Browser"],
  ["console", "Console"],
  ["network", "Network"],
  ["accessibility", "Accessibility"],
  ["screenshots", "Screenshot"],
  ["trace", "Trace"],
];

export function summarizeCollectors(outcome: RunOutcome, events: readonly TimelineEvent[]): string[] {
  const count = (type: TimelineEvent["type"], noun: string): string => {
    const n = events.filter((e) => e.type === type).length;
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
  };
  const details: Record<string, string> = {
    browser: outcome.metadata.environment?.browser === undefined ? "" : `chromium ${outcome.metadata.environment.browser.version}`,
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

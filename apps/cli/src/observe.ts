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
import { t } from "./i18n.js";

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
    throw new UsageError(t("observe.cannotRead", { file: actionsFile, message: error instanceof Error ? error.message : String(error) }));
  }
  const result = Plan.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(t("observe.invalid", { file: actionsFile, issues }));
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
  out(t("common.target"));
  out(options.url);
  out();
  out(t("common.run"));
  out(recorder.runId);
  out();
  out(t("observe.collecting"));
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
    out(t("observe.completed"));
  } else {
    const error = outcome.metadata.error;
    out(t("observe.failed", { phase: error?.phase ?? t("common.unknownPhase"), message: firstLine(error?.message ?? t("common.unknownError")) }));
    out(t("observe.kept"));
  }
  out();
  out(t("common.artifacts"));
  out(displayPath(io, recorder.dir));
  return outcome.status === "completed" ? EXIT.ok : EXIT.inconclusive;
}

const COLLECTORS = ["browser", "console", "network", "accessibility", "screenshots", "trace"] as const;

export function summarizeCollectors(outcome: RunOutcome, events: readonly TimelineEvent[]): string[] {
  const count = (type: TimelineEvent["type"]): number => events.filter((e) => e.type === type).length;
  const details: Record<string, string> = {
    browser: outcome.metadata.environment?.browser === undefined ? "" : `chromium ${outcome.metadata.environment.browser.version}`,
    console: t("observe.consoleCount", { messages: count("CONSOLE_MESSAGE"), errors: count("PAGE_ERROR") }),
    network: t("observe.networkCount", { requests: count("NETWORK_REQUEST"), failures: count("NETWORK_FAILED") }),
    accessibility: t("observe.snapshots", { count: count("ACCESSIBILITY_SNAPSHOT") }),
    screenshots: t("observe.screenshots", { count: count("SCREENSHOT") }),
    trace: "trace.zip",
  };
  return COLLECTORS.map((key) => {
    const status: CollectorStatus | undefined = outcome.metadata.collectors[key];
    const mark = status?.status === "ok" ? "✓" : status?.status === "skipped" ? "-" : "✗";
    const detail = status?.status === "ok" ? details[key] : (status?.detail ?? t("observe.notCaptured"));
    return `${mark} ${t(`observe.collector.${key}`).padEnd(14)} ${detail ?? ""}`.trimEnd();
  });
}

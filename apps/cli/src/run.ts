import { executeRun, RunRecorder } from "@exegezis/core";
import { EXIT } from "./args.js";
import { t } from "./i18n.js";
import { absolute, createAdapter, displayPath, firstLine, loadTestPlan, printer, rejectUnexecutable, renderSteps, runLogger, type CliIo } from "./shared.js";

export interface RunOptions {
  planFile: string;
  baseUrl?: string;
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** `exegezis run`: execute a test plan once, step by step, with evidence. */
export async function runCommand(options: RunOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const { plan } = await loadTestPlan(io, options.planFile);
  const rejected = rejectUnexecutable(io, plan);
  if (rejected !== undefined) return rejected;
  const recorder = await RunRecorder.create({ outputDir: absolute(io, options.output) });

  out("EXEGEZIS");
  out();
  out(t("run.plan", { id: plan.id, title: plan.title }));
  out(t("common.targetLine", { url: options.baseUrl ?? plan.target.baseUrl }));
  out(t("run.run", { id: recorder.runId }));
  out();
  out("PLAN_STARTED");
  out();

  const outcome = await executeRun({
    adapter: createAdapter(options.headed),
    plan,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    recorder,
    logger: runLogger(io, recorder, options.verbose),
    command: "run",
    exegezisVersion: options.exegezisVersion,
  });

  for (const line of renderSteps(outcome.timeline)) out(line);
  out();
  const { assertions } = outcome.metadata;
  const counts =
    assertions === undefined
      ? ""
      : t("run.counts", { passed: assertions.passed, failed: assertions.failed, timedOut: assertions.timedOut, errored: assertions.errored, notRun: assertions.notRun });
  switch (outcome.verdict) {
    case "passed":
      out(`PLAN_PASSED${counts}`);
      break;
    case "failed":
      out(t("run.failedAt", { step: String(outcome.stoppedAtStep ?? "?"), counts }));
      out(t("run.failedExplain"));
      out(t("run.failedNotProof"));
      break;
    case "timeout":
      out(t("run.timeoutAt", { step: String(outcome.stoppedAtStep ?? "?"), counts }));
      out(t("run.timeoutExplain"));
      break;
    case "error":
      out(t("run.errorAt", { step: String(outcome.stoppedAtStep ?? "?"), counts }));
      out(t("run.errorExplain", { message: firstLine(outcome.metadata.error?.message ?? t("common.unknownError")) }));
      out(t("run.errorNotProof"));
      break;
    case "no_assertions":
      out(t("run.noAssertions"));
      break;
  }
  out();
  out(t("common.artifacts"));
  out(displayPath(io, recorder.dir));
  return outcome.verdict === "passed" || outcome.verdict === "no_assertions"
    ? EXIT.ok
    : outcome.verdict === "failed"
      ? EXIT.expectationFailed
      : EXIT.inconclusive;
}

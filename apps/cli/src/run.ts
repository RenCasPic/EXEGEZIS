import { executeRun, RunRecorder } from "@exegezis/core";
import { EXIT } from "./args.js";
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
  out(`Plan:    ${plan.id} — ${plan.title}`);
  out(`Target:  ${options.baseUrl ?? plan.target.baseUrl}`);
  out(`Run:     ${recorder.runId}`);
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
      : ` (${assertions.passed} passed, ${assertions.failed} failed, ${assertions.timedOut} timed out, ${assertions.errored} errors, ${assertions.notRun} not run)`;
  switch (outcome.verdict) {
    case "passed":
      out(`PLAN_PASSED${counts}`);
      break;
    case "failed":
      out(`PLAN_FAILED at step ${outcome.stoppedAtStep ?? "?"}${counts}`);
      out("An expectation was evaluated and did not hold (expected != actual).");
      out("That alone does not prove a bug: `exegezis verify` decides that.");
      break;
    case "timeout":
      out(`PLAN_TIMEOUT at step ${outcome.stoppedAtStep ?? "?"}${counts}`);
      out("An assertion reached its timeout without a conclusion: this is not evidence of a bug.");
      break;
    case "error":
      out(`PLAN_ERROR at step ${outcome.stoppedAtStep ?? "?"}${counts}`);
      out(`The plan could not be evaluated: ${firstLine(outcome.metadata.error?.message ?? "unknown error")}`);
      out("This is not evidence of a bug (wrong selector, unreachable app, timeout...).");
      break;
    case "no_assertions":
      out("PLAN_COMPLETED (no assertions: nothing to conclude)");
      break;
  }
  out();
  out("Artifacts:");
  out(displayPath(io, recorder.dir));
  return outcome.verdict === "passed" || outcome.verdict === "no_assertions"
    ? EXIT.ok
    : outcome.verdict === "failed"
      ? EXIT.expectationFailed
      : EXIT.inconclusive;
}

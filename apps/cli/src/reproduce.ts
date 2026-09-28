import { join } from "node:path";
import { reproducePlan, ulid, type ReproductionAttempt, type ReproductionResult, type TestPlan } from "@exegezis/core";
import { EXIT } from "./args.js";
import { engineText, t } from "./i18n.js";
import { absolute, createAdapter, displayPath, loadTestPlan, percent, printer, rejectUnexecutable, runLogger, type CliIo } from "./shared.js";

export interface ReproduceOptions {
  planFile: string;
  baseUrl?: string;
  runs: number;
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** Runs the reproduction loop, printing one line per attempt as it completes. */
export async function reproduceWithProgress(
  io: CliIo,
  plan: TestPlan,
  options: Omit<ReproduceOptions, "planFile" | "output"> & { dir: string; command: string; quiet?: boolean },
): Promise<ReproductionResult> {
  const out = printer(io);
  return reproducePlan({
    plan,
    attempts: options.runs,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    dir: options.dir,
    createAdapter: () => createAdapter(options.headed),
    createLogger: (recorder) => runLogger(io, recorder, options.verbose),
    command: options.command,
    exegezisVersion: options.exegezisVersion,
    onAttempt: (attempt) => {
      if (options.quiet !== true) out(formatAttempt(attempt, options.runs));
    },
  });
}

export function formatAttempt(attempt: ReproductionAttempt, total: number): string {
  const n = `#${attempt.attempt}`.padEnd(String(total).length + 1);
  const verdict = attempt.verdict.toUpperCase().padEnd(13);
  const detail =
    attempt.verdict === "failed"
      ? t("reproduce.step", { step: String(attempt.stoppedAtStep ?? "?") })
      : attempt.verdict === "error" || attempt.verdict === "timeout"
        ? t("reproduce.stepDetail", { step: String(attempt.stoppedAtStep ?? "?"), detail: attempt.error ?? "" })
        : "";
  return `  ${n}  ${attempt.runId}  ${verdict} ${detail}`.trimEnd();
}

export function formatReproduction(result: ReproductionResult): string[] {
  const r = result.reproduction;
  return [
    t("reproduce.runs", { n: String(r.attempts).padStart(3) }),
    t("reproduce.passed", { n: String(r.passes).padStart(3) }),
    t("reproduce.failed", { n: String(r.failures).padStart(3) }),
    t("reproduce.timeouts", { n: String(r.timeouts).padStart(3) }),
    t("reproduce.errors", { n: String(r.errors).padStart(3) }),
    t("reproduce.rate", { n: percent(r.rate).padStart(4) }),
    "",
    t("reproduce.result", { status: r.status }),
    engineText(r.message, r.reason),
  ];
}

/** `exegezis reproduce`: execute a plan N times in isolation and classify the outcome. */
export async function reproduceCommand(options: ReproduceOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const { plan } = await loadTestPlan(io, options.planFile);
  const rejected = rejectUnexecutable(io, plan);
  if (rejected !== undefined) return rejected;
  const dir = join(absolute(io, options.output), "reproductions", `${ulid()}-${plan.id}`);

  out("EXEGEZIS");
  out();
  out(t("reproduce.title", { id: plan.id, title: plan.title }));
  out(t("reproduce.target", { url: options.baseUrl ?? plan.target.baseUrl }));
  out();
  const result = await reproduceWithProgress(io, plan, { ...options, dir, command: "reproduce" });
  out();
  for (const line of formatReproduction(result)) out(line);
  out();
  out(t("common.artifacts"));
  out(displayPath(io, dir));

  switch (result.reproduction.status) {
    case "REPRODUCED":
    case "NOT_REPRODUCED":
      return EXIT.ok;
    case "FLAKY":
      return EXIT.expectationFailed;
    default:
      return EXIT.inconclusive;
  }
}

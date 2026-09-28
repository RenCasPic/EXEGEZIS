import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCompiledSpec } from "@exegezis/compiler-playwright";
import {
  buildBugReport,
  buildReproduction,
  runPreflight,
  validatePlan,
  VerificationPolicy,
  type BugReport,
  type CompiledTestExecution,
  type PlanValidation,
  type PreflightResult,
  type ReproductionResult,
} from "@exegezis/core";
import { writeCompiledSpec } from "./compile.js";
import { reproduceWithProgress } from "./reproduce.js";
import { createAdapter, printer, runLogger, type CliIo, type LoadedPlan } from "./shared.js";
import { t } from "./i18n.js";

export const BUG_REPORT_FILE = "bug-report.json";

function browserUsed(reproduction: ReproductionResult): { browserChannel?: "chromium" | "chrome" | "msedge" } {
  const channel = reproduction.outcomes.find((o) => o.metadata.environment?.browser?.channel !== undefined)?.metadata.environment?.browser?.channel;
  return channel === undefined ? {} : { browserChannel: channel };
}
export const VALIDATION_FILE = "validation.json";

export interface PipelineOptions {
  runs: number;
  baseUrl?: string;
  /** Verification directory (created). */
  dir: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
  /** Print progress lines (verify) or stay quiet (benchmark prints its own). */
  progress: boolean;
  /** A preflight already taken for this target (e.g. by the planner): not repeated. */
  preflight?: PreflightResult;
}

export interface PipelineResult {
  dir: string;
  report: BugReport;
  validation: PlanValidation;
  reproduction: ReproductionResult | undefined;
  specPath: string | undefined;
}

/**
 * The verification pipeline:
 *
 *   preflight observation → semantic validation ─┬─ invalid / unsupported → report (not executed)
 *                                                 └─ reproduce → compile → Playwright runs the spec → report
 *
 * An invalid or unsupported plan is never executed: its failures could only
 * be failures of the plan.
 */
export async function verifyPlan(io: CliIo, loaded: LoadedPlan, options: PipelineOptions): Promise<PipelineResult> {
  const out = options.progress ? printer(io) : () => undefined;
  const { plan } = loaded;
  const baseUrl = options.baseUrl ?? plan.target.baseUrl;
  await mkdir(options.dir, { recursive: true });

  if (options.preflight === undefined) out(t("pipeline.preflight"));
  const preflight = options.preflight ?? await runPreflight({
    plan,
    baseUrl,
    adapter: createAdapter(options.headed),
    outputDir: join(options.dir, "preflight"),
    createLogger: (recorder) => runLogger(io, recorder, options.verbose),
    exegezisVersion: options.exegezisVersion,
  });
  const validation = validatePlan(plan, {
    descriptor: createAdapter(false).descriptor,
    mode: "verification",
    reference: preflight.pages,
    baseUrl,
  });
  await writeFile(join(options.dir, VALIDATION_FILE), `${JSON.stringify(validation, null, 2)}\n`, "utf8");
  out(validation.issues.length === 0 ? t("pipeline.validation", { status: validation.status.toUpperCase() }) : t("pipeline.validationIssues", { status: validation.status.toUpperCase(), count: validation.issues.length }));

  const executable = validation.status === "valid" || validation.status === "weakly_anchored";
  let reproduction: ReproductionResult | undefined;
  let compiledTest: CompiledTestExecution | undefined;
  let specPath: string | undefined;

  if (executable) {
    out(t("pipeline.reproducing", { runs: options.runs }));
    reproduction = await reproduceWithProgress(io, plan, {
      runs: options.runs,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      headed: options.headed,
      verbose: options.verbose,
      exegezisVersion: options.exegezisVersion,
      dir: options.dir,
      command: "verify",
      quiet: !options.progress,
    });
    out(t("pipeline.compiling"));
    const compiled = await writeCompiledSpec(loaded, options.dir, options.exegezisVersion);
    specPath = compiled.path;
    const execution = await runCompiledSpec({
      specPath,
      steps: compiled.spec.steps,
      baseUrl,
      outputDir: join(options.dir, "compiled-test-results"),
      // The spec runs in the same browser the reproduction used (e.g. system Edge).
      ...browserUsed(reproduction),
    });
    compiledTest = { ...execution, specPath: compiled.spec.fileName };
  } else {
    out(t("pipeline.notExecuted"));
  }

  const report = buildBugReport({
    plan,
    planPath: loaded.path,
    planHash: loaded.hash,
    validation,
    reproduction:
      reproduction?.reproduction ??
      buildReproduction({
        planId: plan.id,
        planHash: loaded.hash,
        planProvenance: plan.provenance,
        targetUrl: baseUrl,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        runs: [],
      }),
    reproductionPath: ".",
    outcomes: reproduction?.outcomes ?? [],
    ...(compiledTest === undefined ? {} : { compiledTest }),
    policy: VerificationPolicy.parse({}),
    exegezisVersion: options.exegezisVersion,
  });
  await writeFile(join(options.dir, BUG_REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { dir: options.dir, report, validation, reproduction, specPath };
}

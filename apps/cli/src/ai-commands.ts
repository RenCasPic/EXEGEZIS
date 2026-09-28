import { join } from "node:path";
import { ulid, validatePlan } from "@exegezis/core";
import type { PlanGenerationResult } from "@exegezis/planner";
import {
  createPlanner,
  describeGeneration,
  exampleDirsFromSuite,
  generateForSymptom,
  loadExamples,
  preflightFor,
  type PlannerOptions,
} from "./ai.js";
import { EXIT } from "./args.js";
import { verifyPlan } from "./pipeline.js";
import { absolute, createAdapter, displayPath, loadTestPlan, printer, validationLines, type CliIo } from "./shared.js";
import { exitForOutcome, formatReport } from "./verify.js";
import { t } from "./i18n.js";

export interface AiOptions extends PlannerOptions {
  symptom: string;
  baseUrl: string;
  /** Suite whose solved cases are shown to the planner as examples (none by default). */
  examples?: string;
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** Exit code when the planner produced no executable plan. */
function exitForGeneration(result: PlanGenerationResult): number {
  switch (result.status) {
    case "generated":
      return EXIT.ok;
    case "declined":
      return EXIT.inconclusive;
    case "invalid_generation":
      return EXIT.invalidPlan;
    case "error":
      return result.kind === "configuration" ? EXIT.usage : EXIT.internal;
  }
}

function plannerLine(result: PlanGenerationResult, requested: PlannerOptions): string {
  if (result.status === "error") return `${requested.planner}${requested.model === undefined ? "" : ` / ${requested.model}`}`;
  return t("aicmd.plannerLine", { provider: result.meta.provider, model: result.meta.model, prompt: result.meta.promptVersion, examples: result.meta.examples });
}

function usageLine(result: PlanGenerationResult): string | undefined {
  if (result.status === "error") return undefined;
  const usage = result.meta.usage;
  const tokens = usage === null ? t("aicmd.tokensNa") : t("aicmd.tokens", { input: String(usage.inputTokens), output: String(usage.outputTokens) });
  return t("aicmd.usage", { ms: String(result.meta.latencyMs), tokens, redactions: String(result.meta.redactions) });
}

/**
 * `exegezis generate-plan`: symptom → planner → TestPlan → validation. The
 * plan is written to disk and NOT executed.
 */
export async function generatePlanCommand(options: AiOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const planner = await createPlanner(io, options);
  const dir = join(absolute(io, options.output), "generated-plans", ulid());

  out(t("aicmd.titleGenerate"));
  out();
  out(t("aicmd.symptom"));
  out(options.symptom);
  out();
  out(t("aicmd.target", { url: options.baseUrl }));
  const preflight = await preflightFor(io, options.baseUrl, dir, options);
  const examples = options.examples === undefined ? [] : await loadExamples(await exampleDirsFromSuite(io, options.examples), null);
  const { result, planPath } = await generateForSymptom(planner, { symptom: options.symptom, baseUrl: options.baseUrl, preflight, examples }, dir);

  out(t("aicmd.plannerInline", { line: plannerLine(result, options) }));
  const usage = usageLine(result);
  if (usage !== undefined) out(usage);
  out();
  out(t("aicmd.generatedPlan"));
  out(describeGeneration(result));
  if (result.status !== "generated" || planPath === undefined) {
    out();
    out(t("aicmd.output"));
    out(displayPath(io, dir));
    return exitForGeneration(result);
  }

  const validation = validatePlan(result.plan, {
    descriptor: createAdapter(false).descriptor,
    mode: "verification",
    reference: preflight.pages,
    baseUrl: options.baseUrl,
  });
  const steps = result.plan.steps;
  out();
  out(t("aicmd.planId", { id: result.plan.id }));
  out(t("aicmd.title", { title: result.plan.title }));
  out(t("aicmd.steps", { count: String(steps.length) }));
  out(
    t("aicmd.assertions", {
      count: String(steps.filter((s) => s.type === "assert").length),
      anchors: String(steps.filter((s) => s.type === "assert" && s.purpose === "anchor").length),
      expectations: String(steps.filter((s) => s.type === "assert" && s.purpose === "expectation").length),
    }),
  );
  out(t("aicmd.provenance", { value: `${result.provenance.source} / ${result.provenance.generator ?? "?"} / ${result.provenance.model ?? "?"}` }));
  out(t("aicmd.prompt", { value: result.provenance.promptVersion ?? "?" }));
  out();
  out(t("aicmd.validation", { status: validation.status.toUpperCase() }));
  for (const line of validationLines(validation)) out(`  ${line}`);
  out();
  out(t("aicmd.notExecuted"));
  out(`  exegezis verify --plan ${displayPath(io, planPath, false)}`);
  switch (validation.status) {
    case "valid":
      return EXIT.ok;
    case "weakly_anchored":
      return EXIT.expectationFailed;
    case "invalid":
      return EXIT.invalidPlan;
    case "unsupported":
      return EXIT.unsupported;
  }
}

export interface AiVerifyOptions extends AiOptions {
  runs: number;
}

/**
 * `exegezis ai-verify`: symptom → planner (one call) → TestPlan → the same
 * verification pipeline as `verify`. The planner proposes; only the engine
 * decides. Nothing the model says is read as evidence.
 */
export async function aiVerifyCommand(options: AiVerifyOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const planner = await createPlanner(io, options);
  const dir = join(absolute(io, options.output), "ai-verifications", ulid());

  out(t("aicmd.titleVerify"));
  out();
  out(t("aicmd.symptom"));
  out(options.symptom);
  out();
  out(t("aicmd.target", { url: options.baseUrl }));
  const preflight = await preflightFor(io, options.baseUrl, dir, options);
  const examples = options.examples === undefined ? [] : await loadExamples(await exampleDirsFromSuite(io, options.examples), null);
  const { result, planPath } = await generateForSymptom(planner, { symptom: options.symptom, baseUrl: options.baseUrl, preflight, examples }, dir);

  out();
  out(t("aicmd.planner"));
  out(plannerLine(result, options));
  const usage = usageLine(result);
  if (usage !== undefined) out(usage);
  out();
  out(t("aicmd.plan"));
  out(describeGeneration(result));
  if (result.status !== "generated" || planPath === undefined) {
    out();
    out(t("aicmd.verdict"));
    const verdict = result.status === "declined" ? "INCONCLUSIVE" : result.status === "invalid_generation" ? "INVALID_PLAN" : "NOT RUN";
    out(verdict);
    out();
    out(t("aicmd.reason"));
    out(result.status === "declined" ? t("aicmd.reasonDeclined") : result.status === "invalid_generation" ? t("aicmd.reasonInvalid") : t("aicmd.reasonNone"));
    out();
    out(t("aicmd.output"));
    out(displayPath(io, dir));
    return exitForGeneration(result);
  }

  out(t("aicmd.planSummary", { id: result.plan.id, title: result.plan.title, steps: result.plan.steps.length }));
  out();
  out(t("aicmd.verification"));
  const loaded = await loadTestPlan(io, planPath);
  const verification = await verifyPlan(io, loaded, {
    runs: options.runs,
    baseUrl: options.baseUrl,
    dir,
    headed: options.headed,
    verbose: options.verbose,
    exegezisVersion: options.exegezisVersion,
    progress: true,
    preflight,
  });
  out();
  for (const line of formatReport(verification.report)) out(line);
  out();
  out(t("aicmd.output"));
  out(displayPath(io, dir));
  return exitForOutcome(verification.report.outcome);
}

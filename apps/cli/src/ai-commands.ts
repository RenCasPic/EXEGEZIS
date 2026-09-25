import { join } from "node:path";
import { describeValidation, ulid, validatePlan } from "@exegezis/core";
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
import { absolute, createAdapter, displayPath, loadTestPlan, printer, type CliIo } from "./shared.js";
import { exitForOutcome, formatReport } from "./verify.js";

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
  return `${result.meta.provider} / ${result.meta.model} (prompt ${result.meta.promptVersion}, ${result.meta.examples} example(s))`;
}

function usageLine(result: PlanGenerationResult): string | undefined {
  if (result.status === "error") return undefined;
  const usage = result.meta.usage;
  const tokens = usage === null ? "tokens: n/a" : `tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`;
  return `latency: ${result.meta.latencyMs} ms, ${tokens}, redacted from input: ${result.meta.redactions}`;
}

/**
 * `exegezis generate-plan`: symptom → planner → TestPlan → validation. The
 * plan is written to disk and NOT executed.
 */
export async function generatePlanCommand(options: AiOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const planner = await createPlanner(io, options);
  const dir = join(absolute(io, options.output), "generated-plans", ulid());

  out("EXEGEZIS GENERATE PLAN");
  out();
  out("Symptom:");
  out(options.symptom);
  out();
  out(`Target: ${options.baseUrl}`);
  const preflight = await preflightFor(io, options.baseUrl, dir, options);
  const examples = options.examples === undefined ? [] : await loadExamples(await exampleDirsFromSuite(io, options.examples), null);
  const { result, planPath } = await generateForSymptom(planner, { symptom: options.symptom, baseUrl: options.baseUrl, preflight, examples }, dir);

  out(`Planner: ${plannerLine(result, options)}`);
  const usage = usageLine(result);
  if (usage !== undefined) out(usage);
  out();
  out("Generated TestPlan:");
  out(describeGeneration(result));
  if (result.status !== "generated" || planPath === undefined) {
    out();
    out("Output:");
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
  out(`Plan ID:       ${result.plan.id}`);
  out(`Title:         ${result.plan.title}`);
  out(`Steps:         ${steps.length}`);
  out(`Assertions:    ${steps.filter((s) => s.type === "assert").length} (${steps.filter((s) => s.type === "assert" && s.purpose === "anchor").length} anchor, ${steps.filter((s) => s.type === "assert" && s.purpose === "expectation").length} expectation)`);
  out(`Provenance:    ${result.provenance.source} / ${result.provenance.generator ?? "?"} / ${result.provenance.model ?? "?"}`);
  out(`Prompt:        ${result.provenance.promptVersion ?? "?"}`);
  out();
  out(`Semantic validation: ${validation.status.toUpperCase()}`);
  for (const line of describeValidation(validation)) out(`  ${line}`);
  out();
  out("The plan was not executed. Verify it with:");
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

  out("EXEGEZIS AI VERIFY");
  out();
  out("Symptom:");
  out(options.symptom);
  out();
  out(`Target: ${options.baseUrl}`);
  const preflight = await preflightFor(io, options.baseUrl, dir, options);
  const examples = options.examples === undefined ? [] : await loadExamples(await exampleDirsFromSuite(io, options.examples), null);
  const { result, planPath } = await generateForSymptom(planner, { symptom: options.symptom, baseUrl: options.baseUrl, preflight, examples }, dir);

  out();
  out("Planner:");
  out(plannerLine(result, options));
  const usage = usageLine(result);
  if (usage !== undefined) out(usage);
  out();
  out("Plan:");
  out(describeGeneration(result));
  if (result.status !== "generated" || planPath === undefined) {
    out();
    out("Verdict:");
    const verdict = result.status === "declined" ? "INCONCLUSIVE" : result.status === "invalid_generation" ? "INVALID_PLAN" : "NOT RUN";
    out(verdict);
    out();
    out("Reason:");
    out(
      result.status === "declined"
        ? "The planner could not turn the symptom into a testable plan; nothing was verified."
        : result.status === "invalid_generation"
          ? "The planner's answer is not a valid TestPlan; it was not repaired and not executed."
          : "No plan was generated.",
    );
    out();
    out("Output:");
    out(displayPath(io, dir));
    return exitForGeneration(result);
  }

  out(`${result.plan.id}: ${result.plan.title} (${result.plan.steps.length} steps)`);
  out();
  out("Verification (deterministic):");
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
  out("Output:");
  out(displayPath(io, dir));
  return exitForOutcome(verification.report.outcome);
}

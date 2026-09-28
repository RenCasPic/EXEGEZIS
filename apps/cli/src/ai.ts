import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BenchmarkCase, runPreflight, TestPlan, type PreflightResult } from "@exegezis/core";
import {
  createPlanGenerator,
  PROMPT,
  type MockResponse,
  type PlanExample,
  type PlanGenerationResult,
  type PlanGenerator,
  type ProviderName,
} from "@exegezis/planner";
import { UsageError } from "./args.js";
import { absolute, createAdapter, runLogger, type CliIo } from "./shared.js";
import { t } from "./i18n.js";

export const GENERATION_FILE = "generation.json";
export const GENERATED_PLAN_FILE = "plan.json";

export interface PlannerOptions {
  planner: ProviderName;
  model?: string;
  /** Mock planner: a file with the recorded model answer (raw JSON text). */
  mockResponse?: string;
}

/** Builds the planner. The mock replays a recorded answer; nothing is invented. */
export async function createPlanner(io: CliIo, options: PlannerOptions): Promise<PlanGenerator> {
  if (options.planner === "mock") {
    if (options.mockResponse === undefined) {
      throw new UsageError(t("ai.mockNeedsResponse"));
    }
    const answer = await readRecordedAnswer(absolute(io, options.mockResponse));
    return createPlanGenerator("mock", { mock: () => answer });
  }
  return createPlanGenerator("anthropic", options.model === undefined ? {} : { model: options.model });
}

export async function readRecordedAnswer(path: string): Promise<MockResponse> {
  try {
    return { text: await readFile(path, "utf8") };
  } catch (error) {
    throw new UsageError(t("ai.cannotReadAnswer", { path, message: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * Solved examples for the planner, from benchmark cases (symptom + human
 * plan). `excludeBug` removes every example about the bug under evaluation,
 * so a case never sees its own answer.
 */
export async function loadExamples(caseDirs: readonly string[], excludeBug: string | null): Promise<PlanExample[]> {
  const examples: PlanExample[] = [];
  for (const dir of caseDirs) {
    const spec = BenchmarkCase.parse(JSON.parse(await readFile(join(dir, "case.json"), "utf8")));
    if (spec.plan === undefined || spec.kind !== "positive") continue;
    if (excludeBug !== null && spec.expectedBug === excludeBug) continue;
    const plan = TestPlan.parse(JSON.parse(await readFile(join(dir, spec.plan), "utf8")));
    examples.push({ symptom: spec.symptom, plan });
  }
  return examples;
}

/** Example cases of a suite (`--examples buggy-shop` or a suite.json path). */
export async function exampleDirsFromSuite(io: CliIo, suite: string): Promise<string[]> {
  const suitePath = suite.endsWith(".json") ? absolute(io, suite) : absolute(io, join("benchmarks", suite, "suite.json"));
  let raw: { cases?: unknown };
  try {
    raw = JSON.parse(await readFile(suitePath, "utf8")) as { cases?: unknown };
  } catch (error) {
    throw new UsageError(t("ai.cannotReadSuite", { path: suitePath, message: error instanceof Error ? error.message : String(error) }));
  }
  if (!Array.isArray(raw.cases)) throw new UsageError(t("ai.noCases", { path: suitePath }));
  return raw.cases.map((c) => resolve(dirname(suitePath), String(c)));
}

export async function preflightFor(
  io: CliIo,
  baseUrl: string,
  dir: string,
  options: { headed: boolean; verbose: boolean; exegezisVersion: string },
): Promise<PreflightResult> {
  // The preflight only needs the start page: a one-step probe plan.
  return runPreflight({
    plan: TestPlan.parse({
      schemaVersion: "exegezis.test-plan/v1",
      id: "symptom-preflight",
      title: "Preflight of the application under test",
      target: { kind: "web", baseUrl },
      provenance: { source: "tool", generator: "exegezis-preflight" },
      steps: [{ type: "navigate", url: "/" }],
    }),
    baseUrl,
    adapter: createAdapter(options.headed),
    outputDir: join(dir, "preflight"),
    createLogger: (recorder) => runLogger(io, recorder, options.verbose),
    exegezisVersion: options.exegezisVersion,
  });
}

export interface GenerationOutcome {
  result: PlanGenerationResult;
  /** Where the generated plan was written, when there is one. */
  planPath: string | undefined;
}

/**
 * One planner call for one symptom. Everything it produced — plan, raw
 * answer, provenance, latency, tokens — is written to disk for audit.
 */
export async function generateForSymptom(
  planner: PlanGenerator,
  input: { symptom: string; baseUrl: string; preflight: PreflightResult; examples: PlanExample[]; planId?: string },
  dir: string,
): Promise<GenerationOutcome> {
  const descriptor = createAdapter(false).descriptor;
  const result = await planner.generate({
    symptom: input.symptom,
    target: { kind: "web", baseUrl: input.baseUrl },
    capabilities: { actions: descriptor.actions, assertions: descriptor.assertions },
    observations: input.preflight.pages.map((page) => ({ url: page.url, accessibility: page.accessibility })),
    examples: input.examples,
    ...(input.planId === undefined ? {} : { planId: input.planId }),
  });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, GENERATION_FILE), `${JSON.stringify({ promptVersion: PROMPT.version, ...result }, null, 2)}\n`, "utf8");
  if (result.status !== "generated") return { result, planPath: undefined };
  const planPath = join(dir, GENERATED_PLAN_FILE);
  await writeFile(planPath, `${JSON.stringify(result.plan, null, 2)}\n`, "utf8");
  return { result, planPath };
}

/** One line describing what the planner produced. */
export function describeGeneration(result: PlanGenerationResult): string {
  switch (result.status) {
    case "generated":
      return "PASS (schema-valid TestPlan)";
    case "declined":
      return `DECLINED — the planner could not write a plan: ${result.reason}`;
    case "invalid_generation":
      return `INVALID_GENERATION (${result.kind}): ${result.issues.slice(0, 3).join("; ")}`;
    case "error":
      return `${result.kind === "configuration" ? "CONFIGURATION ERROR" : "PROVIDER ERROR"}: ${result.message}`;
  }
}

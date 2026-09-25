import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  applyMutation,
  classifyAttempt,
  countAttempts,
  createWorkspace,
  decideRootCause,
  evaluatePrediction,
  evaluateRootCause,
  hashTree,
  hypothesisOutcome,
  rateOf,
  removeWorkspace,
  reproducePlan,
  RootCauseGroundTruth,
  RootCauseInvestigation,
  RootCauseReport,
  RootCauseSuite,
  RootCauseSuiteResult,
  baselineReproduced,
  ulid,
  type ArmAttempt,
  type CodeMutation,
  type Experiment,
  type ExperimentArm,
  type RootCauseSuiteCase,
  type TestPlan,
} from "@exegezis/core";
import { minimalEnv, startApp } from "./app-server.js";
import { EXIT, UsageError } from "./args.js";
import { absolute, createAdapter, displayPath, loadTestPlan, printer, type CliIo } from "./shared.js";

export const ROOT_CAUSE_REPORT_FILE = "root-cause-report.json";
export const ROOT_CAUSE_RESULT_FILE = "root-cause-result.json";
export const EVALUATION_FILE = "evaluation.json";

export interface RootCauseOptions {
  suite: string;
  runs?: number;
  caseIds?: string[];
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

async function readJson<T>(path: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, what: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Cannot read ${what}: ${path}`);
  }
  const result = schema.safeParse(JSON.parse(raw));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(`Invalid ${what} ${path}:\n${issues}`);
  }
  return result.data;
}

interface ArmContext {
  investigation: RootCauseInvestigation;
  plan: TestPlan;
  sourceDir: string;
  caseOut: string;
  runs: number;
  options: RootCauseOptions;
  log: (line: string) => void;
}

/**
 * One arm: a fresh copy of the application, optionally mutated, started with a
 * minimal environment, reproduced N times, then deleted. Only the arm's
 * reproduction artifacts and the mutation diff are kept.
 */
async function runArm(ctx: ArmContext, label: string, mutation: CodeMutation | null): Promise<ExperimentArm> {
  const armDir = join(ctx.caseOut, label === "baseline" ? "baseline" : join("experiments", label));
  const workspace = join(ctx.caseOut, "workspaces", label);
  await mkdir(armDir, { recursive: true });
  const empty = (error: string, applied: ExperimentArm["mutation"] = null): ExperimentArm => ({
    label: mutation === null ? "baseline" : "intervention",
    path: relative(ctx.caseOut, armDir).split("\\").join("/"),
    mutation: applied,
    counts: { runs: 0, reproduced: 0, notReproduced: 0, invalid: 0 },
    rate: 0,
    reproductionStatus: "NOT_RUN",
    attempts: [],
    error,
  });

  await createWorkspace(ctx.sourceDir, ctx.investigation.app.include, workspace);
  try {
    let applied: ExperimentArm["mutation"] = null;
    if (mutation !== null) {
      const result = await applyMutation(workspace, mutation);
      if (!result.ok) return empty(`mutation not applied: ${result.reason}`);
      applied = result.applied;
      await writeFile(join(armDir, "mutation.diff"), `${applied.diff}\n`, "utf8");
    }
    let app;
    try {
      app = await startApp(
        { command: ctx.investigation.app.command, cwd: workspace, portEnv: ctx.investigation.app.portEnv, healthPath: ctx.investigation.app.healthPath, env: minimalEnv() },
        `${ctx.investigation.bugId} ${label}`,
      );
    } catch (error) {
      return empty(`application did not start: ${error instanceof Error ? error.message : String(error)}`, applied);
    }
    try {
      const { reproduction, outcomes } = await reproducePlan({
        plan: ctx.plan,
        attempts: ctx.runs,
        baseUrl: app.baseUrl,
        dir: armDir,
        createAdapter: () => createAdapter(ctx.options.headed),
        command: `exegezis root-cause ${ctx.investigation.bugId} ${label}`,
        exegezisVersion: ctx.options.exegezisVersion,
        onAttempt: (a) => ctx.log(`    ${label} attempt ${a.attempt}/${ctx.runs}: ${a.verdict}${a.stoppedAtStep === undefined ? "" : ` at step ${a.stoppedAtStep}`}`),
      });
      const attempts: ArmAttempt[] = reproduction.runs.map((run, i) => {
        const failed = outcomes[i]?.assertions.find((a) => a.status === "failed");
        return {
          attempt: run.attempt,
          runId: run.runId,
          runPath: run.runPath,
          verdict: run.verdict,
          ...(run.stoppedAtStep === undefined ? {} : { stoppedAtStep: run.stoppedAtStep }),
          ...(run.failureSignature === undefined ? {} : { failureSignature: run.failureSignature }),
          classification: classifyAttempt({ verdict: run.verdict, failedPurpose: failed?.purpose }),
        };
      });
      const counts = countAttempts(attempts);
      return {
        label: mutation === null ? "baseline" : "intervention",
        path: relative(ctx.caseOut, armDir).split("\\").join("/"),
        mutation: applied,
        counts,
        rate: rateOf(counts),
        reproductionStatus: reproduction.status,
        attempts,
        error: null,
      };
    } finally {
      await app.stopAndWait();
    }
  } finally {
    // The mutated copy is discarded: nothing but the artifacts survives the experiment.
    await removeWorkspace(workspace);
  }
}

/**
 * Investigates one case. The engine reads investigation.json and the code
 * only; ground-truth.json is read afterwards, by the evaluator.
 */
export async function investigateCase(caseDir: string, caseOut: string, options: RootCauseOptions, io: CliIo, log: (line: string) => void) {
  const investigation = await readJson(join(caseDir, "investigation.json"), RootCauseInvestigation, "root-cause investigation");
  const planPath = resolve(caseDir, investigation.plan);
  const loaded = await loadTestPlan(io, planPath);
  const sourceDir = resolve(caseDir, investigation.app.dir);
  const policy = { ...investigation.policy, ...(options.runs === undefined ? {} : { runsPerArm: options.runs }) };
  const runs = policy.runsPerArm;
  await mkdir(caseOut, { recursive: true });

  const before = await hashTree(sourceDir, investigation.app.include);
  const ctx: ArmContext = { investigation, plan: loaded.plan, sourceDir, caseOut, runs, options, log };

  log(`  baseline (unmodified copy), ${runs} runs`);
  const baseline = await runArm(ctx, "baseline", null);
  log(`  baseline: ${baseline.counts.reproduced}/${baseline.counts.runs} reproduced${baseline.error === null ? "" : ` — ${baseline.error}`}`);

  const experiments: Experiment[] = [];
  const stable = baselineReproduced(baseline.counts, runs);
  for (const hypothesis of investigation.hypotheses) {
    if (!stable) break;
    const startedAt = new Date().toISOString();
    log(`  ${hypothesis.id}: ${hypothesis.intervention.description}`);
    const arm = await runArm(ctx, hypothesis.id, hypothesis.intervention);
    const result =
      arm.error !== null
        ? { status: "INCONCLUSIVE" as const, reason: arm.error }
        : evaluatePrediction(hypothesis.prediction, baseline.counts, arm.counts, policy);
    experiments.push({
      id: `EXP-${hypothesis.id}`,
      hypothesisId: hypothesis.id,
      intervention: hypothesis.intervention,
      prediction: hypothesis.prediction,
      baseline: baseline.counts,
      arm,
      delta: arm.rate - baseline.rate,
      result,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    log(`  ${hypothesis.id}: ${arm.counts.reproduced}/${arm.counts.runs} reproduced → ${result.status}`);
  }

  const outcomes = investigation.hypotheses.map((h) => {
    const experiment = experiments.find((e) => e.hypothesisId === h.id) ?? null;
    const outcome = hypothesisOutcome(h, experiment);
    return experiment === null && !stable ? { ...outcome, reason: "not tested: the baseline did not reproduce the bug in every run" } : outcome;
  });
  const decision = decideRootCause(baseline.counts, outcomes, policy);
  const after = await hashTree(sourceDir, investigation.app.include);

  const report = RootCauseReport.parse({
    schemaVersion: "exegezis.root-cause-report/v1",
    bugId: investigation.bugId,
    planId: loaded.plan.id,
    planPath: displayPath(io, planPath, false),
    policy,
    generatedAt: new Date().toISOString(),
    exegezisVersion: options.exegezisVersion,
    observations: investigation.observations,
    hypotheses: investigation.hypotheses,
    baseline,
    experiments,
    outcomes,
    decision,
    isolation: {
      sourceDir: displayPath(io, sourceDir, false),
      files: before.files,
      treeHashBefore: before.hash,
      treeHashAfter: after.hash,
      unchanged: before.hash === after.hash,
    },
  });
  await writeFile(join(caseOut, ROOT_CAUSE_REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // Evaluation happens only now, after the report is final.
  let evaluation = null;
  try {
    const truth = await readJson(join(caseDir, "ground-truth.json"), RootCauseGroundTruth, "ground truth");
    const sources: Record<string, string> = {};
    for (const l of truth.locations) sources[l.file] = await readFile(join(sourceDir, l.file), "utf8");
    evaluation = evaluateRootCause(report, truth, sources);
    await writeFile(join(caseOut, EVALUATION_FILE), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  } catch (error) {
    if (!(error instanceof UsageError && error.message.startsWith("Cannot read"))) throw error;
  }
  return { report, evaluation };
}

export async function rootCauseCommand(options: RootCauseOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const suitePath = options.suite.endsWith(".json") ? absolute(io, options.suite) : absolute(io, join("benchmarks", options.suite, "suite.json"));
  const suite = await readJson(suitePath, RootCauseSuite, "root-cause suite");
  const suiteDir = dirname(suitePath);
  const selected = suite.cases.filter((c) => options.caseIds === undefined || options.caseIds.some((id) => c.endsWith(id)));
  if (selected.length === 0) throw new UsageError(`No case matches ${options.caseIds?.join(", ") ?? ""} in suite ${suite.id}.`);

  const resultDir = join(absolute(io, options.output), "root-cause", `${ulid()}-${suite.id}`);
  const startedAt = new Date().toISOString();
  out("EXEGEZIS ROOT CAUSE");
  out();
  out(`Suite: ${suite.id} — ${selected.length} case(s)`);
  out("Every arm runs on an isolated copy of the application; the source tree is never modified.");
  out();

  const cases: RootCauseSuiteCase[] = [];
  let runsPerArm = options.runs ?? 0;
  for (const rel of selected) {
    const caseDir = resolve(suiteDir, rel);
    const id = rel.split("/").pop() ?? rel;
    out(`${id}`);
    const t0 = Date.now();
    const { report, evaluation } = await investigateCase(caseDir, join(resultDir, "cases", id), options, io, (line) => out(line));
    runsPerArm = report.policy.runsPerArm;
    out(`  → ${report.decision.status}${report.decision.hypothesisId === null ? "" : ` (${report.decision.hypothesisId})`}: ${report.decision.reason}`);
    if (evaluation !== null) out(`  ground truth: ${evaluation.detail}`);
    out();
    cases.push({
      id,
      report: `cases/${id}/${ROOT_CAUSE_REPORT_FILE}`,
      status: report.decision.status,
      baseline: report.baseline.counts,
      experiments: report.experiments.map((e) => ({ hypothesisId: e.hypothesisId, counts: e.arm.counts, status: e.result.status })),
      evaluation,
      durationMs: Date.now() - t0,
    });
  }

  const evaluated = cases.map((c) => c.evaluation).filter((e) => e !== null);
  const result = RootCauseSuiteResult.parse({
    schemaVersion: "exegezis.root-cause-result/v1",
    suite: suite.id,
    exegezisVersion: options.exegezisVersion,
    startedAt,
    finishedAt: new Date().toISOString(),
    runsPerArm,
    cases,
    summary: {
      cases: cases.length,
      baselineReproduced: cases.filter((c) => c.baseline !== null && c.baseline.runs > 0 && c.baseline.reproduced === c.baseline.runs).length,
      validated: cases.filter((c) => c.status === "VALIDATED").length,
      correct: evaluated.filter((e) => e.correct === true).length,
      falseValidations: evaluated.filter((e) => e.falseValidation).length,
      insufficientEvidence: cases.filter((c) => c.status === "INSUFFICIENT_EVIDENCE").length,
      refuted: cases.filter((c) => c.status === "REFUTED").length,
      matchesExpected: evaluated.filter((e) => e.matchesExpected).length,
      hypothesesTested: cases.reduce((n, c) => n + c.experiments.length, 0),
      hypothesesRefuted: cases.reduce((n, c) => n + c.experiments.filter((e) => e.status === "FALSIFIED").length, 0),
    },
  });
  await writeFile(join(resultDir, ROOT_CAUSE_RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const s = result.summary;
  out("Summary:");
  out(`  ${s.cases} cases · ${s.baselineReproduced} reproduced · ${s.validated} validated · ${s.correct} correct · ${s.falseValidations} false validations · ${s.insufficientEvidence} insufficient evidence · ${s.refuted} refuted`);
  out(`  ${s.hypothesesTested} hypotheses tested, ${s.hypothesesRefuted} refuted · ${s.matchesExpected}/${evaluated.length} match the expected conclusion`);
  out();
  out("Result:");
  out(displayPath(io, join(resultDir, ROOT_CAUSE_RESULT_FILE), false));
  return s.falseValidations > 0 ? EXIT.expectationFailed : EXIT.ok;
}

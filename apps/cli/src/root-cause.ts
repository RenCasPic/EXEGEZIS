import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  addFootprints,
  applyMutation,
  classifyAttempt,
  controlPlan,
  countAttempts,
  CoverageFile,
  createWorkspace,
  decideRootCause,
  evaluatePrediction,
  evaluateRootCause,
  evidenceMatrix,
  footprintOf,
  hashTree,
  hypothesisOutcome,
  listTree,
  rateOf,
  removeWorkspace,
  reproducePlan,
  RootCauseGroundTruth,
  RootCauseInvestigation,
  RootCauseReport,
  RootCauseSuite,
  RootCauseSuiteResult,
  baselineReproduced,
  siteExecutions,
  specificityOf,
  ulid,
  type ArmAttempt,
  type CodeMutation,
  type ControlArm,
  type Experiment,
  type ExperimentArm,
  type Footprint,
  type RootCauseSuiteCase,
  type ScriptCoverage,
  type TestPlan,
} from "@exegezis/core";
import { minimalEnv, startApp, type RunningApp } from "./app-server.js";
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

/**
 * Server coverage without touching the application: Node writes V8 coverage
 * to NODE_V8_COVERAGE, and this preload (outside the workspace) lets the
 * engine reset the counters once the app is healthy and flush them at the end.
 */
const COVERAGE_PRELOAD = `import v8 from "node:v8";
process.on("message", (message) => {
  if (message === "exegezis:coverage-reset") {
    v8.takeCoverage();
    process.send("exegezis:coverage-reset:done");
  } else if (message === "exegezis:coverage-flush") {
    // No takeCoverage here: Node dumps coverage on exit, and a takeCoverage in
    // the same millisecond writes the same file name and loses the data.
    process.send("exegezis:coverage-flush:done", () => process.exit(0));
  }
});
`;

interface ArmContext {
  investigation: RootCauseInvestigation;
  plan: TestPlan;
  control: TestPlan | null;
  sourceDir: string;
  caseOut: string;
  preload: string;
  runs: number;
  controlRuns: number;
  options: RootCauseOptions;
  log: (line: string) => void;
}

interface Instrumented {
  app: RunningApp;
  /** Flushes and returns the server's coverage of workspace files, then stops the app. */
  finish(): Promise<ScriptCoverage[] | null>;
}

async function startInstrumented(ctx: ArmContext, workspace: string, coverageDir: string, label: string): Promise<Instrumented> {
  await rm(coverageDir, { recursive: true, force: true });
  await mkdir(coverageDir, { recursive: true });
  const app = await startApp(
    {
      command: ctx.investigation.app.command,
      cwd: workspace,
      portEnv: ctx.investigation.app.portEnv,
      healthPath: ctx.investigation.app.healthPath,
      env: { ...minimalEnv(), NODE_V8_COVERAGE: coverageDir },
      nodeArgs: ["--import", pathToFileURL(ctx.preload).href],
      ipc: true,
    },
    `${ctx.investigation.bugId} ${label}`,
  );
  let resetOk = true;
  try {
    // Drops what startup and the health checks executed.
    await app.request("exegezis:coverage-reset");
    await rm(coverageDir, { recursive: true, force: true });
    await mkdir(coverageDir, { recursive: true });
  } catch {
    resetOk = false;
  }
  return {
    app,
    finish: async () => {
      try {
        if (!resetOk) return null;
        await app.request("exegezis:coverage-flush");
        await app.exited;
        return await readServerCoverage(coverageDir, workspace);
      } catch {
        return null;
      } finally {
        await app.stopAndWait();
      }
    },
  };
}

/** The server's coverage of workspace files; null (unknown, never "nothing ran") if none was captured. */
async function readServerCoverage(dir: string, workspace: string): Promise<ScriptCoverage[] | null> {
  const byFile = new Map<string, ScriptCoverage>();
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const raw = JSON.parse(await readFile(join(dir, name), "utf8")) as { result?: { url: string; functions: ScriptCoverage["functions"] }[] };
    for (const script of raw.result ?? []) {
      if (!script.url.startsWith("file:")) continue;
      const rel = relative(workspace, fileURLToPath(script.url));
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      const file = rel.split("\\").join("/");
      const functions = script.functions.map((f) => ({ functionName: f.functionName, ranges: f.ranges, isBlockCoverage: f.isBlockCoverage }));
      const previous = byFile.get(file);
      byFile.set(file, { file, url: script.url, functions: previous === undefined ? functions : [...previous.functions, ...functions] });
    }
  }
  return byFile.size === 0 ? null : [...byFile.values()];
}

/** Browser coverage of each attempt, with URL paths mapped to workspace files. */
async function readBrowserCoverage(dir: string, attempts: readonly { runPath: string }[], files: readonly string[]): Promise<(ScriptCoverage[] | null)[]> {
  const mapFile = (pathname: string): string => {
    const matches = files.filter((f) => `/${f}`.endsWith(pathname));
    return matches.length === 1 ? (matches[0] ?? pathname) : pathname;
  };
  return Promise.all(
    attempts.map(async (a) => {
      try {
        const parsed = CoverageFile.safeParse(JSON.parse(await readFile(join(dir, a.runPath, "coverage.json"), "utf8")));
        if (!parsed.success) return null;
        return parsed.data.scripts.map((s) => ({ ...s, file: mapFile(s.file) }));
      } catch {
        return null;
      }
    }),
  );
}

/** The control scenario of an arm, with coverage, on its own app process. */
async function runControl(ctx: ArmContext, workspace: string, armDir: string, label: string, files: readonly string[]): Promise<ControlArm | null> {
  if (ctx.control === null) return null;
  const dir = join(armDir, "control");
  const path = relative(ctx.caseOut, dir).split("\\").join("/");
  let instrumented: Instrumented;
  try {
    instrumented = await startInstrumented(ctx, workspace, join(ctx.caseOut, "coverage", `${label}-control`), `${label} control`);
  } catch (error) {
    return { path, runs: 0, passed: 0, footprint: null, stable: false, error: error instanceof Error ? error.message : String(error) };
  }
  let server: ScriptCoverage[] | null;
  let reproduction;
  try {
    reproduction = (
      await reproducePlan({
        plan: ctx.control,
        attempts: ctx.controlRuns,
        baseUrl: instrumented.app.baseUrl,
        dir,
        createAdapter: () => createAdapter(ctx.options.headed, { coverage: true }),
        command: `exegezis root-cause ${ctx.investigation.bugId} ${label} control`,
        exegezisVersion: ctx.options.exegezisVersion,
      })
    ).reproduction;
  } finally {
    server = await instrumented.finish();
  }
  const browser = await readBrowserCoverage(dir, reproduction.runs, files);
  const browserFootprints = browser.map((b) => (b === null ? null : footprintOf(b)));
  const complete = server !== null && browserFootprints.every((f) => f !== null);
  const serialized = browserFootprints.map((f) => JSON.stringify(Object.entries(f ?? {}).sort()));
  const stable = complete && serialized.every((f) => f === serialized[0]);
  let footprint: Footprint | null = null;
  if (complete && server !== null) {
    footprint = footprintOf(server);
    for (const f of browserFootprints) if (f !== null) footprint = addFootprints(footprint, f);
  }
  return { path, runs: reproduction.attempts, passed: reproduction.passes, footprint, stable, error: null };
}

/**
 * One arm: a fresh copy of the application, optionally mutated, started with a
 * minimal environment and coverage, reproduced N times, optionally followed by
 * its control scenario, then deleted. Only artifacts and the diff are kept.
 */
async function runArm(ctx: ArmContext, label: string, kind: ExperimentArm["label"], mutation: CodeMutation | null, withControl: boolean): Promise<ExperimentArm> {
  const armDir = join(ctx.caseOut, kind === "baseline" ? "baseline" : kind === "reversal" ? join("reversal", label) : join("experiments", label));
  const workspace = join(ctx.caseOut, "workspaces", `${kind}-${label}`);
  const path = relative(ctx.caseOut, armDir).split("\\").join("/");
  await mkdir(armDir, { recursive: true });
  const empty = (error: string, applied: ExperimentArm["mutation"] = null): ExperimentArm => ({
    label: kind,
    path,
    mutation: applied,
    counts: { runs: 0, reproduced: 0, notReproduced: 0, invalid: 0 },
    rate: 0,
    reproductionStatus: "NOT_RUN",
    attempts: [],
    footprint: null,
    coverage: null,
    control: null,
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
    const files = await listTree(workspace, ctx.investigation.app.include);
    let instrumented: Instrumented;
    try {
      instrumented = await startInstrumented(ctx, workspace, join(ctx.caseOut, "coverage", `${kind}-${label}`), label);
    } catch (error) {
      return empty(`application did not start: ${error instanceof Error ? error.message : String(error)}`, applied);
    }
    let server: ScriptCoverage[] | null = null;
    let result;
    try {
      result = await reproducePlan({
        plan: ctx.plan,
        attempts: ctx.runs,
        baseUrl: instrumented.app.baseUrl,
        dir: armDir,
        createAdapter: () => createAdapter(ctx.options.headed, { coverage: true }),
        command: `exegezis root-cause ${ctx.investigation.bugId} ${label}`,
        exegezisVersion: ctx.options.exegezisVersion,
        onAttempt: (a) => ctx.log(`    ${label} attempt ${a.attempt}/${ctx.runs}: ${a.verdict}${a.stoppedAtStep === undefined ? "" : ` at step ${a.stoppedAtStep}`}`),
      });
    } finally {
      server = await instrumented.finish();
    }
    const { reproduction, outcomes } = result;
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
    const browser = await readBrowserCoverage(armDir, reproduction.runs, files);
    let footprint: Footprint | null = null;
    if (server !== null && browser.every((b) => b !== null)) {
      footprint = footprintOf(server);
      for (const b of browser) if (b !== null) footprint = addFootprints(footprint, footprintOf(b));
    }
    const firstBrowser = browser[0] ?? null;
    const coverage = kind === "baseline" && server !== null && firstBrowser !== null ? [...firstBrowser, ...server] : null;
    const control = withControl ? await runControl(ctx, workspace, armDir, `${kind}-${label}`, files) : null;
    const counts = countAttempts(attempts);
    return {
      label: kind,
      path,
      mutation: applied,
      counts,
      rate: rateOf(counts),
      reproductionStatus: reproduction.status,
      attempts,
      footprint,
      coverage,
      control,
      error: null,
    };
  } finally {
    // The copy is discarded: nothing but the artifacts survives the experiment.
    await removeWorkspace(workspace);
  }
}

/** The baseline's control scenario, on a fresh copy, once the failing step is known. */
async function baselineControl(ctx: ArmContext): Promise<ControlArm | null> {
  const workspace = join(ctx.caseOut, "workspaces", "baseline-control");
  await createWorkspace(ctx.sourceDir, ctx.investigation.app.include, workspace);
  try {
    const files = await listTree(workspace, ctx.investigation.app.include);
    return await runControl(ctx, workspace, join(ctx.caseOut, "baseline"), "baseline", files);
  } finally {
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
  await mkdir(caseOut, { recursive: true });
  const preload = join(caseOut, "coverage-preload.mjs");
  await writeFile(preload, COVERAGE_PRELOAD, "utf8");

  const before = await hashTree(sourceDir, investigation.app.include);
  const ctx: ArmContext = {
    investigation,
    plan: loaded.plan,
    control: null,
    sourceDir,
    caseOut,
    preload,
    runs: policy.runsPerArm,
    controlRuns: policy.controlRuns,
    options,
    log,
  };

  log(`  baseline (unmodified copy), ${ctx.runs} runs`);
  const probe = await runArm(ctx, "baseline", "baseline", null, false);
  // The control scenario is derived from the step where the baseline fails.
  const failingStep = probe.attempts.find((a) => a.classification === "reproduced")?.stoppedAtStep;
  ctx.control = failingStep === undefined ? null : controlPlan(loaded.plan, failingStep);
  const baseline: ExperimentArm = ctx.control === null ? probe : { ...probe, control: await baselineControl(ctx) };
  log(
    `  baseline: ${baseline.counts.reproduced}/${baseline.counts.runs} reproduced${baseline.error === null ? "" : ` — ${baseline.error}`}; control prefix: ${
      ctx.control === null ? "none" : `${ctx.control.steps.length} steps, ${baseline.control?.passed ?? 0}/${baseline.control?.runs ?? 0} passed`
    }`,
  );

  const sources = new Map<string, string>();
  const source = async (file: string): Promise<string> => {
    if (!sources.has(file)) sources.set(file, await readFile(join(sourceDir, file), "utf8").catch(() => ""));
    return sources.get(file) ?? "";
  };

  const experiments: Experiment[] = [];
  const stable = baselineReproduced(baseline.counts, ctx.runs);
  for (const hypothesis of investigation.hypotheses) {
    if (!stable) break;
    const startedAt = new Date().toISOString();
    log(`  ${hypothesis.id}: ${hypothesis.intervention.description}`);
    const arm = await runArm(ctx, hypothesis.id, "intervention", hypothesis.intervention, true);
    const result = arm.error !== null ? { status: "INCONCLUSIVE" as const, reason: arm.error } : evaluatePrediction(hypothesis.prediction, baseline.counts, arm.counts, policy);
    const found = (await source(hypothesis.intervention.file)).indexOf(hypothesis.intervention.find);
    const offset = found < 0 ? null : found;
    const specificity = specificityOf(baseline.control, arm.control);
    experiments.push({
      id: `EXP-${hypothesis.id}`,
      hypothesisId: hypothesis.id,
      intervention: hypothesis.intervention,
      prediction: hypothesis.prediction,
      baseline: baseline.counts,
      arm,
      delta: arm.rate - baseline.rate,
      result,
      site: { file: hypothesis.intervention.file, offset, executions: siteExecutions(baseline.coverage, hypothesis.intervention.file, offset) },
      specificity,
      reversal: null,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    log(`  ${hypothesis.id}: ${arm.counts.reproduced}/${arm.counts.runs} reproduced → ${result.status}; ${specificity.status}`);
  }

  // A-B-A: after the interventions, the original code again for every confirmed one.
  for (const experiment of experiments) {
    if (experiment.result.status !== "CONFIRMED") continue;
    log(`  ${experiment.hypothesisId}: reversal (original code again), ${ctx.runs} runs`);
    experiment.reversal = await runArm(ctx, experiment.hypothesisId, "reversal", null, false);
    log(`  ${experiment.hypothesisId}: reversal ${experiment.reversal.counts.reproduced}/${experiment.reversal.counts.runs} reproduced`);
  }

  const outcomes = investigation.hypotheses.map((h) => {
    const experiment = experiments.find((e) => e.hypothesisId === h.id) ?? null;
    const outcome = hypothesisOutcome(h, experiment);
    return experiment === null && !stable ? { ...outcome, reason: "not tested: the baseline did not reproduce the bug in every run" } : outcome;
  });
  const decision = decideRootCause(baseline, experiments, outcomes, policy);
  const { items: evidence } = evidenceMatrix({ baseline, experiments, outcomes, policy });
  const after = await hashTree(sourceDir, investigation.app.include);

  const report = RootCauseReport.parse({
    schemaVersion: "exegezis.root-cause-report/v2",
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
    evidence,
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
  await rm(join(caseOut, "coverage"), { recursive: true, force: true });

  // Evaluation happens only now, after the report is final.
  let evaluation = null;
  try {
    const truth = await readJson(join(caseDir, "ground-truth.json"), RootCauseGroundTruth, "ground truth");
    const truthSources: Record<string, string> = {};
    for (const l of truth.locations) truthSources[l.file] = await source(l.file);
    evaluation = evaluateRootCause(report, truth, truthSources);
    await writeFile(join(caseOut, EVALUATION_FILE), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  } catch (error) {
    if (!(error instanceof UsageError && error.message.startsWith("Cannot read"))) throw error;
  }
  return { report, evaluation };
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export async function rootCauseCommand(options: RootCauseOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const suitePath = options.suite.endsWith(".json") ? absolute(io, options.suite) : absolute(io, join("benchmarks", options.suite, "suite.json"));
  const suite = await readJson(suitePath, RootCauseSuite, "root-cause suite");
  const suiteDir = dirname(suitePath);
  const selected = suite.cases.filter((c) => options.caseIds === undefined || options.caseIds.some((id) => c.split("/").pop() === id));
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
    const d = report.decision;
    out(`  → ${d.status} [${d.evidenceLevel}]${d.candidateHypothesisId === null ? "" : ` (${d.candidateHypothesisId})`}: ${d.reason}`);
    if (evaluation !== null) out(`  ground truth: ${evaluation.detail}`);
    out();
    cases.push({
      id,
      report: `cases/${id}/${ROOT_CAUSE_REPORT_FILE}`,
      status: d.status,
      evidenceLevel: d.evidenceLevel,
      baseline: report.baseline.counts,
      experiments: report.experiments.map((e) => ({ hypothesisId: e.hypothesisId, counts: e.arm.counts, status: e.result.status })),
      evaluation,
      durationMs: Date.now() - t0,
    });
  }

  const evaluated = cases.map((c) => c.evaluation).filter((e) => e !== null);
  const validated = cases.filter((c) => c.status === "VALIDATED").length;
  const insufficient = cases.filter((c) => c.status === "INSUFFICIENT_EVIDENCE").length;
  const correct = evaluated.filter((e) => e.correct === true).length;
  const falseValidations = evaluated.filter((e) => e.falseValidation).length;
  const result = RootCauseSuiteResult.parse({
    schemaVersion: "exegezis.root-cause-result/v2",
    suite: suite.id,
    exegezisVersion: options.exegezisVersion,
    startedAt,
    finishedAt: new Date().toISOString(),
    runsPerArm,
    cases,
    summary: {
      cases: cases.length,
      baselineReproduced: cases.filter((c) => c.baseline !== null && c.baseline.runs > 0 && c.baseline.reproduced === c.baseline.runs).length,
      validated,
      correct,
      falseValidations,
      insufficientEvidence: insufficient,
      refuted: cases.filter((c) => c.status === "REFUTED").length,
      matchesExpected: evaluated.filter((e) => e.matchesExpected).length,
      hypothesesTested: cases.reduce((n, c) => n + c.experiments.length, 0),
      hypothesesRefuted: cases.reduce((n, c) => n + c.experiments.filter((e) => e.status === "FALSIFIED").length, 0),
      candidates: cases.filter((c) => c.evidenceLevel === "CANDIDATE").length,
    },
    metrics: {
      rootCausePrecision: ratio(correct, validated),
      falseValidationRate: ratio(falseValidations, evaluated.length),
      honestUnknownRate: ratio(insufficient, cases.length),
    },
  });
  await writeFile(join(resultDir, ROOT_CAUSE_RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const s = result.summary;
  const m = result.metrics;
  const pct = (v: number | null, n: number, d: number) => (v === null ? `n/a (${n}/${d})` : `${Math.round(v * 100)}% (${n}/${d})`);
  out("Summary:");
  out(
    `  ${s.cases} cases · ${s.baselineReproduced} reproduced · ${s.validated} validated · ${s.correct} correct · ${s.falseValidations} false validations · ${s.insufficientEvidence} insufficient evidence (${s.candidates} candidates) · ${s.refuted} refuted`,
  );
  out(`  ${s.hypothesesTested} hypotheses tested, ${s.hypothesesRefuted} refuted · ${s.matchesExpected}/${evaluated.length} match the expected conclusion`);
  out(
    `  root cause precision ${pct(m.rootCausePrecision, correct, validated)} · false validation rate ${pct(m.falseValidationRate, falseValidations, evaluated.length)} · honest unknown rate ${pct(m.honestUnknownRate, insufficient, s.cases)}`,
  );
  out("  (a small experimental benchmark: the counts matter more than the rates)");
  out();
  out("Result:");
  out(displayPath(io, join(resultDir, ROOT_CAUSE_RESULT_FILE), false));
  return s.falseValidations > 0 ? EXIT.expectationFailed : EXIT.ok;
}

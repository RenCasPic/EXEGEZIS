import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { cache } from "react";
import {
  BenchmarkCase,
  BenchmarkSuite,
  BugReport,
  PlanValidation,
  Reproduction,
  type RootCauseReport,
  TestPlan,
  ulidTime,
  type BenchmarkCaseResult,
  type EngineMessage,
  type Provenance,
  type VerificationOutcome,
} from "@exegezis/core";
import { readJob, type AiVerifyJob, type JobStatus } from "../jobs";
import { benchmarksDir, isInside, repoRoot } from "../workspace";
import { currentWorkspace } from "../user-workspace";
import { discover, type BenchmarkRef, type InvestigationRef, type WorkspaceIndex } from "./discover";
import { generationDetail, GenerationRecord } from "./generation";
import { exists, readArtifact, readText, valueOf, type Loaded } from "./read";
import { latestFor, loadRootCauses, type RootCauseEntry } from "./root-causes";
import { deriveStages, type StageState } from "./stages";

/** One discovery per request. */
export const getIndex = cache(async (): Promise<WorkspaceIndex> => discover({ runs: (await currentWorkspace()).runs, includeBenchmarks: false }));

/**
 * What a list row needs. It is a view over the real artifacts (BugReport,
 * generation record, benchmark case), not a separate record.
 */
export interface InvestigationSummary {
  ref: InvestigationRef;
  title: string;
  symptom: string | null;
  project: string | null;
  target: string | null;
  createdAt: string | null;
  outcome: VerificationOutcome | null;
  /** Where `outcome` comes from: an executed BugReport, or the benchmark record of an unexecuted case. */
  outcomeSource: "bug-report" | "benchmark" | null;
  outcomeReason: string | null;
  /** The reason as a code and parameters (absent in older reports: then outcomeReason is shown as recorded). */
  outcomeMessage: EngineMessage | null;
  reproduction: BugReport["reproduction"] | null;
  /** Wall time of the reproduction (all attempts), from reproduction.json. */
  reproductionMs: number | null;
  provenance: Provenance | null;
  generation: {
    status: GenerationRecord["status"];
    detail: string | null;
    provider: string | null;
    model: string | null;
    promptVersion: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    examples: number | null;
  } | null;
  planId: string | null;
  compiledTest: NonNullable<BugReport["compiledTest"]>["status"] | null;
  evidenceOnDisk: boolean;
  /** Present when this benchmark case has an expected outcome. */
  benchmark: { expected: VerificationOutcome; passed: boolean; kind: "positive" | "negative" } | null;
  job: { id: string; status: JobStatus } | null;
  /** Latest root-cause investigation of the same bug id. */
  rootCause: {
    entryId: string;
    status: RootCauseReport["decision"]["status"];
    evidenceLevel: RootCauseReport["decision"]["evidenceLevel"];
    hypothesisId: string | null;
    candidateHypothesisId: string | null;
    statement: string | null;
  } | null;
  /** Artifacts that exist but failed schema validation. */
  problems: string[];
  stages: StageState[];
}

interface CaseContext {
  spec: BenchmarkCase | null;
  result: BenchmarkCaseResult | null;
  project: string | null;
}

async function suiteProject(suiteId: string): Promise<string | null> {
  const suiteFile = join(benchmarksDir(), suiteId, "suite.json");
  const suite = valueOf(await readArtifact(suiteFile, BenchmarkSuite));
  return suite === null ? null : basename(resolve(dirname(suiteFile), suite.app.cwd));
}

async function caseContext(index: WorkspaceIndex, ref: InvestigationRef): Promise<CaseContext> {
  const bench = index.benchmarks.find((b) => b.id === ref.benchmarkId);
  if (bench === undefined || bench.result.status !== "ok" || ref.caseId === null) return { spec: null, result: null, project: null };
  const suiteId = bench.result.value.suite;
  const result = bench.result.value.cases.find((c) => c.id === ref.caseId) ?? null;
  const spec = valueOf(await readArtifact(join(benchmarksDir(), suiteId, "cases", ref.caseId, "case.json"), BenchmarkCase));
  return { spec, result, project: await suiteProject(suiteId) };
}

function timeFromDirName(dir: string): string | null {
  const head = basename(dir).slice(0, 26);
  try {
    return new Date(ulidTime(head)).toISOString();
  } catch {
    return null;
  }
}

async function hasAttempts(dir: string): Promise<boolean> {
  try {
    return (await readdir(join(dir, "attempts"))).length > 0;
  } catch {
    return false;
  }
}

function problem<T>(name: string, loaded: Loaded<T>): string[] {
  return loaded.status === "invalid" ? [`${name}: ${loaded.issues.join("; ")}`] : [];
}

async function buildSummary(index: WorkspaceIndex, ref: InvestigationRef, rootCauses: readonly RootCauseEntry[]): Promise<InvestigationSummary> {
  const [reportLoaded, generationLoaded, reproductionLoaded, jobInfo, context] = await Promise.all([
    readArtifact(join(ref.dir, "bug-report.json"), BugReport),
    readArtifact(join(ref.dir, "generation.json"), GenerationRecord),
    readArtifact(join(ref.dir, "reproduction.json"), Reproduction),
    ref.jobId === null ? Promise.resolve(null) : readJob(ref.jobId),
    ref.kind === "benchmark-case" ? caseContext(index, ref) : Promise.resolve<CaseContext>({ spec: null, result: null, project: null }),
  ]);
  const report = valueOf(reportLoaded);
  const generation = valueOf(generationLoaded);
  const plan = generation?.plan ?? null;
  const job: AiVerifyJob | null = jobInfo?.job.kind === "ai-verify" ? jobInfo.job : null;
  const planSymptom = plan?.metadata.symptom;
  const symptom = context.spec?.symptom ?? (typeof planSymptom === "string" ? planSymptom : null) ?? job?.symptom ?? null;

  let outcome: VerificationOutcome | null = report?.outcome ?? null;
  let outcomeSource: InvestigationSummary["outcomeSource"] = report === null ? null : "bug-report";
  let outcomeReason = report?.outcomeReason ?? null;
  if (outcome === null && context.result !== null) {
    outcome = context.result.actual.outcome;
    outcomeSource = "benchmark";
    outcomeReason = context.result.generation?.detail ?? null;
  }

  const evidenceOnDisk = !ref.archived && (await hasAttempts(ref.dir));
  const running = jobInfo?.status === "running" && report === null;
  const provenance = report?.provenance ?? generation?.provenance ?? null;

  const summary: InvestigationSummary = {
    ref,
    title: report?.title ?? plan?.title ?? context.spec?.title ?? (symptom !== null ? symptom.slice(0, 90) : basename(ref.dir)),
    symptom,
    project: context.project ?? job?.project ?? null,
    target: report?.target ?? plan?.target.baseUrl ?? job?.baseUrl ?? null,
    createdAt: report?.generatedAt ?? provenance?.createdAt ?? timeFromDirName(ref.dir) ?? (await stat(ref.dir)).mtime.toISOString(),
    outcome,
    outcomeSource,
    outcomeReason,
    outcomeMessage: outcomeSource === "bug-report" ? (report?.outcomeMessage ?? null) : null,
    reproduction: report?.reproduction ?? null,
    reproductionMs:
      reproductionLoaded.status === "ok"
        ? Date.parse(reproductionLoaded.value.finishedAt) - Date.parse(reproductionLoaded.value.startedAt)
        : null,
    provenance,
    generation:
      generation === null
        ? null
        : {
            status: generation.status,
            detail: generationDetail(generation),
            provider: generation.meta?.provider ?? null,
            model: generation.meta?.model ?? null,
            promptVersion: generation.promptVersion,
            latencyMs: generation.meta?.latencyMs ?? null,
            inputTokens: generation.meta?.usage?.inputTokens ?? null,
            outputTokens: generation.meta?.usage?.outputTokens ?? null,
            examples: generation.meta?.examples ?? null,
          },
    planId: report?.plan.id ?? plan?.id ?? null,
    compiledTest: report?.compiledTest?.status ?? null,
    evidenceOnDisk,
    benchmark:
      context.spec !== null && context.result !== null
        ? { expected: context.spec.expected.outcome, passed: context.result.passed, kind: context.spec.kind }
        : null,
    job: jobInfo === null ? null : { id: jobInfo.job.id, status: jobInfo.status },
    rootCause: null,
    problems: [...problem("bug-report.json", reportLoaded), ...problem("generation.json", generationLoaded)],
    stages: [],
  };
  const rc = latestFor(rootCauses, ref.caseId ?? report?.bugId ?? null);
  if (rc !== null) {
    const d = rc.report.value.decision;
    summary.rootCause = {
      entryId: rc.ref.id,
      status: d.status,
      evidenceLevel: d.evidenceLevel,
      hypothesisId: d.hypothesisId,
      candidateHypothesisId: d.candidateHypothesisId,
      statement: d.statement,
    };
  }
  summary.stages = deriveStages({
    symptom,
    planSource: provenance?.source ?? null,
    generation,
    generationDetail: summary.generation?.detail ?? null,
    outcome: summary.outcome,
    executed: report !== null,
    outcomeReason: summary.outcomeReason,
    outcomeMessage: summary.outcomeMessage,
    reproduction: summary.reproduction,
    running,
    evidenceOnDisk,
    archived: ref.archived,
    rootCause:
      rc === null
        ? null
        : {
            status: rc.report.value.decision.status,
            experiments: rc.report.value.experiments.length,
            hypotheses: rc.report.value.hypotheses.length,
            reason: rc.report.value.decision.reason,
          },
  });
  return summary;
}

/** Summaries of every discovered investigation, newest first. */
export async function loadSummaries(index: WorkspaceIndex): Promise<InvestigationSummary[]> {
  const rootCauses = await loadRootCauses(index);
  const summaries = await Promise.all(index.investigations.map((ref) => buildSummary(index, ref, rootCauses)));
  return summaries.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export const getSummaries = cache(async (): Promise<InvestigationSummary[]> => loadSummaries(await getIndex()));

export async function findInvestigation(id: string): Promise<InvestigationRef | null> {
  const index = await getIndex();
  return index.investigations.find((i) => i.id === id) ?? null;
}

export const getRootCauses = cache(async (): Promise<RootCauseEntry[]> => loadRootCauses(await getIndex()));

export async function findRootCause(id: string): Promise<RootCauseEntry | null> {
  return (await getRootCauses()).find((e) => e.ref.id === id) ?? null;
}

export async function findBenchmark(id: string): Promise<BenchmarkRef | null> {
  const index = await getIndex();
  return index.benchmarks.find((b) => b.id === id) ?? null;
}

export interface AttemptEntry {
  attempt: number;
  runId: string;
  runPath: string;
  verdict: string;
  stoppedAtStep: number | null;
  durationMs: number;
  onDisk: boolean;
}

export interface InvestigationDetail {
  summary: InvestigationSummary;
  report: BugReport | null;
  reproduction: Reproduction | null;
  validation: PlanValidation | null;
  plan: TestPlan | null;
  generation: GenerationRecord | null;
  attempts: AttemptEntry[];
  /** The attempt the BugReport's evidence points at (the representative failure). */
  representativeRunId: string | null;
  spec: { path: string; source: string } | null;
  /** Report-level files present in the directory. */
  files: string[];
  problems: string[];
}

const REPORT_FILES = ["bug-report.json", "reproduction.json", "validation.json", "generation.json", "plan.json"];

/** Plan of an investigation: generated plan, then the plan file next to the report, then the copy kept in an attempt. */
async function loadPlan(ref: InvestigationRef, report: BugReport | null, generation: GenerationRecord | null, attempts: AttemptEntry[]) {
  if (generation?.plan !== undefined) return generation.plan;
  const candidates = [join(ref.dir, "plan.json")];
  if (report !== null) {
    const p = isAbsolute(report.plan.path) ? report.plan.path : join(repoRoot(), report.plan.path);
    if (isInside(repoRoot(), p)) candidates.push(p);
  }
  const first = attempts.find((a) => a.onDisk);
  if (first !== undefined) candidates.push(join(ref.dir, first.runPath, "plan.json"));
  for (const candidate of candidates) {
    const plan = valueOf(await readArtifact(candidate, TestPlan));
    if (plan !== null) return plan;
  }
  return null;
}

export async function loadInvestigation(id: string): Promise<InvestigationDetail | null> {
  const ref = await findInvestigation(id);
  if (ref === null) return null;
  const summaries = await getSummaries();
  const summary = summaries.find((s) => s.ref.id === id);
  if (summary === undefined) return null;

  const [reportLoaded, reproductionLoaded, validationLoaded, generationLoaded] = await Promise.all([
    readArtifact(join(ref.dir, "bug-report.json"), BugReport),
    readArtifact(join(ref.dir, "reproduction.json"), Reproduction),
    readArtifact(join(ref.dir, "validation.json"), PlanValidation),
    readArtifact(join(ref.dir, "generation.json"), GenerationRecord),
  ]);
  const report = valueOf(reportLoaded);
  const reproduction = valueOf(reproductionLoaded);
  const generation = valueOf(generationLoaded);

  const attempts: AttemptEntry[] = await Promise.all(
    (reproduction?.runs ?? []).map(async (run) => {
      const dir = join(ref.dir, run.runPath);
      let onDisk = false;
      if (!ref.archived && isInside(ref.dir, dir)) {
        try {
          onDisk = (await stat(dir)).isDirectory();
        } catch {
          onDisk = false;
        }
      }
      return {
        attempt: run.attempt,
        runId: run.runId,
        runPath: run.runPath.split("\\").join("/"),
        verdict: run.verdict,
        stoppedAtStep: run.stoppedAtStep ?? null,
        durationMs: run.durationMs,
        onDisk,
      };
    }),
  );

  const evidencePath = report?.evidence.find((e) => e.path.startsWith("attempts/"))?.path;
  const representativeRunId = evidencePath === undefined ? null : (attempts.find((a) => evidencePath.startsWith(`${a.runPath}/`))?.runId ?? null);

  let spec: InvestigationDetail["spec"] = null;
  if (report?.compiledTest !== null && report?.compiledTest !== undefined) {
    const specFile = join(ref.dir, report.compiledTest.specPath);
    const source = isInside(ref.dir, specFile) ? await readText(specFile) : null;
    if (source !== null) spec = { path: report.compiledTest.specPath, source };
  }

  return {
    summary,
    report,
    reproduction,
    validation: valueOf(validationLoaded),
    plan: await loadPlan(ref, report, generation, attempts),
    generation,
    attempts,
    representativeRunId,
    spec,
    files: (await Promise.all(REPORT_FILES.map(async (f) => ((await exists(join(/*turbopackIgnore: true*/ ref.dir, f))) ? f : null)))).filter((f) => f !== null),
    problems: [
      ...problem("bug-report.json", reportLoaded),
      ...problem("reproduction.json", reproductionLoaded),
      ...problem("validation.json", validationLoaded),
      ...problem("generation.json", generationLoaded),
    ],
  };
}

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createPlanGenerator, PROMPT, type ProviderName } from "@exegezis/planner";
import { createPlanner, generateForSymptom, loadExamples, preflightFor, readRecordedAnswer } from "./ai.js";
import {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkSuite,
  computeMetrics,
  scoreCase,
  summarize,
  ulid,
  type BenchmarkCaseResult,
} from "@exegezis/core";
import { startApp } from "./app-server.js";
import { EXIT, UsageError } from "./args.js";
import { verifyPlan } from "./pipeline.js";
import { absolute, displayPath, loadTestPlan, printer, type CliIo } from "./shared.js";
import { t } from "./i18n.js";

export const BENCHMARK_RESULT_FILE = "benchmark-result.json";

export interface BenchmarkOptions {
  suite: string;
  /** Generated suites: which planner writes the plans. */
  planner?: ProviderName;
  model?: string;
  /** Generated suites: show solved examples to the planner (leave-one-out). Default true. */
  examples?: boolean;
  runs?: number;
  baseUrl?: string;
  caseIds?: string[];
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/**
 * `exegezis benchmark`: runs every case of a suite through the same
 * verification pipeline as `verify`, and scores the outcome against the
 * case's known answer. The engine is not configured differently for
 * benchmarks: what is measured is what users get.
 */
export async function benchmarkCommand(options: BenchmarkOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const suitePath = resolveSuitePath(io, options.suite);
  const suite = await readJson(suitePath, BenchmarkSuite, t("bench.what.suite"));
  const suiteDir = dirname(suitePath);
  const cases: { dir: string; spec: BenchmarkCase }[] = [];
  for (const caseDir of suite.cases) {
    const dir = resolve(suiteDir, caseDir);
    cases.push({ dir, spec: await readJson(join(dir, "case.json"), BenchmarkCase, t("bench.what.case")) });
  }
  const selected = options.caseIds === undefined ? cases : cases.filter((c) => options.caseIds?.includes(c.spec.id));
  if (selected.length === 0) throw new UsageError(t("bench.noCase", { ids: options.caseIds?.join(", ") ?? "", suite: suite.id }));
  const runs = options.runs ?? suite.runs;
  const resultDir = join(absolute(io, options.output), "benchmarks", `${ulid()}-${suite.id}`);
  const generated = suite.planSource === "generated";
  if (generated && options.planner === undefined) {
    throw new UsageError(t("bench.needsPlanner", { suite: suite.id }));
  }
  if (!generated && options.planner !== undefined) {
    throw new UsageError(t("bench.humanPlanner", { suite: suite.id }));
  }
  const useExamples = generated && options.examples !== false;
  const exampleDirs = suite.examples.map((d) => resolve(suiteDir, d));

  out("EXEGEZIS");
  out();
  out(t("bench.header", { suite: suite.id, cases: selected.length, runs }));
  out(generated ? t("bench.plansGenerated", { planner: options.planner ?? "?", prompt: PROMPT.version, examples: useExamples ? "on" : "off" }) : t("bench.plansHuman"));
  const app = options.baseUrl === undefined ? await startApp({ ...suite.app, cwd: resolve(suiteDir, suite.app.cwd) }, `suite ${suite.id}`) : undefined;
  const baseUrl = options.baseUrl ?? app?.baseUrl ?? "";
  out(t("bench.target", { url: baseUrl, started: app === undefined ? "no" : "yes" }));
  out();
  out(`${t("bench.colCase").padEnd(22)} ${generated ? `${t("bench.colPlan").padEnd(12)} ` : ""}${t("bench.colExpected").padEnd(14)} ${t("bench.colActual").padEnd(14)} ${t("bench.colRepro").padEnd(7)} ${t("bench.colResult")}`);
  out("─".repeat(generated ? 81 : 68));

  const startedAt = new Date().toISOString();
  const results: BenchmarkCaseResult[] = [];
  const rel = (path: string): string => relative(resultDir, path).replaceAll("\\", "/");
  let plannerInfo: BenchmarkResult["planner"] = null;
  try {
    // One observation of the start page serves every generated case.
    const preflight = generated
      ? await preflightFor(io, baseUrl, resultDir, { headed: options.headed, verbose: options.verbose, exegezisVersion: options.exegezisVersion })
      : undefined;
    for (const { dir, spec } of selected) {
      const t0 = Date.now();
      const caseDir = join(resultDir, "cases", spec.id);
      let generation: BenchmarkCaseResult["generation"] = null;
      let planFile: string;
      if (generated && preflight !== undefined) {
        const planner = await plannerForCase(io, options, dir, spec);
        const examples = useExamples ? await loadExamples(exampleDirs, spec.expectedBug) : [];
        const { result, planPath } = await generateForSymptom(planner, { symptom: spec.symptom, baseUrl, preflight, examples, planId: spec.id }, caseDir);
        if (result.status === "error" && result.kind === "configuration") throw new UsageError(t("bench.plannerConfig", { message: result.message }));
        generation = {
          status: result.status,
          detail:
            result.status === "declined"
              ? result.reason
              : result.status === "invalid_generation"
                ? `${result.kind}: ${result.issues.slice(0, 3).join("; ")}`
                : result.status === "error"
                  ? result.message
                  : null,
          provider: result.status === "error" ? (options.planner ?? "?") : result.meta.provider,
          model: result.status === "error" ? null : result.meta.model,
          promptVersion: result.status === "error" ? null : result.meta.promptVersion,
          latencyMs: result.status === "error" ? null : result.meta.latencyMs,
          inputTokens: result.status === "error" ? null : (result.meta.usage?.inputTokens ?? null),
          outputTokens: result.status === "error" ? null : (result.meta.usage?.outputTokens ?? null),
          examples: examples.length,
          plan: planPath === undefined ? null : rel(planPath),
        };
        if (result.status !== "error") {
          plannerInfo ??= { provider: result.meta.provider, model: result.meta.model, promptVersion: result.meta.promptVersion, examples: useExamples };
        }
        if (planPath === undefined) {
          // No plan: nothing is executed, and nothing can be VERIFIED.
          const outcome = result.status === "invalid_generation" ? "INVALID_PLAN" : "INCONCLUSIVE";
          const actual = { outcome, step: null, value: null } as const;
          const { passed, mismatches } = scoreCase(spec.expected, actual, spec.acceptableOutcomes);
          results.push({
            id: spec.id,
            kind: spec.kind,
            expectedBug: spec.expectedBug,
            expected: spec.expected,
            actual,
            reproduction: null,
            provenance: result.status === "error" ? { source: "model", generator: options.planner ?? null, model: null, version: null, promptVersion: PROMPT.version, createdAt: null } : result.provenance,
            passed,
            mismatches,
            report: rel(join(caseDir, "generation.json")),
            durationMs: Date.now() - t0,
            generation,
            validation: null,
            compiledTest: null,
            selectors: null,
          });
          printRow(out, spec, generation, actual.outcome, null, passed, mismatches);
          continue;
        }
        planFile = planPath;
      } else {
        if (spec.plan === undefined) throw new UsageError(t("bench.noPlan", { id: spec.id }));
        planFile = join(dir, spec.plan);
      }

      const loaded = await loadTestPlan(io, planFile);
      const { report } = await verifyPlan(io, loaded, {
        runs,
        baseUrl,
        dir: caseDir,
        headed: options.headed,
        verbose: options.verbose,
        exegezisVersion: options.exegezisVersion,
        progress: false,
        ...(preflight === undefined ? {} : { preflight }),
      });
      const actual = {
        outcome: report.outcome,
        step: report.failingStep?.index ?? null,
        value: report.actual?.value ?? null,
      };
      const { passed, mismatches } = scoreCase(spec.expected, actual, spec.acceptableOutcomes);
      const r = report.reproduction;
      const result: BenchmarkCaseResult = {
        id: spec.id,
        kind: spec.kind,
        expectedBug: spec.expectedBug,
        expected: spec.expected,
        actual,
        reproduction: r.attempts === 0 ? null : `${r.failures}/${r.attempts}`,
        provenance: report.provenance,
        passed,
        mismatches,
        report: rel(join(caseDir, "bug-report.json")),
        durationMs: Date.now() - t0,
        generation,
        validation: report.validation.status,
        compiledTest: report.compiledTest?.status ?? null,
        selectors:
          report.validation.reference === null
            ? null
            : {
                checked: report.validation.reference.targetsChecked,
                missing: report.validation.issues.filter((i) => i.code === "TARGET_NOT_IN_REFERENCE").length,
              },
      };
      results.push(result);
      printRow(out, spec, generation, actual.outcome, result.reproduction, passed, mismatches);
    }
  } finally {
    app?.stop();
  }

  const benchmark = BenchmarkResult.parse({
    schemaVersion: "exegezis.benchmark-result/v1",
    suite: suite.id,
    exegezisVersion: options.exegezisVersion,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    runsPerCase: runs,
    planSource: suite.planSource,
    planner: generated ? (plannerInfo ?? { provider: options.planner ?? "?", model: null, promptVersion: PROMPT.version, examples: useExamples }) : null,
    cases: results,
    summary: summarize(results),
    metrics: computeMetrics(results),
  });
  await writeFile(join(resultDir, BENCHMARK_RESULT_FILE), `${JSON.stringify(benchmark, null, 2)}\n`, "utf8");

  const s = benchmark.summary;
  out();
  out(t("bench.passed", { passed: s.passed, total: s.total }));
  out(t("bench.confusion", { tp: s.truePositives, fn: s.falseNegatives, fp: s.falsePositives, tn: s.trueNegatives }));
  out();
  out(t("bench.metrics"));
  for (const line of formatMetrics(benchmark.metrics)) out(`  ${line}`);
  out();
  out(t("bench.result"));
  out(displayPath(io, join(resultDir, BENCHMARK_RESULT_FILE), false));
  return s.failed === 0 ? EXIT.ok : EXIT.expectationFailed;
}

function printRow(
  out: (line?: string) => void,
  spec: BenchmarkCase,
  generation: BenchmarkCaseResult["generation"],
  outcome: string,
  reproduction: string | null,
  passed: boolean,
  mismatches: readonly string[],
): void {
  const plan = generation === null ? "" : `${generation.status === "invalid_generation" ? "INVALID" : generation.status.toUpperCase()}`.padEnd(12) + " ";
  // `*`: other safe outcomes are also accepted for this case.
  const expected = spec.acceptableOutcomes.length > 0 ? `${spec.expected.outcome}*` : spec.expected.outcome;
  out(`${spec.id.padEnd(22)} ${plan}${expected.padEnd(14)} ${outcome.padEnd(14)} ${(reproduction ?? "—").padEnd(7)} ${passed ? "PASS" : "FAIL"}`);
  for (const mismatch of mismatches) out(`${" ".repeat(23)}↳ ${mismatch}`);
}

export function formatMetrics(m: BenchmarkResult["metrics"]): string[] {
  const pct = (v: number | null): string => (v === null ? t("common.notAvailable") : `${Math.round(v * 1000) / 10}%`);
  return [
    t("bench.metric.planValidity", { v: pct(m.planValidityRate) }),
    t("bench.metric.semanticValidity", { v: pct(m.semanticValidityRate) }),
    t("bench.metric.verificationSuccess", { v: pct(m.verificationSuccess) }),
    t("bench.metric.falsePositiveRate", { v: pct(m.falsePositiveRate) }),
    t("bench.metric.inconclusiveRate", { v: pct(m.inconclusiveRate) }),
    t("bench.metric.invalidPlanRate", { v: pct(m.invalidPlanRate) }),
    t("bench.metric.reproductionRate", { v: pct(m.reproductionRate) }),
    t("bench.metric.anchorQuality", { v: pct(m.anchorQuality) }),
    t("bench.metric.selectorQuality", { v: pct(m.selectorQuality) }),
    t("bench.metric.playwrightAgreement", { v: pct(m.playwrightAgreement) }),
  ];
}

/** The planner for one case: the real provider, or the case's recorded answer. */
async function plannerForCase(io: CliIo, options: BenchmarkOptions, caseDir: string, spec: BenchmarkCase) {
  if (options.planner === "mock") {
    if (spec.mockResponse === undefined) throw new UsageError(t("bench.noAnswer", { id: spec.id }));
    const answer = await readRecordedAnswer(join(caseDir, spec.mockResponse));
    return createPlanGenerator("mock", { mock: () => answer });
  }
  return createPlanner(io, { planner: "anthropic", ...(options.model === undefined ? {} : { model: options.model }) });
}

function resolveSuitePath(io: CliIo, suite: string): string {
  return suite.endsWith(".json") ? absolute(io, suite) : absolute(io, join("benchmarks", suite, "suite.json"));
}

async function readJson<T>(path: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, what: string): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(t("bench.cannotRead", { what, path, message: error instanceof Error ? error.message : String(error) }));
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(t("bench.invalid", { what, path, issues }));
  }
  return result.data;
}

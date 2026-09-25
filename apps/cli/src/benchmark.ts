import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkSuite,
  scoreCase,
  summarize,
  ulid,
  type BenchmarkCaseResult,
} from "@exegezis/core";
import { EXIT, UsageError } from "./args.js";
import { verifyPlan } from "./pipeline.js";
import { absolute, displayPath, loadTestPlan, printer, type CliIo } from "./shared.js";

export const BENCHMARK_RESULT_FILE = "benchmark-result.json";

export interface BenchmarkOptions {
  suite: string;
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
  const suite = await readJson(suitePath, BenchmarkSuite, "benchmark suite");
  const suiteDir = dirname(suitePath);
  const cases: { dir: string; spec: BenchmarkCase }[] = [];
  for (const caseDir of suite.cases) {
    const dir = resolve(suiteDir, caseDir);
    cases.push({ dir, spec: await readJson(join(dir, "case.json"), BenchmarkCase, "benchmark case") });
  }
  const selected = options.caseIds === undefined ? cases : cases.filter((c) => options.caseIds?.includes(c.spec.id));
  if (selected.length === 0) throw new UsageError(`No case matches ${options.caseIds?.join(", ") ?? ""} in suite ${suite.id}.`);
  const runs = options.runs ?? suite.runs;
  const resultDir = join(absolute(io, options.output), "benchmarks", `${ulid()}-${suite.id}`);

  out("EXEGEZIS");
  out();
  out(`Benchmark: ${suite.id} — ${selected.length} case(s), ${runs} run(s) per executed case`);
  const app = options.baseUrl === undefined ? await startApp(suite, suiteDir) : undefined;
  const baseUrl = options.baseUrl ?? app?.baseUrl ?? "";
  out(`Target:    ${baseUrl}${app === undefined ? "" : " (started for this benchmark)"}`);
  out();
  out(`${"Case".padEnd(20)} ${"Expected".padEnd(14)} ${"Actual".padEnd(14)} ${"Repro".padEnd(7)} Result`);
  out("─".repeat(66));

  const startedAt = new Date().toISOString();
  const results: BenchmarkCaseResult[] = [];
  try {
    for (const { dir, spec } of selected) {
      const t0 = Date.now();
      const loaded = await loadTestPlan(io, join(dir, spec.plan));
      const caseDir = join(resultDir, "cases", spec.id);
      const { report } = await verifyPlan(io, loaded, {
        runs,
        baseUrl,
        dir: caseDir,
        headed: options.headed,
        verbose: options.verbose,
        exegezisVersion: options.exegezisVersion,
        progress: false,
      });
      const actual = {
        outcome: report.outcome,
        step: report.failingStep?.index ?? null,
        value: report.actual?.value ?? null,
      };
      const { passed, mismatches } = scoreCase(spec.expected, actual);
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
        report: relative(resultDir, join(caseDir, "bug-report.json")).replaceAll("\\", "/"),
        durationMs: Date.now() - t0,
      };
      results.push(result);
      out(
        `${spec.id.padEnd(20)} ${spec.expected.outcome.padEnd(14)} ${actual.outcome.padEnd(14)} ${(result.reproduction ?? "—").padEnd(7)} ${passed ? "PASS" : "FAIL"}`,
      );
      for (const mismatch of mismatches) out(`${" ".repeat(21)}↳ ${mismatch}`);
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
    cases: results,
    summary: summarize(results),
  });
  await writeFile(join(resultDir, BENCHMARK_RESULT_FILE), `${JSON.stringify(benchmark, null, 2)}\n`, "utf8");

  const s = benchmark.summary;
  out();
  out(`${s.passed}/${s.total} benchmark cases passed`);
  out(`True positives: ${s.truePositives}   False negatives: ${s.falseNegatives}   False positives: ${s.falsePositives}   True negatives: ${s.trueNegatives}`);
  out();
  out("Result:");
  out(displayPath(io, join(resultDir, BENCHMARK_RESULT_FILE), false));
  return s.failed === 0 ? EXIT.ok : EXIT.expectationFailed;
}

function resolveSuitePath(io: CliIo, suite: string): string {
  return suite.endsWith(".json") ? absolute(io, suite) : absolute(io, join("benchmarks", suite, "suite.json"));
}

async function readJson<T>(path: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, what: string): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(`Cannot read ${what} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new UsageError(`Invalid ${what} ${path}:\n${issues}`);
  }
  return result.data;
}

interface RunningApp {
  baseUrl: string;
  stop(): void;
}

/** Starts the suite's application on a free port and waits for its health check. */
async function startApp(suite: BenchmarkSuite, suiteDir: string): Promise<RunningApp> {
  const port = await freePort();
  const [command, ...args] = suite.app.command as [string, ...string[]];
  const child: ChildProcess = spawn(command === "node" ? process.execPath : command, args, {
    cwd: resolve(suiteDir, suite.app.cwd),
    env: { ...process.env, [suite.app.portEnv]: String(port) },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(new URL(suite.app.healthPath, baseUrl))).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`the application of suite ${suite.id} did not become healthy at ${baseUrl}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { baseUrl, stop: () => child.kill() };
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { EngineUnavailableError, sha256, type CompiledTestExecution } from "@exegezis/core";
import { BASE_URL_ENV, type StepLines } from "./compile.js";

export interface RunSpecOptions {
  specPath: string;
  /** Line ranges from compilation, to map a failure back to a plan step. */
  steps: readonly StepLines[];
  baseUrl?: string;
  /** Directory for Playwright's own output (test-results). */
  outputDir: string;
  timeoutMs?: number;
  /**
   * The browser the reproduction actually used. A system browser (chrome,
   * msedge) is passed to the runner through a minimal config next to the
   * spec, so the spec runs where the reproduction ran; the spec itself stays
   * portable. Default: Playwright's own Chromium, no config.
   */
  browserChannel?: "chromium" | "chrome" | "msedge";
}

/** The runner could not start its browser: a fact about this machine, not a result of the spec. */
const LAUNCH_FAILURE = /^browserType\.launch: /m;

function runnerCannotLaunch(message: string, channel: RunSpecOptions["browserChannel"]): EngineUnavailableError {
  return new EngineUnavailableError(
    "The Playwright test runner could not start its browser on this machine. This is a problem with this computer, not with the application.",
    [{ engine: `@playwright/test (${channel ?? "chromium"})`, error: firstLine(message) }],
    ["Install Playwright's Chromium: pnpm exegezis doctor --install", "Check what this machine has: pnpm exegezis doctor"],
  );
}

interface JsonReport {
  suites?: JsonSuite[];
  errors?: { message?: string }[];
}
interface JsonSuite {
  suites?: JsonSuite[];
  specs?: { tests?: { results?: JsonResult[] }[] }[];
}
interface JsonResult {
  status?: string;
  errors?: { message?: string; location?: { file?: string; line?: number } }[];
}

/**
 * Runs a compiled spec with the standard Playwright test runner, resolved
 * from the spec's own location exactly as the customer's project would. If
 * `@playwright/test` is not resolvable there, the spec is not runnable there,
 * and that is reported rather than papered over with EXEGEZIS' own copy.
 */
export async function runCompiledSpec(options: RunSpecOptions): Promise<CompiledTestExecution> {
  const specPath = resolve(options.specPath);
  const source = await readFile(specPath);
  const base = { specPath: options.specPath, sha256: sha256(source) };

  const packageDir = findPackageDir(dirname(specPath), "@playwright/test");
  if (packageDir === undefined) {
    return {
      ...base,
      status: "error",
      exitCode: null,
      runner: "@playwright/test (not found)",
      message: `@playwright/test is not resolvable from ${dirname(specPath)}; install it in the project that contains the spec`,
    };
  }
  const localRequire = createRequire(join(packageDir, "package.json"));
  const cliPath = localRequire.resolve("./cli.js");
  const runner = `@playwright/test ${(localRequire("./package.json") as { version: string }).version}`;

  // NODE_PATH (set by package-manager shims) would let the spec resolve
  // packages that its own project does not have; the customer's CI would not.
  const env = { ...process.env };
  delete env["NODE_PATH"];
  const config: string[] = [];
  if (options.browserChannel === "chrome" || options.browserChannel === "msedge") {
    const configPath = join(dirname(specPath), "exegezis-runner.config.mjs");
    const lines = ["// Written by EXEGEZIS: run the spec in the browser the reproduction used.", `export default { use: { channel: ${JSON.stringify(options.browserChannel)} } };`, ""];
    await writeFile(configPath, lines.join("\n"), "utf8");
    config.push(`--config=${configPath}`);
  }
  const started = performance.now();
  const { exitCode, stdout, stderr } = await spawnCollect(
    process.execPath,
    [cliPath, "test", basename(specPath), ...config, "--reporter=json", "--workers=1", "--retries=0", `--output=${resolve(options.outputDir)}`],
    {
      cwd: dirname(specPath),
      env: { ...env, ...(options.baseUrl === undefined ? {} : { [BASE_URL_ENV]: options.baseUrl }) },
      timeoutMs: options.timeoutMs ?? 300_000,
    },
  );
  const durationMs = Math.round(performance.now() - started);

  let report: JsonReport;
  try {
    report = JSON.parse(stdout) as JsonReport;
  } catch {
    return { ...base, status: "error", exitCode, runner, durationMs, message: firstLine(stderr) || "the runner did not produce a JSON report" };
  }
  const results = collectResults(report.suites ?? []);
  const result = results[0];
  if (results.length !== 1 || result === undefined) {
    const launchError = (report.errors ?? []).map((e) => stripAnsi(e.message ?? "")).find((m) => LAUNCH_FAILURE.test(m));
    if (launchError !== undefined) throw runnerCannotLaunch(launchError, options.browserChannel);
    const reason = report.errors?.[0]?.message ?? `expected exactly 1 test, found ${results.length}`;
    return { ...base, status: "error", exitCode, runner, durationMs, message: firstLine(reason) };
  }
  if (result.status === "passed") return { ...base, status: "passed", exitCode, runner, durationMs };

  const failure = result.errors?.find((e) => e.location?.line !== undefined) ?? result.errors?.[0];
  const launch = (result.errors ?? []).map((e) => stripAnsi(e.message ?? "")).find((m) => LAUNCH_FAILURE.test(m));
  if (launch !== undefined) throw runnerCannotLaunch(launch, options.browserChannel);
  const line = failure?.location?.line;
  const step = line === undefined ? undefined : options.steps.find((s) => line >= s.startLine && line <= s.endLine);
  return {
    ...base,
    status: result.status === "failed" || result.status === "timedOut" ? "failed" : "error",
    exitCode,
    runner,
    durationMs,
    ...(step === undefined ? {} : { failedAtStep: step.stepIndex }),
    message: firstLine(stripAnsi(failure?.message ?? `test ${result.status ?? "did not run"}`)),
  };
}

/**
 * Node's module lookup from `dir` upwards, deliberately without NODE_PATH or
 * global folders: where a project's own `import` would find the package.
 */
function findPackageDir(dir: string, name: string): string | undefined {
  let current = dir;
  for (;;) {
    const candidate = join(current, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function collectResults(suites: readonly JsonSuite[]): JsonResult[] {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => (spec.tests ?? []).map((test) => test.results?.at(-1) ?? {})),
    ...collectResults(suite.suites ?? []),
  ]);
}

function spawnCollect(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => child.kill(), options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

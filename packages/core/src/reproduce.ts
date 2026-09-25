import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter } from "./adapter.js";
import { executeRun, failureSignature, type RunOutcome } from "./execute.js";
import { hashJson } from "./hash.js";
import { JsonlFileSink, Logger } from "./logger.js";
import { RUN_FILES, RunRecorder } from "./recorder.js";
import { buildReproduction, type Reproduction, type ReproductionAttempt } from "./schemas/reproduction.js";
import { redactPlan, type TestPlan } from "./schemas/test-plan.js";

export const REPRODUCTION_FILE = "reproduction.json";
export const ATTEMPTS_DIR = "attempts";

export interface ReproduceOptions {
  plan: TestPlan;
  attempts: number;
  baseUrl?: string;
  /** Reproduction directory; each attempt is a full run in `<dir>/attempts/<runId>/`. */
  dir: string;
  /** Called once per attempt: every attempt gets a fresh adapter (fresh browser). */
  createAdapter: () => Adapter;
  /** Extra log sinks (e.g. stderr); each run also logs to its own JSONL file. */
  createLogger?: (recorder: RunRecorder) => Logger;
  command: string;
  exegezisVersion: string;
  onAttempt?: (attempt: ReproductionAttempt, outcome: RunOutcome) => void;
}

export interface ReproductionResult {
  dir: string;
  reproduction: Reproduction;
  outcomes: RunOutcome[];
}

/**
 * Executes the same plan N times, sequentially and in isolation, and
 * aggregates the outcomes. Attempts are sequential on purpose: parallel
 * attempts against one environment would interfere with each other and add
 * nondeterminism that is ours, not the target's.
 */
export async function reproducePlan(options: ReproduceOptions): Promise<ReproductionResult> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new RangeError(`attempts must be a positive integer, got ${options.attempts}`);
  }
  await mkdir(join(options.dir, ATTEMPTS_DIR), { recursive: true });
  const startedAt = new Date().toISOString();
  const outcomes: RunOutcome[] = [];
  const runs: ReproductionAttempt[] = [];

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const recorder = await RunRecorder.create({ outputDir: join(options.dir, ATTEMPTS_DIR) });
    const fileSink = new JsonlFileSink(join(recorder.dir, RUN_FILES.log));
    const logger = options.createLogger?.(recorder) ?? new Logger([fileSink], { runId: recorder.runId });
    const t0 = Date.now();
    const outcome = await executeRun({
      adapter: options.createAdapter(),
      plan: options.plan,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      recorder,
      logger,
      command: options.command,
      exegezisVersion: options.exegezisVersion,
    });
    const record = toAttempt(attempt, outcome, Date.now() - t0);
    outcomes.push(outcome);
    runs.push(record);
    options.onAttempt?.(record, outcome);
  }

  const reproduction = buildReproduction({
    planId: options.plan.id,
    planHash: hashJson(redactPlan(options.plan)),
    planProvenance: options.plan.provenance,
    targetUrl: options.baseUrl ?? options.plan.target.baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    runs,
  });
  await writeFile(join(options.dir, REPRODUCTION_FILE), `${JSON.stringify(reproduction, null, 2)}\n`, "utf8");
  return { dir: options.dir, reproduction, outcomes };
}

function toAttempt(attempt: number, outcome: RunOutcome, durationMs: number): ReproductionAttempt {
  const failed = outcome.assertions.find((a) => a.status === "failed");
  return {
    attempt,
    runId: outcome.runId,
    runPath: `${ATTEMPTS_DIR}/${outcome.runId}`,
    verdict: outcome.verdict,
    ...(outcome.stoppedAtStep === undefined ? {} : { stoppedAtStep: outcome.stoppedAtStep }),
    ...(outcome.verdict === "failed" && failed !== undefined ? { failureSignature: failureSignature(failed) } : {}),
    ...(outcome.verdict === "error" ? { error: outcome.metadata.error?.message ?? "unknown error" } : {}),
    ...(outcome.verdict === "timeout"
      ? { error: outcome.assertions.find((a) => a.status === "timeout")?.message ?? "assertion timed out" }
      : {}),
    ...(outcome.verdict === "no_assertions" ? { error: "the plan declares no assertion" } : {}),
    durationMs,
  };
}

import { arch, platform, release } from "node:os";
import { supportsAction, type Adapter, type AdapterSession } from "./adapter.js";
import { hashJson } from "./hash.js";
import type { Logger } from "./logger.js";
import type { RunRecorder } from "./recorder.js";
import { REDACTION_POLICY } from "./redaction.js";
import { redactAction, type Plan, type PlanStep } from "./schemas/action.js";
import { toErrorInfo, type ErrorInfo } from "./schemas/common.js";
import type { ExecutionErrorEvidence } from "./schemas/evidence.js";
import type { ArtifactManifest } from "./schemas/manifest.js";
import type { CollectorStatus, RunEnvironment, RunMetadata, Target } from "./schemas/run.js";

export const EXECUTION_ERRORS_FILE = "execution-errors.json";
export const PLAN_FILE = "plan.json";

export interface ExecuteRunOptions {
  adapter: Adapter;
  plan: Plan;
  target: Target;
  recorder: RunRecorder;
  logger: Logger;
  /** Name of the command that started the run (e.g. `observe`). */
  command: string;
  exegezisVersion: string;
}

export interface RunOutcome {
  runId: string;
  dir: string;
  status: "completed" | "failed";
  metadata: RunMetadata;
  manifest: ArtifactManifest;
}

type Phase = ExecutionErrorEvidence["phase"];

/**
 * Executes a plan against an adapter and records everything that happens.
 *
 * The run always ends with metadata, a timeline and a manifest on disk, even
 * when the adapter fails to start or an action fails midway: a partial run is
 * still evidence. The first failure stops the plan; evidence collection and
 * cleanup still run.
 */
export async function executeRun(options: ExecuteRunOptions): Promise<RunOutcome> {
  const { adapter, plan, target, recorder, command } = options;
  const logger = options.logger.child({ component: "runner", runId: recorder.runId });
  const startedAt = recorder.timestamp();
  const startMs = Date.now();

  const redactedPlan: Plan = { ...plan, steps: plan.steps.map((step) => redactAction(step)) };
  const executionErrors: ExecutionErrorEvidence[] = [];
  let failure: (ErrorInfo & { phase: Phase }) | undefined;
  let collectors: Record<string, CollectorStatus> = {};
  let session: AdapterSession | undefined;

  const baseMetadata: RunMetadata = {
    schemaVersion: "exegezis.run/v1",
    runId: recorder.runId,
    command,
    status: "running",
    startedAt,
    target,
    config: { ...adapter.config },
    configHash: hashJson({ target, config: adapter.config }),
    planHash: hashJson(redactedPlan),
    environment: {
      exegezis: { version: options.exegezisVersion },
      runtime: runtimeInfo(),
      adapter: { id: adapter.descriptor.id, version: adapter.descriptor.version },
    },
    collectors: {},
    redaction: { policy: REDACTION_POLICY, secretValuesTracked: 0 },
    manifest: "manifest.json",
  };

  const recordFailure = (phase: Phase, error: unknown, actionId?: string): ExecutionErrorEvidence => {
    const info = toErrorInfo(error);
    const evidence: ExecutionErrorEvidence = {
      kind: "execution_error",
      id: recorder.ids.next("exe"),
      timestamp: recorder.timestamp(),
      phase,
      ...(actionId === undefined ? {} : { actionId }),
      error: info,
    };
    executionErrors.push(evidence);
    const event = recorder.emit("EXECUTION_ERROR", "runner", {
      evidenceId: evidence.id,
      phase,
      message: info.message,
    });
    logger.error("execution error", { phase, actionId, error: info.message }, event.id);
    failure ??= { ...info, phase };
    return evidence;
  };

  await recorder.writeJson("plan", PLAN_FILE, redactedPlan, { description: "Plan executed by the run" });
  await recorder.writeMetadata(baseMetadata);
  const started = recorder.emit("RUN_STARTED", "runner", { runId: recorder.runId, targetUrl: target.url });
  logger.info("run started", { target: target.url, adapter: adapter.descriptor.id }, started.id);

  try {
    session = await adapter.start({ recorder, logger: options.logger.child({ runId: recorder.runId }) });
  } catch (error) {
    recordFailure("start", error);
  }

  if (session !== undefined) {
    for (const step of plan.steps) {
      if (failure !== undefined) break;
      await runStep(session, step);
    }

    try {
      collectors = await session.collectEvidence();
    } catch (error) {
      recordFailure("collect", error);
    }
    try {
      await session.close();
    } catch (error) {
      // Closing is cleanup: record it, but it does not change what was observed.
      const info = toErrorInfo(error);
      logger.warn("adapter close failed", { error: info.message });
    }
  }

  const status = failure === undefined ? "completed" : "failed";
  const finished = recorder.emit("RUN_FINISHED", "runner", {
    status,
    durationMs: Date.now() - startMs,
    ...(failure === undefined ? {} : { error: { name: failure.name, message: failure.message } }),
  });
  logger.info("run finished", { status }, finished.id);

  await recorder.writeJson("execution_errors", EXECUTION_ERRORS_FILE, executionErrors, {
    description: "Errors in EXEGEZIS' own execution (not in the target)",
  });

  const produced = new Set(recorder.manifest().artifacts.map((a) => a.type));
  for (const type of adapter.descriptor.produces) {
    if (!produced.has(type)) {
      recorder.markMissing(type, failure === undefined ? "not produced" : `run failed during ${failure.phase}: ${failure.message}`);
    }
  }

  const metadata: RunMetadata = {
    ...baseMetadata,
    status,
    finishedAt: recorder.timestamp(),
    durationMs: Date.now() - startMs,
    environment: mergeEnvironment(baseMetadata.environment, session?.environment),
    collectors,
    ...(failure === undefined ? {} : { error: failure }),
  };
  await recorder.writeMetadata(metadata);
  const manifest = await recorder.finalize();

  return { runId: recorder.runId, dir: recorder.dir, status, metadata, manifest };

  async function runStep(active: AdapterSession, step: PlanStep): Promise<void> {
    if (step.type === "observe") {
      try {
        await active.observe({ reason: "plan", ...(step.label === undefined ? {} : { label: step.label }) });
      } catch (error) {
        recordFailure("observe", error);
      }
      return;
    }

    const actionId = recorder.ids.next("act");
    if (!supportsAction(adapter.descriptor, step)) {
      const reason = `adapter "${adapter.descriptor.id}" does not support action "${step.type}"`;
      recorder.emit("ACTION_REJECTED", "runner", { actionId, reason });
      recordFailure("action", new Error(reason), actionId);
      return;
    }

    const startEvent = recorder.emit("ACTION_STARTED", "runner", { actionId, step: redactAction(step) });
    const t0 = performance.now();
    try {
      await active.execute(step, actionId);
      recorder.emit("ACTION_SUCCEEDED", "runner", { actionId, durationMs: elapsedSince(t0) });
    } catch (error) {
      const evidence = recordFailure("action", error, actionId);
      recorder.emit("ACTION_FAILED", "runner", {
        actionId,
        durationMs: elapsedSince(t0),
        evidenceId: evidence.id,
        error: evidence.error,
      });
      logger.warn("action failed; capturing failure observation", { actionId }, startEvent.id);
      try {
        await active.observe({ reason: "failure", label: `after-${actionId}` });
      } catch (observeError) {
        logger.warn("failure observation could not be captured", { error: toErrorInfo(observeError).message });
      }
    }
  }
}

function elapsedSince(t0: number): number {
  return Math.round((performance.now() - t0) * 1000) / 1000;
}

function runtimeInfo(): RunEnvironment["runtime"] {
  return {
    name: "node",
    version: process.version,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
  };
}

function mergeEnvironment(
  base: RunEnvironment | undefined,
  fromSession: Pick<RunEnvironment, "adapter" | "browser" | "automation"> | undefined,
): RunEnvironment | undefined {
  if (base === undefined || fromSession === undefined) return base;
  return { ...base, ...fromSession };
}

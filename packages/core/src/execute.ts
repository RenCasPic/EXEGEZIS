import { arch, platform, release } from "node:os";
import { supportsAction, supportsAssertion, type Adapter, type AdapterSession } from "./adapter.js";
import { canonicalJson, hashJson } from "./hash.js";
import type { Logger } from "./logger.js";
import type { RunRecorder } from "./recorder.js";
import { REDACTION_POLICY } from "./redaction.js";
import { resolveNavigationUrl, type Action } from "./schemas/action.js";
import {
  AssertionEvaluation,
  describeAssertion,
  type AssertionResult,
  type AssertStep,
  type EvidenceLinks,
} from "./schemas/assertion.js";
import { toErrorInfo, type ErrorInfo } from "./schemas/common.js";
import type { ExecutionErrorEvidence, Observation } from "./schemas/evidence.js";
import type { ArtifactManifest } from "./schemas/manifest.js";
import { effectiveStabilityMs, resolveTimeouts } from "./schemas/policy.js";
import type { CollectorStatus, RunEnvironment, RunMetadata, RunVerdict, Target } from "./schemas/run.js";
import { redactAction, redactPlan, type PlanStep, type TestPlan } from "./schemas/test-plan.js";
import type { TimelineEvent } from "./schemas/timeline.js";

export const EXECUTION_ERRORS_FILE = "execution-errors.json";
export const ASSERTIONS_FILE = "assertions.json";
export const PLAN_FILE = "plan.json";

export interface ExecuteRunOptions {
  adapter: Adapter;
  plan: TestPlan;
  /** Overrides `plan.target.baseUrl` (run the same plan against another environment). */
  baseUrl?: string;
  recorder: RunRecorder;
  logger: Logger;
  /** Name of the command that started the run (e.g. `run`, `observe`). */
  command: string;
  exegezisVersion: string;
}

export interface RunOutcome {
  runId: string;
  dir: string;
  /** Whether EXEGEZIS executed and recorded the run correctly. */
  status: "completed" | "failed";
  /** What the plan concluded (see RunVerdict). */
  verdict: RunVerdict;
  stoppedAtStep?: number;
  assertions: AssertionResult[];
  timeline: readonly TimelineEvent[];
  metadata: RunMetadata;
  manifest: ArtifactManifest;
}

type Phase = ExecutionErrorEvidence["phase"];

/** The whole run exceeded `timeouts.runMs`. An execution error, never a failure. */
export class RunTimeoutError extends Error {
  override readonly name = "RunTimeoutError";

  constructor(runMs: number) {
    super(`the run exceeded its time budget of ${runMs} ms`);
  }
}

/** Rejects with RunTimeoutError after `ms`; the abandoned promise can never reject unhandled. */
async function withDeadline<T>(promise: Promise<T>, ms: number, runMs: number): Promise<T> {
  promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RunTimeoutError(runMs)), Math.max(0, ms));
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes a test plan against an adapter and records everything.
 *
 * - Steps run in order. The first failed assertion or execution error stops
 *   the plan (like a Playwright test); evidence collection and cleanup always
 *   run, so a stopped run is still complete evidence.
 * - A failed assertion is a *result* (verdict `failed`). An action, target or
 *   infrastructure problem is an *error* (verdict `error`) and is never
 *   reported as a failure of the application.
 */
export async function executeRun(options: ExecuteRunOptions): Promise<RunOutcome> {
  const { adapter, plan, recorder, command } = options;
  const logger = options.logger.child({ component: "runner", runId: recorder.runId });
  const baseUrl = options.baseUrl ?? plan.target.baseUrl;
  const target: Target = { kind: "web", url: baseUrl };
  const startMs = Date.now();
  const timeouts = resolveTimeouts(plan.timeouts);
  const deadline = startMs + timeouts.runMs;

  const redactedPlan = redactPlan(plan);
  const executionErrors: ExecutionErrorEvidence[] = [];
  const assertionResults: AssertionResult[] = [];
  let failure: (ErrorInfo & { phase: Phase }) | undefined;
  let stepError = false;
  let assertionFailed = false;
  let assertionTimedOut = false;
  let stoppedAtStep: number | undefined;
  let lastActionEvent: TimelineEvent | undefined;
  let collectors: Record<string, CollectorStatus> = {};
  let session: AdapterSession | undefined;

  const baseMetadata: RunMetadata = {
    schemaVersion: "exegezis.run/v1",
    runId: recorder.runId,
    command,
    status: "running",
    startedAt: recorder.timestamp(),
    target,
    config: { ...adapter.config },
    configHash: hashJson({ target, config: adapter.config }),
    planHash: hashJson(redactedPlan),
    environment: {
      exegezis: { version: options.exegezisVersion },
      runtime: runtimeInfo(),
      adapter: { id: adapter.descriptor.id, version: adapter.descriptor.version },
    },
    plan: { id: plan.id, title: plan.title, steps: plan.steps.length, provenance: plan.provenance },
    timeouts,
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
    const event = recorder.emit("EXECUTION_ERROR", "runner", { evidenceId: evidence.id, phase, message: info.message });
    logger.error("execution error", { phase, actionId, error: info.message }, event.id);
    failure ??= { ...info, phase };
    return evidence;
  };

  await recorder.writeJson("plan", PLAN_FILE, redactedPlan, { description: `Test plan ${plan.id}` });
  await recorder.writeMetadata(baseMetadata);
  const started = recorder.emit("RUN_STARTED", "runner", { runId: recorder.runId, targetUrl: target.url });
  logger.info("run started", { target: target.url, plan: plan.id, adapter: adapter.descriptor.id }, started.id);
  recorder.emit("PLAN_STARTED", "runner", { planId: plan.id, title: plan.title, steps: plan.steps.length });

  try {
    session = await withDeadline(
      adapter.start({ recorder, logger: options.logger.child({ runId: recorder.runId }) }),
      deadline - Date.now(),
      timeouts.runMs,
    );
  } catch (error) {
    recordFailure(error instanceof RunTimeoutError ? "run" : "start", error);
    stepError = true;
  }

  if (session !== undefined) {
    for (const [index, step] of plan.steps.entries()) {
      if (stepError || assertionFailed || assertionTimedOut) break;
      try {
        await withDeadline(runStep(session, step, index + 1), deadline - Date.now(), timeouts.runMs);
      } catch (error) {
        // runStep handles its own failures; only the run deadline gets here.
        recordFailure("run", error);
        stepError = true;
        stoppedAtStep = index + 1;
      }
    }
  }

  const verdict: RunVerdict = assertionFailed
    ? "failed"
    : assertionTimedOut
      ? "timeout"
      : stepError
        ? "error"
      : plan.steps.some((s) => s.type === "assert")
          ? "passed"
          : "no_assertions";
  recorder.emit("PLAN_FINISHED", "runner", {
    planId: plan.id,
    verdict,
    ...(stoppedAtStep === undefined ? {} : { stoppedAtStep }),
  });

  if (session !== undefined) {
    try {
      collectors = await session.collectEvidence();
    } catch (error) {
      recordFailure("collect", error);
    }
    try {
      await session.close();
    } catch (error) {
      // Closing is cleanup: record it, but it does not change what was observed.
      logger.warn("adapter close failed", { error: toErrorInfo(error).message });
    }
  }

  const status = failure === undefined ? "completed" : "failed";
  const finished = recorder.emit("RUN_FINISHED", "runner", {
    status,
    durationMs: Date.now() - startMs,
    ...(failure === undefined ? {} : { error: { name: failure.name, message: failure.message } }),
  });
  logger.info("run finished", { status, verdict, stoppedAtStep }, finished.id);

  await recorder.writeJson(
    "assertions",
    ASSERTIONS_FILE,
    { schemaVersion: "exegezis.assertions/v1", results: assertionResults },
    { description: "Assertion results with expected/actual values and linked evidence" },
  );
  await recorder.writeJson("execution_errors", EXECUTION_ERRORS_FILE, executionErrors, {
    description: "Errors in EXEGEZIS' own execution (not in the target)",
  });

  const produced = new Set(recorder.manifest().artifacts.map((a) => a.type));
  for (const type of adapter.descriptor.produces) {
    if (!produced.has(type)) {
      recorder.markMissing(type, failure === undefined ? "not produced" : `run failed during ${failure.phase}: ${failure.message}`);
    }
  }

  const declaredAssertions = plan.steps.filter((s) => s.type === "assert").length;
  const metadata: RunMetadata = {
    ...baseMetadata,
    status,
    finishedAt: recorder.timestamp(),
    durationMs: Date.now() - startMs,
    environment: mergeEnvironment(baseMetadata.environment, session?.environment),
    collectors,
    verdict,
    assertions: {
      total: declaredAssertions,
      passed: assertionResults.filter((r) => r.status === "passed").length,
      failed: assertionResults.filter((r) => r.status === "failed").length,
      timedOut: assertionResults.filter((r) => r.status === "timeout").length,
      errored: assertionResults.filter((r) => r.status === "error").length,
      notRun: declaredAssertions - assertionResults.length,
    },
    ...(stoppedAtStep === undefined ? {} : { stoppedAtStep }),
    ...(failure === undefined ? {} : { error: failure }),
  };
  await recorder.writeMetadata(metadata);
  const manifest = await recorder.finalize();

  return {
    runId: recorder.runId,
    dir: recorder.dir,
    status,
    verdict,
    ...(stoppedAtStep === undefined ? {} : { stoppedAtStep }),
    assertions: assertionResults,
    timeline: recorder.timeline,
    metadata,
    manifest,
  };

  async function runStep(active: AdapterSession, step: PlanStep, stepIndex: number): Promise<void> {
    if (step.type === "observe") {
      try {
        await active.observe({ reason: "plan", ...(step.label === undefined ? {} : { label: step.label }) });
      } catch (error) {
        recordFailure("observe", error);
        stepError = true;
        stoppedAtStep = stepIndex;
      }
      return;
    }
    if (step.type === "assert") {
      await runAssertion(active, step, stepIndex);
      return;
    }
    await runAction(active, step, stepIndex);
  }

  async function runAction(active: AdapterSession, planned: Action, stepIndex: number): Promise<void> {
    const actionId = recorder.ids.next("act");
    const action = withPolicyTimeout(
      planned.type === "navigate" ? { ...planned, url: resolveNavigationUrl(planned.url, baseUrl) } : planned,
    );
    if (!supportsAction(adapter.descriptor, action)) {
      const reason = `adapter "${adapter.descriptor.id}" does not support action "${action.type}"`;
      recorder.emit("ACTION_REJECTED", "runner", { actionId, reason });
      recordFailure("action", new Error(reason), actionId);
      stepError = true;
      stoppedAtStep = stepIndex;
      return;
    }

    const startEvent = recorder.emit("ACTION_STARTED", "runner", { actionId, stepIndex, step: redactAction(action) });
    lastActionEvent = startEvent;
    const t0 = performance.now();
    try {
      await active.execute(action, actionId);
      recorder.emit("ACTION_SUCCEEDED", "runner", { actionId, durationMs: elapsedSince(t0) });
    } catch (error) {
      const evidence = recordFailure("action", error, actionId);
      recorder.emit("ACTION_FAILED", "runner", {
        actionId,
        durationMs: elapsedSince(t0),
        evidenceId: evidence.id,
        error: evidence.error,
      });
      stepError = true;
      stoppedAtStep = stepIndex;
      logger.warn("action failed; capturing failure observation", { actionId }, startEvent.id);
      await observeSafely(active, `after-${actionId}`);
    }
  }

  async function runAssertion(active: AdapterSession, step: AssertStep, stepIndex: number): Promise<void> {
    const assertionId = recorder.ids.next("asr");
    const description = step.description ?? describeAssertion(step.assertion);
    const timeoutMs = step.timeoutMs ?? timeouts.assertionMs;
    const stabilityMs = effectiveStabilityMs(timeouts, timeoutMs);
    const startEvent = recorder.emit("ASSERTION_STARTED", "runner", {
      assertionId,
      stepIndex,
      purpose: step.purpose,
      description,
      assertion: step.assertion,
    });
    const startedAt = recorder.timestamp();
    const t0 = performance.now();

    let evaluation: AssertionEvaluation;
    if (!supportsAssertion(adapter.descriptor, step.assertion)) {
      evaluation = {
        status: "error",
        errorKind: "unsupported",
        expected: null,
        actual: null,
        message: `adapter "${adapter.descriptor.id}" cannot evaluate "${step.assertion.kind}" assertions`,
        attempts: 1,
      };
    } else {
      try {
        evaluation = AssertionEvaluation.parse(await active.assert(step.assertion, { timeoutMs, stabilityMs, baseUrl }));
      } catch (error) {
        evaluation = {
          status: "error",
          errorKind: "evaluation_error",
          expected: null,
          actual: null,
          message: toErrorInfo(error).message,
          attempts: 1,
        };
      }
    }
    const durationMs = elapsedSince(t0);

    let resultEvent: TimelineEvent;
    if (evaluation.status === "passed") {
      resultEvent = recorder.emit("ASSERTION_PASSED", "runner", { assertionId, actual: evaluation.actual, durationMs });
    } else if (evaluation.status === "failed") {
      resultEvent = recorder.emit("ASSERTION_FAILED", "runner", {
        assertionId,
        expected: evaluation.expected,
        actual: evaluation.actual,
        message: evaluation.message,
        durationMs,
      });
    } else if (evaluation.status === "timeout") {
      resultEvent = recorder.emit("ASSERTION_TIMEOUT", "runner", {
        assertionId,
        timeoutReason: evaluation.timeoutReason ?? "subject_absent",
        actual: evaluation.actual,
        message: evaluation.message,
        durationMs,
      });
    } else {
      resultEvent = recorder.emit("ASSERTION_ERROR", "runner", {
        assertionId,
        errorKind: evaluation.errorKind ?? "evaluation_error",
        message: evaluation.message,
        durationMs,
      });
    }
    logger.info("assertion evaluated", { assertionId, stepIndex, status: evaluation.status }, resultEvent.id);

    let evidence: EvidenceLinks | undefined;
    if (evaluation.status !== "passed") {
      stoppedAtStep = stepIndex;
      if (evaluation.status === "failed") {
        assertionFailed = true;
      } else if (evaluation.status === "timeout") {
        // Not an execution error and not a failure: the run simply reached no conclusion.
        assertionTimedOut = true;
      } else {
        recordFailure("assertion", new Error(`${description}: ${evaluation.message}`));
        stepError = true;
      }
      const observation = await observeSafely(active, `assert-step-${stepIndex}`);
      evidence = linkEvidence(lastActionEvent ?? startEvent, resultEvent, observation);
    }

    assertionResults.push({
      id: assertionId,
      stepIndex,
      ...(step.id === undefined ? {} : { stepId: step.id }),
      kind: step.assertion.kind,
      purpose: step.purpose,
      description,
      assertion: step.assertion,
      ...evaluation,
      startedAt,
      finishedAt: recorder.timestamp(),
      durationMs,
      timeoutMs,
      ...(evidence === undefined ? {} : { evidence }),
    });
  }

  /** Applies the plan's timeout policy to an action that does not set its own. */
  function withPolicyTimeout(action: Action): Action {
    if (action.type === "screenshot" || action.timeoutMs !== undefined) return action;
    return { ...action, timeoutMs: action.type === "navigate" ? timeouts.navigationMs : timeouts.actionMs };
  }

  async function observeSafely(active: AdapterSession, label: string): Promise<Observation | undefined> {
    try {
      return await active.observe({ reason: "failure", label });
    } catch (error) {
      logger.warn("failure observation could not be captured", { error: toErrorInfo(error).message });
      return undefined;
    }
  }

  /**
   * Builds the evidence chain for a failed assertion from the timeline: what
   * happened between the last action and the failure, plus the observation
   * taken right after it.
   */
  function linkEvidence(from: TimelineEvent, result: TimelineEvent, observation: Observation | undefined): EvidenceLinks {
    const events = recorder.timeline.filter((e) => e.seq >= from.seq);
    const last = events.at(-1) ?? result;
    const ids = (types: TimelineEvent["type"][]): string[] => {
      const found = new Set<string>();
      for (const event of events) {
        if (types.includes(event.type) && "evidenceId" in event.payload) found.add(event.payload.evidenceId);
      }
      return [...found];
    };
    const pathOf = (type: "SCREENSHOT" | "DOM_SNAPSHOT", id: string | undefined): string | undefined => {
      if (id === undefined) return undefined;
      for (const event of events) {
        if (event.type === type && event.payload.evidenceId === id) return event.payload.path;
      }
      return undefined;
    };
    const screenshotId = observation?.evidence.screenshot;
    const screenshotPath = pathOf("SCREENSHOT", screenshotId);
    const domId = observation?.evidence.dom;
    const domPath = pathOf("DOM_SNAPSHOT", domId);
    return {
      ...(lastActionEvent === undefined ? {} : { actionEventId: lastActionEvent.id }),
      assertionEventId: result.id,
      ...(observation === undefined ? {} : { observationId: observation.id }),
      ...(screenshotId === undefined || screenshotPath === undefined ? {} : { screenshot: { id: screenshotId, path: screenshotPath } }),
      ...(observation?.evidence.accessibility === undefined ? {} : { accessibilitySnapshotId: observation.evidence.accessibility }),
      ...(domId === undefined || domPath === undefined ? {} : { domSnapshot: { id: domId, path: domPath } }),
      network: ids(["NETWORK_REQUEST", "NETWORK_RESPONSE", "NETWORK_FAILED"]),
      console: ids(["CONSOLE_MESSAGE"]),
      pageErrors: ids(["PAGE_ERROR"]),
      window: { fromEventId: from.id, toEventId: last.id },
    };
  }
}

/**
 * Identity of a failure, used to decide whether two attempts failed "the
 * same way": same step, same expectation, same observed value.
 */
export function failureSignature(result: Pick<AssertionResult, "stepIndex" | "stepId" | "kind" | "actual">): string {
  return `step:${result.stepIndex}|${result.stepId ?? result.kind}|actual=${canonicalJson(result.actual)}`;
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

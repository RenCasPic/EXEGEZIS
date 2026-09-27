import { stepMessage } from "./describe-messages.js";
import { englishOf, msg } from "./messages.js";
import type { RunOutcome } from "./execute.js";
import { describeTarget } from "./schemas/target.js";
import type { AssertionResult } from "./schemas/assertion.js";
import type { Reproduction } from "./schemas/reproduction.js";
import type { PlanStep, TestPlan } from "./schemas/test-plan.js";
import type { TimelineEvent } from "./schemas/timeline.js";
import type { PlanValidation } from "./validation.js";
import {
  BugReport,
  deriveOutcome,
  evaluateVerification,
  type CompiledTestExecution,
  type EvidenceChainLink,
  type EvidenceRef,
  type VerificationPolicy,
} from "./schemas/verification.js";

export interface BugReportInput {
  plan: TestPlan;
  /** Path of the plan file as given by the user. */
  planPath: string;
  planHash: string;
  validation: PlanValidation;
  reproduction: Reproduction;
  /** Reproduction directory, relative to the report's directory ("." if the same). */
  reproductionPath: string;
  /** All attempts, in order; the first failing one is the representative. */
  outcomes: readonly RunOutcome[];
  compiledTest?: CompiledTestExecution;
  policy: VerificationPolicy;
  exegezisVersion: string;
  generatedAt?: string;
}

/**
 * Assembles a bug report from observable results only. The status is derived
 * from `evaluateVerification`; nothing in the input can set it directly.
 */
export function buildBugReport(input: BugReportInput): BugReport {
  const { plan, reproduction, outcomes } = input;
  const representative = outcomes.find((o) => o.verdict === "failed");
  const failed = representative?.assertions.find((a) => a.status === "failed");
  const runPath = representative === undefined ? undefined : join(input.reproductionPath, "attempts", representative.runId);

  const criteria = evaluateVerification({
    plan,
    validation: input.validation,
    reproduction,
    ...(representative !== undefined && failed !== undefined
      ? {
          representative: {
            assertion: failed,
            assertions: representative.assertions,
            manifest: representative.manifest,
            ...(representative.stoppedAtStep === undefined ? {} : { stoppedAtStep: representative.stoppedAtStep }),
          },
        }
      : {}),
    ...(input.compiledTest === undefined ? {} : { compiledTest: input.compiledTest }),
    policy: input.policy,
  });

  const { outcome, reason: outcomeReason, message: outcomeMessage } = deriveOutcome(input.validation, reproduction, criteria);
  return BugReport.parse({
    schemaVersion: "exegezis.bug-report/v1",
    bugId: plan.id,
    title: plan.title,
    ...(plan.description === undefined ? {} : { description: plan.description }),
    outcome,
    outcomeReason,
    outcomeMessage,
    provenance: plan.provenance,
    validation: { status: input.validation.status, issues: input.validation.issues, reference: input.validation.reference },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    exegezisVersion: input.exegezisVersion,
    policy: input.policy,
    criteria,
    target: reproduction.targetUrl,
    expected:
      failed === undefined ? null : { description: failed.description, assertion: failed.assertion, value: failed.expected },
    actual: failed === undefined ? null : { value: failed.actual, message: failed.message, ...(failed.detail === undefined ? {} : { detail: failed.detail }) },
    failingStep:
      failed === undefined ? null : { index: failed.stepIndex, ...(failed.stepId === undefined ? {} : { id: failed.stepId }) },
    reproduction: {
      path: join(input.reproductionPath, "reproduction.json"),
      status: reproduction.status,
      attempts: reproduction.attempts,
      passes: reproduction.passes,
      failures: reproduction.failures,
      timeouts: reproduction.timeouts,
      errors: reproduction.errors,
      rate: reproduction.rate,
      reason: reproduction.reason,
      ...(reproduction.message === undefined ? {} : { message: reproduction.message }),
    },
    evidence: representative === undefined || failed === undefined || runPath === undefined ? [] : evidenceRefs(representative, failed, runPath),
    evidenceChain:
      representative === undefined || failed === undefined ? [] : evidenceChain(representative.timeline, failed),
    plan: { id: plan.id, path: input.planPath, hash: input.planHash },
    compiledTest: input.compiledTest ?? null,
    environment: representative?.metadata.environment ?? outcomes[0]?.metadata.environment ?? null,
  });
}

function join(...parts: string[]): string {
  return parts
    .filter((p) => p !== "" && p !== ".")
    .join("/")
    .replaceAll("\\", "/");
}

function evidenceRefs(outcome: RunOutcome, failed: AssertionResult, runPath: string): EvidenceRef[] {
  const present = new Set(outcome.manifest.artifacts.map((a) => a.path));
  const links = failed.evidence;
  const refs: EvidenceRef[] = [];
  const add = (ref: EvidenceRef): void => {
    const file = ref.path.slice(runPath.length + 1);
    if (present.has(file)) refs.push(ref);
  };
  add({ kind: "assertion", path: `${runPath}/assertions.json`, ref: failed.id, description: "Failed assertion: expected vs actual" });
  add({
    kind: "timeline",
    path: `${runPath}/timeline.json`,
    ...(links === undefined ? {} : { ref: `${links.window.fromEventId}..${links.window.toEventId}` }),
    description: "Events from the last action to the failure",
  });
  if (links?.screenshot !== undefined) {
    add({ kind: "screenshot", path: `${runPath}/${links.screenshot.path}`, ref: links.screenshot.id, description: "Page at the moment of the failure" });
  }
  if (links?.accessibilitySnapshotId !== undefined) {
    add({ kind: "accessibility", path: `${runPath}/accessibility.json`, ref: links.accessibilitySnapshotId, description: "Accessibility tree at the moment of the failure" });
  }
  if (links?.domSnapshot !== undefined) {
    add({ kind: "dom", path: `${runPath}/${links.domSnapshot.path}`, ref: links.domSnapshot.id, description: "DOM at the moment of the failure" });
  }
  add({
    kind: "network",
    path: `${runPath}/network.json`,
    ...(links === undefined || links.network.length === 0 ? {} : { ref: links.network.join(",") }),
    description: `${links?.network.length ?? 0} network exchange(s) between the last action and the failure`,
  });
  add({
    kind: "console",
    path: `${runPath}/console.json`,
    ...(links === undefined || links.console.length + links.pageErrors.length === 0 ? {} : { ref: [...links.console, ...links.pageErrors].join(",") }),
    description: `${links?.console.length ?? 0} console message(s) and ${links?.pageErrors.length ?? 0} page error(s) in the same window`,
  });
  add({ kind: "trace", path: `${runPath}/trace.zip`, description: "Playwright trace of the whole attempt" });
  add({ kind: "metadata", path: `${runPath}/metadata.json`, description: "Environment and configuration of the attempt" });
  return refs;
}

function evidenceChain(timeline: readonly TimelineEvent[], failed: AssertionResult): EvidenceChainLink[] {
  const links = failed.evidence;
  const chain: EvidenceChainLink[] = [
    { stage: "expectation", ref: `step ${failed.stepIndex}`, summary: failed.description },
  ];
  const action = timeline.find((e) => e.id === links?.actionEventId);
  if (action?.type === "ACTION_STARTED") {
    chain.push({ stage: "action", ref: action.id, summary: describeStep(action.payload.step), message: stepMessage(action.payload.step) });
  }
  if (links?.observationId !== undefined) {
    chain.push({
      stage: "observation",
      ref: links.observationId,
      summary: [links.screenshot?.id, links.accessibilitySnapshotId, links.domSnapshot?.id].filter(Boolean).join(" + "),
    });
  }
  const evaluated = msg("chainAssertion", { kind: failed.kind, attempts: failed.attempts, ms: Math.round(failed.durationMs) });
  chain.push({ stage: "assertion", ref: links?.assertionEventId ?? failed.id, summary: englishOf(evaluated), message: evaluated });
  chain.push({ stage: "failure", ref: failed.id, summary: failed.message, ...(failed.detail === undefined ? {} : { message: failed.detail }) });
  if (links !== undefined) {
    const window = msg("chainWindow", { network: links.network.length, console: links.console.length, errors: links.pageErrors.length });
    chain.push({ stage: "evidence", ref: `${links.window.fromEventId}..${links.window.toEventId}`, summary: englishOf(window), message: window });
  }
  return chain;
}

function describeStep(step: PlanStep): string {
  switch (step.type) {
    case "navigate":
      return `navigate ${step.url}`;
    case "click":
      return `click ${describeTarget(step.target)}`;
    case "fill":
      return `fill ${describeTarget(step.target)}`;
    case "press":
      return `press ${step.key}${step.target === undefined ? "" : ` on ${describeTarget(step.target)}`}`;
    case "wait":
      return `wait for ${step.condition.kind}`;
    case "screenshot":
      return "screenshot";
    case "assert":
      return "assert";
    case "observe":
      return "observe";
  }
}

import { z } from "zod";
import { EngineMessage, englishOf, msg } from "../messages.js";
import { PlanValidation } from "../validation.js";
import { Assertion, type AssertionResult } from "./assertion.js";
import { Timestamp } from "./common.js";
import type { ArtifactManifest, ArtifactType } from "./manifest.js";
import { Provenance } from "./policy.js";
import { Reproduction } from "./reproduction.js";
import { RunEnvironment } from "./run.js";
import { hasAssertions, type TestPlan } from "./test-plan.js";

export const VerificationPolicy = z.strictObject({
  /** A single failing run proves nothing about reproducibility. */
  minAttempts: z.int().min(2).default(3),
  /**
   * Require every expectation to be preceded by an anchor and an action
   * (see validation). A weakly anchored plan can still run, but a failure it
   * finds is not strong enough to be a Verified Bug.
   */
  requireStrongAnchoring: z.boolean().default(true),
});
export type VerificationPolicy = z.infer<typeof VerificationPolicy>;

export const CriterionId = z.enum([
  "plan_valid",
  "expectation_defined",
  "anchored",
  "reproduced",
  "evidence_captured",
  "executable_test",
]);
export type CriterionId = z.infer<typeof CriterionId>;

export const VerificationCriterion = z.strictObject({
  id: CriterionId,
  description: z.string(),
  met: z.boolean(),
  /** English. */
  detail: z.string(),
  /** The same detail as a code and parameters, for every language (absent in older reports). */
  message: EngineMessage.optional(),
});
export type VerificationCriterion = z.infer<typeof VerificationCriterion>;

/** Result of running the compiled spec with the standard Playwright runner. */
export const CompiledTestExecution = z.strictObject({
  specPath: z.string(),
  sha256: z.string(),
  status: z.enum(["passed", "failed", "error", "not_run"]),
  exitCode: z.int().nullable(),
  /** Plan step the spec failed at, mapped from the failure's source line. */
  failedAtStep: z.int().positive().optional(),
  message: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  runner: z.string(),
});
export type CompiledTestExecution = z.infer<typeof CompiledTestExecution>;

/** Artifacts a failing run must contain to count as evidence. */
export const REQUIRED_EVIDENCE: readonly ArtifactType[] = [
  "timeline",
  "assertions",
  "screenshot",
  "accessibility",
  "console",
  "network",
  "trace",
];

/**
 * The outcome of verifying a plan. Distinguishable on purpose:
 * - `VERIFIED`: every criterion is met. The only positive outcome.
 * - `NOT_VERIFIED`: the plan was valid and ran conclusively, and the
 *   expectation held every time: no bug demonstrated.
 * - `INCONCLUSIVE`: the plan ran but the results cannot support a conclusion
 *   (timeouts, execution errors, unstable failures, a failing anchor, weak
 *   anchoring, missing evidence, disagreement with the compiled test...).
 * - `FLAKY`: the same plan both passed and failed.
 * - `INVALID_PLAN`: semantic validation proved the plan wrong before running it.
 * - `UNSUPPORTED`: the plan needs capabilities the adapter does not have.
 */
export const VerificationOutcome = z.enum(["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE", "FLAKY", "INVALID_PLAN", "UNSUPPORTED"]);
export type VerificationOutcome = z.infer<typeof VerificationOutcome>;

const CRITERIA_DESCRIPTIONS: Record<CriterionId, string> = {
  plan_valid: "A semantically valid plan",
  expectation_defined: "A defined expected behavior",
  anchored: "An expectation anchored in a verified state",
  reproduced: "A reproducible failing execution",
  evidence_captured: "Captured evidence",
  executable_test: "A deterministic executable test that fails",
};

export interface VerificationInput {
  plan: TestPlan;
  validation: PlanValidation;
  reproduction: Reproduction;
  /** One failing attempt: its failed assertion, all its assertion results and its manifest. */
  representative?: {
    assertion: AssertionResult;
    assertions: readonly AssertionResult[];
    manifest: ArtifactManifest;
    stoppedAtStep?: number;
  };
  compiledTest?: CompiledTestExecution;
  policy: VerificationPolicy;
}

/**
 * The only way a bug becomes `verified`: every criterion is checked against
 * observable results. There is no input through which a model (or a person)
 * can simply declare a bug verified.
 */
export function evaluateVerification(input: VerificationInput): VerificationCriterion[] {
  const { plan, validation, reproduction, representative, compiledTest, policy } = input;
  const criterion = (id: CriterionId, met: boolean, message: EngineMessage): VerificationCriterion => ({
    id,
    description: CRITERIA_DESCRIPTIONS[id],
    met,
    detail: englishOf(message),
    message,
  });

  const usable = validation.status === "valid" || validation.status === "weakly_anchored";
  const blocking = validation.issues.filter((i) => i.severity === "error" || i.severity === "unsupported").map((i) => i.code);
  const planValid = criterion(
    "plan_valid",
    usable,
    usable
      ? validation.reference === null
        ? msg("critValidation", { status: validation.status })
        : msg("critValidationChecked", { status: validation.status, targets: validation.reference.targetsChecked })
      : msg("critValidationBlocked", { status: validation.status, codes: blocking.join(", ") }),
  );

  const expectations = plan.steps.filter((s) => s.type === "assert" && s.purpose === "expectation").length;
  const anchors = plan.steps.filter((s) => s.type === "assert" && s.purpose === "anchor").length;
  const expectation = criterion(
    "expectation_defined",
    hasAssertions(plan) && expectations > 0,
    expectations > 0 ? msg("critExpectations", { expectations, anchors, plan: plan.id }) : msg("critNoExpectation"),
  );

  const anchored = criterion("anchored", ...checkAnchoring(input));

  const enoughAttempts = reproduction.attempts >= policy.minAttempts;
  const reproduced = criterion(
    "reproduced",
    reproduction.status === "REPRODUCED" && enoughAttempts,
    msg(enoughAttempts ? "critReproduced" : "critReproducedTooFew", {
      status: reproduction.status,
      failures: reproduction.failures,
      attempts: reproduction.attempts,
      errors: reproduction.errors,
      ...(enoughAttempts ? {} : { min: policy.minAttempts }),
    }),
  );

  const evidence = criterion("evidence_captured", ...checkEvidence(representative));

  let executable: VerificationCriterion;
  if (compiledTest === undefined || compiledTest.status === "not_run") {
    executable = criterion("executable_test", false, msg("critTestNotRun"));
  } else if (compiledTest.status !== "failed") {
    executable = criterion(
      "executable_test",
      false,
      compiledTest.status === "passed" ? msg("critTestPassed") : msg("critTestCouldNotRun", { message: compiledTest.message ?? "unknown error" }),
    );
  } else if (representative === undefined || compiledTest.failedAtStep !== representative.stoppedAtStep) {
    executable = criterion(
      "executable_test",
      false,
      msg("critTestOtherStep", { failed: compiledTest.failedAtStep ?? "?", observed: representative?.stoppedAtStep ?? "?" }),
    );
  } else {
    executable = criterion(
      "executable_test",
      true,
      msg("critTestSameStep", { runner: compiledTest.runner, step: compiledTest.failedAtStep ?? "?" }),
    );
  }

  return [planValid, expectation, anchored, reproduced, evidence, executable];
}

function checkAnchoring({ validation, representative, policy }: VerificationInput): [boolean, EngineMessage] {
  const weak = validation.issues.filter((i) => i.severity === "anchoring");
  if (policy.requireStrongAnchoring && weak.length > 0) {
    // A list of messages would be joined with «; »; these steps are joined with commas, as always.
    return [false, msg("critWeaklyAnchored", { steps: weak.map((i) => englishOf(msg("critWeakStep", { step: i.stepIndex ?? "?", code: i.code }))).join(", ") })];
  }
  if (representative === undefined) {
    return [weak.length === 0, weak.length === 0 ? msg("critAnchoredEvery") : msg("critWeakAllowed")];
  }
  const failing = representative.assertion;
  if (failing.purpose !== "expectation") return [false, msg("critFailingIsAnchor", { step: failing.stepIndex })];
  const anchorResults = representative.assertions.filter((a) => a.purpose === "anchor" && a.stepIndex < failing.stepIndex);
  if (policy.requireStrongAnchoring && anchorResults.length === 0) return [false, msg("critNoAnchorEvaluated")];
  const notPassed = anchorResults.filter((a) => a.status !== "passed");
  if (notPassed.length > 0) return [false, msg("critAnchorsNotPassed", { steps: notPassed.map((a) => a.stepIndex).join(", ") })];
  return [true, msg("critAnchorsPassed", { count: anchorResults.length, step: failing.stepIndex })];
}

/**
 * Deterministic mapping from validation, reproduction and criteria to one
 * outcome. Precedence: UNSUPPORTED > INVALID_PLAN > FLAKY > NOT_VERIFIED >
 * INCONCLUSIVE > VERIFIED (which requires every criterion).
 */
export function deriveOutcome(
  validation: PlanValidation,
  reproduction: Pick<Reproduction, "status" | "reason" | "message">,
  criteria: readonly VerificationCriterion[],
): { outcome: VerificationOutcome; reason: string; message: EngineMessage } {
  const out = (outcome: VerificationOutcome, message: EngineMessage) => ({ outcome, reason: englishOf(message), message });
  /** An issue, a reproduction or a criterion from an older report may have only its English text. */
  const issueMessage = (i: { message: string; detail?: EngineMessage | undefined }) => i.detail ?? msg("outcomeIssues", { issues: i.message });
  if (validation.status === "unsupported") {
    return out("UNSUPPORTED", msg("outcomeIssues", { issues: validation.issues.filter((i) => i.severity === "unsupported").map(issueMessage) }));
  }
  if (validation.status === "invalid") {
    return out("INVALID_PLAN", msg("outcomeIssues", { issues: validation.issues.filter((i) => i.severity === "error").map(issueMessage) }));
  }
  const reproductionMessage = reproduction.message ?? msg("outcomeIssues", { issues: reproduction.reason });
  switch (reproduction.status) {
    case "FLAKY":
      return out("FLAKY", reproductionMessage);
    case "NOT_REPRODUCED":
      return out("NOT_VERIFIED", msg("outcomeExpectationHeld", { reason: reproductionMessage }));
    case "NOT_RUN":
    case "INCONCLUSIVE":
      return out("INCONCLUSIVE", reproductionMessage);
    case "REPRODUCED": {
      const unmet = criteria.filter((c) => !c.met);
      return unmet.length === 0
        ? out("VERIFIED", msg("outcomeVerified"))
        : out("INCONCLUSIVE", msg("outcomeUnmet", { details: unmet.map((c) => c.message ?? msg("outcomeIssues", { issues: c.detail })) }));
    }
  }
}

function checkEvidence(representative: VerificationInput["representative"]): [boolean, EngineMessage] {
  if (representative === undefined) return [false, msg("critNoFailingAttempt")];
  const { assertion, manifest } = representative;
  if (assertion.status !== "failed") return [false, msg("critAssertionNotFailed", { status: assertion.status })];
  const links = assertion.evidence;
  if (links?.screenshot === undefined || links.accessibilitySnapshotId === undefined) return [false, msg("critNotLinked")];
  if (!manifest.complete) return [false, msg("critManifestIncomplete")];
  const present = new Set(manifest.artifacts.map((a) => a.type));
  const missing = REQUIRED_EVIDENCE.filter((type) => !present.has(type));
  if (missing.length > 0) return [false, msg("critMissingEvidence", { types: missing.join(", ") })];
  const leaking = manifest.artifacts.filter((a) => a.redaction === "failed").map((a) => a.path);
  if (leaking.length > 0) return [false, msg("critRedactionFailed", { paths: leaking.join(", ") })];
  return [true, msg("critEvidenceCaptured", { types: REQUIRED_EVIDENCE.join(", "), screenshot: links.screenshot.id, snapshot: links.accessibilitySnapshotId })];
}

export const EvidenceRef = z.strictObject({
  kind: z.enum(["timeline", "assertion", "screenshot", "accessibility", "dom", "console", "network", "trace", "metadata", "inspection"]),
  /** Path relative to the verification (or reproduction) directory. */
  path: z.string(),
  /** Evidence id inside the file, when the file holds many records. */
  ref: z.string().optional(),
  description: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/** Expectation → Action → Observation → Assertion → Failure → Evidence. */
export const EvidenceChainLink = z.strictObject({
  stage: z.enum(["expectation", "action", "observation", "assertion", "failure", "evidence"]),
  ref: z.string(),
  /** English, or content (the plan's own description of the expectation). */
  summary: z.string(),
  /** The summary as a code and parameters, when the engine wrote it (absent for content and in older reports). */
  message: EngineMessage.optional(),
});
export type EvidenceChainLink = z.infer<typeof EvidenceChainLink>;

export const BugReport = z
  .strictObject({
    schemaVersion: z.literal("exegezis.bug-report/v1"),
    bugId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    outcome: VerificationOutcome,
    /** Deterministic explanation of `outcome` (English). */
    outcomeReason: z.string(),
    /** The same explanation as a code and parameters, for every language (absent in older reports). */
    outcomeMessage: EngineMessage.optional(),
    /** Where the plan came from (human, model...), carried from the plan. */
    provenance: Provenance,
    validation: PlanValidation.pick({ status: true, issues: true, reference: true }),
    generatedAt: Timestamp,
    exegezisVersion: z.string(),
    policy: VerificationPolicy,
    criteria: z.array(VerificationCriterion).length(6),
    target: z.string(),
    expected: z.strictObject({ description: z.string(), assertion: Assertion, value: z.json() }).nullable(),
    actual: z.strictObject({ value: z.json(), message: z.string(), detail: EngineMessage.optional() }).nullable(),
    failingStep: z.strictObject({ index: z.int().positive(), id: z.string().optional() }).nullable(),
    reproduction: z.strictObject({
      path: z.string(),
      status: Reproduction.shape.status,
      attempts: z.int().nonnegative(),
      passes: z.int().nonnegative(),
      failures: z.int().nonnegative(),
      timeouts: z.int().nonnegative(),
      errors: z.int().nonnegative(),
      rate: z.number().nullable(),
      reason: z.string(),
      message: EngineMessage.optional(),
    }),
    evidence: z.array(EvidenceRef),
    evidenceChain: z.array(EvidenceChainLink),
    plan: z.strictObject({ id: z.string(), path: z.string(), hash: z.string() }),
    compiledTest: CompiledTestExecution.nullable(),
    environment: RunEnvironment.nullable(),
  })
  .refine((report) => (report.outcome === "VERIFIED") === report.criteria.every((c) => c.met), {
    message: "outcome must be VERIFIED if and only if every criterion is met",
    path: ["outcome"],
  });
export type BugReport = z.infer<typeof BugReport>;

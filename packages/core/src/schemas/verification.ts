import { z } from "zod";
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
  detail: z.string(),
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
  const criterion = (id: CriterionId, met: boolean, detail: string): VerificationCriterion => ({
    id,
    description: CRITERIA_DESCRIPTIONS[id],
    met,
    detail,
  });

  const usable = validation.status === "valid" || validation.status === "weakly_anchored";
  const blocking = validation.issues.filter((i) => i.severity === "error" || i.severity === "unsupported").map((i) => i.code);
  const planValid = criterion(
    "plan_valid",
    usable,
    usable
      ? `semantic validation: ${validation.status}${
          validation.reference === null
            ? " (no reference observation)"
            : `, ${validation.reference.targetsChecked} target(s) checked against the observed page`
        }`
      : `semantic validation: ${validation.status} (${blocking.join(", ")})`,
  );

  const expectations = plan.steps.filter((s) => s.type === "assert" && s.purpose === "expectation").length;
  const anchors = plan.steps.filter((s) => s.type === "assert" && s.purpose === "anchor").length;
  const expectation = criterion(
    "expectation_defined",
    hasAssertions(plan) && expectations > 0,
    expectations > 0
      ? `${expectations} expectation(s) and ${anchors} anchor(s) declared in plan ${plan.id}`
      : "the plan declares no expectation",
  );

  const anchored = criterion("anchored", ...checkAnchoring(input));

  const enoughAttempts = reproduction.attempts >= policy.minAttempts;
  const reproduced = criterion(
    "reproduced",
    reproduction.status === "REPRODUCED" && enoughAttempts,
    `${reproduction.status}: ${reproduction.failures}/${reproduction.attempts} failed, ${reproduction.errors} errors` +
      (enoughAttempts ? "" : ` (at least ${policy.minAttempts} attempts required)`),
  );

  const evidence = criterion("evidence_captured", ...checkEvidence(representative));

  let executable: VerificationCriterion;
  if (compiledTest === undefined || compiledTest.status === "not_run") {
    executable = criterion("executable_test", false, "the compiled test was not executed");
  } else if (compiledTest.status !== "failed") {
    executable = criterion(
      "executable_test",
      false,
      compiledTest.status === "passed"
        ? "the compiled test passed: it does not demonstrate the failure"
        : `the compiled test could not run: ${compiledTest.message ?? "unknown error"}`,
    );
  } else if (representative === undefined || compiledTest.failedAtStep !== representative.stoppedAtStep) {
    executable = criterion(
      "executable_test",
      false,
      `the compiled test failed at step ${compiledTest.failedAtStep ?? "?"} but EXEGEZIS observed the failure at step ${representative?.stoppedAtStep ?? "?"}`,
    );
  } else {
    executable = criterion(
      "executable_test",
      true,
      `${compiledTest.runner} failed at step ${compiledTest.failedAtStep}, the same step EXEGEZIS observed`,
    );
  }

  return [planValid, expectation, anchored, reproduced, evidence, executable];
}

function checkAnchoring({ validation, representative, policy }: VerificationInput): [boolean, string] {
  const weak = validation.issues.filter((i) => i.severity === "anchoring");
  if (policy.requireStrongAnchoring && weak.length > 0) {
    return [false, `weakly anchored: ${weak.map((i) => `step ${i.stepIndex ?? "?"} ${i.code}`).join(", ")}`];
  }
  if (representative === undefined) {
    return [weak.length === 0, weak.length === 0 ? "every expectation is preceded by an anchor and an action" : "weakly anchored (allowed by policy)"];
  }
  const failing = representative.assertion;
  if (failing.purpose !== "expectation") {
    return [
      false,
      `the failing assertion (step ${failing.stepIndex}) is an anchor: the premise of the plan about the application does not hold, which is not a bug`,
    ];
  }
  const anchorResults = representative.assertions.filter((a) => a.purpose === "anchor" && a.stepIndex < failing.stepIndex);
  if (policy.requireStrongAnchoring && anchorResults.length === 0) {
    return [false, "no anchor was evaluated before the failing expectation"];
  }
  const notPassed = anchorResults.filter((a) => a.status !== "passed");
  if (notPassed.length > 0) return [false, `anchor(s) did not pass: steps ${notPassed.map((a) => a.stepIndex).join(", ")}`];
  return [true, `${anchorResults.length} anchor(s) passed before the failing expectation at step ${failing.stepIndex}`];
}

/**
 * Deterministic mapping from validation, reproduction and criteria to one
 * outcome. Precedence: UNSUPPORTED > INVALID_PLAN > FLAKY > NOT_VERIFIED >
 * INCONCLUSIVE > VERIFIED (which requires every criterion).
 */
export function deriveOutcome(
  validation: PlanValidation,
  reproduction: Pick<Reproduction, "status" | "reason">,
  criteria: readonly VerificationCriterion[],
): { outcome: VerificationOutcome; reason: string } {
  if (validation.status === "unsupported") {
    const messages = validation.issues.filter((i) => i.severity === "unsupported").map((i) => i.message);
    return { outcome: "UNSUPPORTED", reason: messages.join("; ") };
  }
  if (validation.status === "invalid") {
    const messages = validation.issues.filter((i) => i.severity === "error").map((i) => i.message);
    return { outcome: "INVALID_PLAN", reason: messages.join("; ") };
  }
  switch (reproduction.status) {
    case "FLAKY":
      return { outcome: "FLAKY", reason: reproduction.reason };
    case "NOT_REPRODUCED":
      return { outcome: "NOT_VERIFIED", reason: `the expectation held: ${reproduction.reason}` };
    case "NOT_RUN":
    case "INCONCLUSIVE":
      return { outcome: "INCONCLUSIVE", reason: reproduction.reason };
    case "REPRODUCED": {
      const unmet = criteria.filter((c) => !c.met);
      return unmet.length === 0
        ? { outcome: "VERIFIED", reason: "every verification criterion is met" }
        : { outcome: "INCONCLUSIVE", reason: `the failure reproduced, but: ${unmet.map((c) => c.detail).join("; ")}` };
    }
  }
}

function checkEvidence(representative: VerificationInput["representative"]): [boolean, string] {
  if (representative === undefined) return [false, "no failing attempt to take evidence from"];
  const { assertion, manifest } = representative;
  if (assertion.status !== "failed") return [false, `the representative assertion is ${assertion.status}, not failed`];
  const links = assertion.evidence;
  if (links?.screenshot === undefined || links.accessibilitySnapshotId === undefined) {
    return [false, "the failed assertion is not linked to a screenshot and an accessibility snapshot"];
  }
  if (!manifest.complete) return [false, "the failing run's manifest is incomplete"];
  const present = new Set(manifest.artifacts.map((a) => a.type));
  const missing = REQUIRED_EVIDENCE.filter((type) => !present.has(type));
  if (missing.length > 0) return [false, `missing evidence: ${missing.join(", ")}`];
  const leaking = manifest.artifacts.filter((a) => a.redaction === "failed").map((a) => a.path);
  if (leaking.length > 0) return [false, `redaction failed for: ${leaking.join(", ")}`];
  return [true, `${REQUIRED_EVIDENCE.join(", ")} captured; failure linked to ${links.screenshot.id} and ${links.accessibilitySnapshotId}`];
}

export const EvidenceRef = z.strictObject({
  kind: z.enum(["timeline", "assertion", "screenshot", "accessibility", "dom", "console", "network", "trace", "metadata"]),
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
  summary: z.string(),
});
export type EvidenceChainLink = z.infer<typeof EvidenceChainLink>;

export const BugReport = z
  .strictObject({
    schemaVersion: z.literal("exegezis.bug-report/v1"),
    bugId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    outcome: VerificationOutcome,
    /** Deterministic explanation of `outcome`. */
    outcomeReason: z.string(),
    /** Where the plan came from (human, model...), carried from the plan. */
    provenance: Provenance,
    validation: PlanValidation.pick({ status: true, issues: true, reference: true }),
    generatedAt: Timestamp,
    exegezisVersion: z.string(),
    policy: VerificationPolicy,
    criteria: z.array(VerificationCriterion).length(6),
    target: z.string(),
    expected: z.strictObject({ description: z.string(), assertion: Assertion, value: z.json() }).nullable(),
    actual: z.strictObject({ value: z.json(), message: z.string() }).nullable(),
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

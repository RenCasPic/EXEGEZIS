import { z } from "zod";
import { RelativePath, Timestamp } from "./common.js";
import { Provenance } from "./policy.js";
import { executionsAt, footprintDiff, ScriptCoverage } from "./coverage.js";
import { ReproductionStatus } from "./reproduction.js";
import { RunVerdict } from "./run.js";
import type { TestPlan } from "./test-plan.js";

/*
 * Root cause by intervention (see docs/06-root-cause-engine.md).
 *
 * A hypothesis names a cause and an intervention that neutralizes it, with a
 * prediction of what the reproduction will do afterwards. The engine applies
 * the intervention to an isolated copy of the application, runs the same
 * reproduction as the untouched baseline and compares counts. Every status
 * here is derived by functions in this file from those counts: a model (or a
 * person) can propose a hypothesis, never declare it validated.
 */

/**
 * The only intervention family implemented: replace one exact, unique piece
 * of source text in one file of the application copy.
 */
export const CodeMutation = z.strictObject({
  kind: z.literal("replace"),
  /** File inside the application directory, e.g. `src/shop.ts`. */
  file: RelativePath,
  /** Exact text to replace. It must occur exactly once in the file. */
  find: z.string().min(1),
  replace: z.string(),
  description: z.string().min(1).max(500),
});
export type CodeMutation = z.infer<typeof CodeMutation>;

/**
 * - `eliminates`: if the hypothesis is true, neutralizing the cause makes the
 *   failure disappear in every run.
 * - `persists`: the intervention should not matter (e.g. a sham change); the
 *   failure must reproduce in every run.
 */
export const Prediction = z.enum(["eliminates", "persists"]);
export type Prediction = z.infer<typeof Prediction>;

/** An observation from the verified reproduction that a hypothesis relies on. */
export const CausalObservation = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  statement: z.string().min(1).max(500),
  /** Where it was observed (artifact and evidence id), in words. */
  source: z.string().min(1).max(300),
});
export type CausalObservation = z.infer<typeof CausalObservation>;

export const Hypothesis = z.strictObject({
  id: z.string().regex(/^H[0-9]+$/, "hypothesis ids are H1, H2, ..."),
  /** What we claim is the cause. */
  statement: z.string().min(1).max(500),
  /** Why we believe it. Reasoning, not evidence. */
  rationale: z.string().min(1).max(1000),
  /** Observations (by id) the hypothesis is consistent with. */
  observations: z.array(z.string()).default([]),
  location: z.strictObject({ file: RelativePath, symbol: z.string().max(120).optional() }),
  intervention: CodeMutation,
  /**
   * A hypothesis names a cause; its intervention neutralizes that cause, so
   * it always predicts that the bug disappears. (`persists` is reserved for
   * controls, which are not hypotheses.)
   */
  prediction: z.literal("eliminates"),
  /** Who proposed it. Being proposed by a model is not evidence of anything. */
  provenance: Provenance,
});
export type Hypothesis = z.infer<typeof Hypothesis>;

/** The minimum experimental standard. Documented in docs/06-root-cause-engine.md. */
export const RootCausePolicy = z.strictObject({
  /** Runs per arm (baseline and each intervention). */
  runsPerArm: z.int().min(2).max(50).default(5),
  /** A single confirmed hypothesis is not enough: at least this many competitors must be refuted. */
  minRefutedAlternatives: z.int().min(0).default(1),
  /** Runs of the control scenario (the plan's prefix, where the baseline is correct) per arm. */
  controlRuns: z.int().min(1).max(20).default(2),
  /** The intervention site must have executed in the baseline's failing scenario (relevance). */
  requireExecutedSite: z.boolean().default(true),
  /** Reverting the intervention must bring the bug back (A-B-A reversal). */
  requireReversal: z.boolean().default(true),
  /** The intervention must not change what executes where the baseline was already correct. */
  requireSurgical: z.boolean().default(true),
});
export type RootCausePolicy = z.infer<typeof RootCausePolicy>;

export const DEFAULT_ROOT_CAUSE_POLICY: RootCausePolicy = {
  runsPerArm: 5,
  minRefutedAlternatives: 1,
  controlRuns: 2,
  requireExecutedSite: true,
  requireReversal: true,
  requireSurgical: true,
};

/** The investigation input: everything the engine is given. Never the ground truth. */
export const RootCauseInvestigation = z
  .strictObject({
    schemaVersion: z.literal("exegezis.root-cause-investigation/v1"),
    bugId: z.string(),
    /** The reproduction plan (a verified bug), relative to this file. */
    plan: z.string(),
    app: z.strictObject({
      /** Application directory, relative to this file. */
      dir: z.string(),
      /** What is copied into each isolated workspace (no tests, no docs). */
      include: z.array(RelativePath).min(1),
      command: z.array(z.string().min(1)).min(1),
      portEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
      healthPath: z.string().regex(/^\//),
    }),
    policy: RootCausePolicy.default(DEFAULT_ROOT_CAUSE_POLICY),
    observations: z.array(CausalObservation).default([]),
    hypotheses: z.array(Hypothesis).min(1),
  })
  .refine((i) => new Set(i.hypotheses.map((h) => h.id)).size === i.hypotheses.length, { message: "hypothesis ids must be unique" })
  .refine((i) => i.hypotheses.every((h) => h.intervention.file === h.location.file), {
    message: "each intervention must modify the file its hypothesis names",
  });
export type RootCauseInvestigation = z.infer<typeof RootCauseInvestigation>;

/**
 * One attempt, relative to the bug:
 * - `reproduced`: an expectation assertion failed (the bug showed).
 * - `not_reproduced`: every assertion held.
 * - `invalid`: the run says nothing about the bug (an anchor failed, a
 *   timeout, an error): the premise of the plan did not hold.
 */
export const AttemptClass = z.enum(["reproduced", "not_reproduced", "invalid"]);
export type AttemptClass = z.infer<typeof AttemptClass>;

export const ArmAttempt = z.strictObject({
  attempt: z.int().positive(),
  runId: z.string(),
  runPath: z.string(),
  verdict: RunVerdict,
  stoppedAtStep: z.int().positive().optional(),
  failureSignature: z.string().optional(),
  classification: AttemptClass,
});
export type ArmAttempt = z.infer<typeof ArmAttempt>;

export const AppliedMutation = z.strictObject({
  file: RelativePath,
  sha256Before: z.string(),
  sha256After: z.string(),
  /** Unified-style diff of the change, for review. */
  diff: z.string(),
});
export type AppliedMutation = z.infer<typeof AppliedMutation>;

export const ArmCounts = z.strictObject({
  runs: z.int().nonnegative(),
  reproduced: z.int().nonnegative(),
  notReproduced: z.int().nonnegative(),
  invalid: z.int().nonnegative(),
});
export type ArmCounts = z.infer<typeof ArmCounts>;

const FootprintSchema = z.record(z.string(), z.int().nonnegative());

/**
 * The control scenario of an arm: the reproduction plan cut before the steps
 * where the bug happens (see `controlPlan`), run with execution coverage.
 * In the baseline every assertion of it holds: it is where the application
 * is already correct.
 */
export const ControlArm = z.strictObject({
  path: z.string(),
  runs: z.int().nonnegative(),
  /** Runs in which every assertion of the control scenario held. */
  passed: z.int().nonnegative(),
  /** Function execution counts (browser + server), summed over the runs. */
  footprint: FootprintSchema.nullable(),
  /** The browser footprint was identical in every run (determinism of the measure). */
  stable: z.boolean(),
  error: z.string().nullable(),
});
export type ControlArm = z.infer<typeof ControlArm>;

export const ExperimentArm = z
  .strictObject({
    label: z.enum(["baseline", "intervention", "reversal"]),
    /** Directory of the arm's reproduction, relative to the case directory. */
    path: z.string(),
    mutation: AppliedMutation.nullable(),
    counts: ArmCounts,
    /** reproduced / runs (0 when there were no runs). */
    rate: z.number().min(0).max(1),
    reproductionStatus: ReproductionStatus,
    attempts: z.array(ArmAttempt),
    /** Function execution counts of the full scenario (browser + server), summed over the runs. */
    footprint: FootprintSchema.nullable(),
    /** Per-file block coverage of the full scenario (baseline only; used to locate intervention sites). */
    coverage: z.array(ScriptCoverage).nullable(),
    control: ControlArm.nullable(),
    error: z.string().nullable(),
  })
  .refine((a) => a.counts.reproduced + a.counts.notReproduced + a.counts.invalid === a.counts.runs, {
    message: "reproduced + notReproduced + invalid must equal runs",
  });
export type ExperimentArm = z.infer<typeof ExperimentArm>;

/**
 * - `CONFIRMED`: the result is exactly what the prediction said, in every run.
 * - `FALSIFIED`: every run did the opposite of the prediction.
 * - `INCONCLUSIVE`: anything else (partial effect, invalid runs, the mutation
 *   could not be applied, no stable baseline).
 */
export const ExperimentStatus = z.enum(["CONFIRMED", "FALSIFIED", "INCONCLUSIVE"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const Specificity = z.strictObject({
  /**
   * - `surgical`: the control scenario executes exactly the same functions, the
   *   same number of times, with and without the intervention.
   * - `not_surgical`: the intervention changed execution (or broke an
   *   assertion) where the baseline was already correct.
   * - `unknown`: no control scenario or no coverage to compare.
   */
  status: z.enum(["surgical", "not_surgical", "unknown"]),
  changed: z.array(z.strictObject({ key: z.string(), baseline: z.int(), other: z.int() })),
  reason: z.string(),
});
export type Specificity = z.infer<typeof Specificity>;

export const Experiment = z.strictObject({
  id: z.string(),
  hypothesisId: z.string(),
  intervention: CodeMutation,
  prediction: Prediction,
  baseline: ArmCounts,
  /** SUFFICIENCY: the intervention applied, the full reproduction run. */
  arm: ExperimentArm,
  /** intervention rate − baseline rate. */
  delta: z.number(),
  result: z.strictObject({ status: ExperimentStatus, reason: z.string() }),
  /** RELEVANCE: executions, in the baseline's failing scenario, of the block the intervention modifies. */
  site: z.strictObject({ file: RelativePath, offset: z.int().nonnegative().nullable(), executions: z.int().nonnegative().nullable() }),
  /** SPECIFICITY: does the intervention change execution where the baseline was correct? */
  specificity: Specificity,
  /** REVERSAL (A-B-A): the original code again, after the intervention; the bug must return. Only for confirmed interventions. */
  reversal: ExperimentArm.nullable(),
  startedAt: Timestamp,
  finishedAt: Timestamp,
});
export type Experiment = z.infer<typeof Experiment>;

export const HypothesisStatus = z.enum(["SUPPORTED", "REFUTED", "UNRESOLVED"]);
export type HypothesisStatus = z.infer<typeof HypothesisStatus>;

export const RootCauseStatus = z.enum(["VALIDATED", "REFUTED", "INSUFFICIENT_EVIDENCE"]);
export type RootCauseStatus = z.infer<typeof RootCauseStatus>;

export const HypothesisOutcome = z.strictObject({
  id: z.string(),
  statement: z.string(),
  status: HypothesisStatus,
  experimentId: z.string().nullable(),
  reason: z.string(),
});
export type HypothesisOutcome = z.infer<typeof HypothesisOutcome>;

/**
 * One line of the evidence matrix. Every status is computed from recorded
 * measurements by `evidenceMatrix`; `unknown` means the measurement is missing
 * or cannot be made, and it never counts as met.
 */
export const EvidenceId = z.enum([
  "bug_reproduced",
  "site_executed",
  "intervention_removes_bug",
  "prediction_confirmed",
  "reversal_restores_bug",
  "intervention_surgical",
  "alternatives_refuted",
  "unique_survivor",
  "hypothesis_space_complete",
]);
export type EvidenceId = z.infer<typeof EvidenceId>;

export const EvidenceItem = z.strictObject({
  id: EvidenceId,
  label: z.string(),
  status: z.enum(["met", "not_met", "unknown", "not_applicable"]),
  /** Whether the current policy requires it for VALIDATED. */
  required: z.boolean(),
  detail: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/**
 * - `NONE`: the bug was not reproduced in every baseline run.
 * - `REPRODUCED`: reproduced, but no intervention removed it.
 * - `SUFFICIENT`: an intervention removes the bug, but it is not the only one
 *   or its alternatives were not refuted.
 * - `CANDIDATE`: the only surviving hypothesis, alternatives refuted, but
 *   evidence that the intervention hits the cause (and not a compensating
 *   change) is missing. A root cause candidate, not a root cause.
 * - `VALIDATED`: every required evidence item is met.
 */
export const EvidenceLevel = z.enum(["NONE", "REPRODUCED", "SUFFICIENT", "CANDIDATE", "VALIDATED"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;

export const RootCauseDecision = z.strictObject({
  status: RootCauseStatus,
  /** Set only when VALIDATED. */
  hypothesisId: z.string().nullable(),
  /** The surviving hypothesis when there is exactly one, validated or not. */
  candidateHypothesisId: z.string().nullable(),
  evidenceLevel: EvidenceLevel,
  statement: z.string().nullable(),
  reason: z.string(),
  /** Required evidence that is not met (empty when VALIDATED). */
  missing: z.array(EvidenceId),
});
export type RootCauseDecision = z.infer<typeof RootCauseDecision>;

export const RootCauseReport = z
  .strictObject({
    schemaVersion: z.literal("exegezis.root-cause-report/v2"),
    bugId: z.string(),
    planId: z.string(),
    planPath: z.string(),
    policy: RootCausePolicy,
    generatedAt: Timestamp,
    exegezisVersion: z.string(),
    observations: z.array(CausalObservation),
    hypotheses: z.array(Hypothesis),
    baseline: ExperimentArm,
    experiments: z.array(Experiment),
    outcomes: z.array(HypothesisOutcome),
    /** Evidence of the surviving hypothesis (if exactly one), item by item. */
    evidence: z.array(EvidenceItem),
    decision: RootCauseDecision,
    /** Proof that the source application was never modified. */
    isolation: z.strictObject({
      sourceDir: z.string(),
      files: z.int().nonnegative(),
      treeHashBefore: z.string(),
      treeHashAfter: z.string(),
      unchanged: z.boolean(),
    }),
  })
  .refine(
    (r) => {
      const derived = decideRootCause(r.baseline, r.experiments, r.outcomes, r.policy);
      return (
        derived.status === r.decision.status &&
        derived.hypothesisId === r.decision.hypothesisId &&
        derived.candidateHypothesisId === r.decision.candidateHypothesisId &&
        derived.evidenceLevel === r.decision.evidenceLevel
      );
    },
    { message: "the decision must follow deterministically from the recorded measurements", path: ["decision"] },
  )
  .refine((r) => r.experiments.every((e) => e.specificity.status === specificityOf(r.baseline.control, e.arm.control).status), {
    message: "each experiment's specificity must follow from the recorded control footprints",
    path: ["experiments"],
  })
  .refine((r) => r.decision.status !== "VALIDATED" || r.isolation.unchanged, {
    message: "a root cause cannot be VALIDATED if the source tree changed during the investigation",
    path: ["decision"],
  });
export type RootCauseReport = z.infer<typeof RootCauseReport>;

// ---------------------------------------------------------------------------
// Deterministic rules
// ---------------------------------------------------------------------------

/** Classifies one attempt. Only a failed expectation counts as the bug showing. */
export function classifyAttempt(input: { verdict: RunVerdict; failedPurpose?: "anchor" | "expectation" | undefined }): AttemptClass {
  if (input.verdict === "passed") return "not_reproduced";
  if (input.verdict === "failed" && input.failedPurpose === "expectation") return "reproduced";
  return "invalid";
}

export function countAttempts(attempts: readonly Pick<ArmAttempt, "classification">[]): ArmCounts {
  return {
    runs: attempts.length,
    reproduced: attempts.filter((a) => a.classification === "reproduced").length,
    notReproduced: attempts.filter((a) => a.classification === "not_reproduced").length,
    invalid: attempts.filter((a) => a.classification === "invalid").length,
  };
}

export const rateOf = (c: ArmCounts): number => (c.runs === 0 ? 0 : c.reproduced / c.runs);

/** A usable baseline: every run reproduced the bug, with at least `minRuns` runs. */
export function baselineReproduced(c: ArmCounts, minRuns: number): boolean {
  return c.runs >= minRuns && c.reproduced === c.runs;
}

/**
 * Compares the intervention arm with the prediction. Deliberately strict with
 * small N: only an all-or-nothing result counts, and a partial effect is
 * reported as such instead of being rounded to a conclusion.
 */
export function evaluatePrediction(
  prediction: Prediction,
  baseline: ArmCounts,
  arm: ArmCounts,
  policy: Pick<RootCausePolicy, "runsPerArm">,
): { status: ExperimentStatus; reason: string } {
  const summary = `baseline ${baseline.reproduced}/${baseline.runs} reproduced, intervention ${arm.reproduced}/${arm.runs} reproduced (${arm.invalid} invalid)`;
  if (!baselineReproduced(baseline, policy.runsPerArm)) {
    return { status: "INCONCLUSIVE", reason: `no stable baseline: ${summary}` };
  }
  if (arm.runs < policy.runsPerArm) {
    return { status: "INCONCLUSIVE", reason: `only ${arm.runs} intervention runs (${policy.runsPerArm} required): ${summary}` };
  }
  if (arm.invalid > 0) {
    return {
      status: "INCONCLUSIVE",
      reason: `${arm.invalid} intervention run(s) could not show or rule out the bug (an anchor failed, a timeout or an error): ${summary}`,
    };
  }
  const eliminated = arm.reproduced === 0;
  const persisted = arm.reproduced === arm.runs;
  if (!eliminated && !persisted) return { status: "INCONCLUSIVE", reason: `partial effect, the bug became intermittent: ${summary}` };
  const predictedEliminated = prediction === "eliminates";
  return eliminated === predictedEliminated
    ? { status: "CONFIRMED", reason: `predicted the bug ${prediction === "eliminates" ? "disappears" : "persists"}; it did: ${summary}` }
    : { status: "FALSIFIED", reason: `predicted the bug ${prediction === "eliminates" ? "disappears" : "persists"}; it ${eliminated ? "disappeared" : "persisted"}: ${summary}` };
}

/**
 * What an experiment says about its hypothesis. A hypothesis claims a cause;
 * its experiment neutralizes that cause and predicts `eliminates`. A
 * `persists` prediction is a control: confirming it supports nothing.
 */
export function hypothesisOutcome(hypothesis: Pick<Hypothesis, "id" | "statement" | "prediction">, experiment: Pick<Experiment, "id" | "result"> | null): HypothesisOutcome {
  const base = { id: hypothesis.id, statement: hypothesis.statement, experimentId: experiment?.id ?? null };
  if (experiment === null) return { ...base, status: "UNRESOLVED", reason: "not tested" };
  if (hypothesis.prediction !== "eliminates") {
    return { ...base, status: "UNRESOLVED", reason: `a "persists" prediction cannot support a cause (${experiment.result.status})` };
  }
  switch (experiment.result.status) {
    case "CONFIRMED":
      return { ...base, status: "SUPPORTED", reason: experiment.result.reason };
    case "FALSIFIED":
      return { ...base, status: "REFUTED", reason: experiment.result.reason };
    case "INCONCLUSIVE":
      return { ...base, status: "UNRESOLVED", reason: experiment.result.reason };
  }
}

/** Innermost-block executions at a hypothesis' intervention site, in the baseline's coverage. */
export function siteExecutions(coverage: readonly ScriptCoverage[] | null, file: string, offset: number | null): number | null {
  if (coverage === null || offset === null) return null;
  const script = coverage.find((c) => c.file === file);
  // A file missing from the coverage is unmeasured, not unexecuted.
  return script === undefined ? null : executionsAt(script, offset);
}

/** Compares the control scenario of an intervention arm with the baseline's. */
export function specificityOf(baseline: ControlArm | null, arm: ControlArm | null): Specificity {
  if (baseline === null || arm === null) return { status: "unknown", changed: [], reason: "no control scenario was run" };
  if (baseline.error !== null || arm.error !== null) {
    return { status: "unknown", changed: [], reason: `control scenario failed: ${baseline.error ?? arm.error ?? ""}` };
  }
  if (baseline.runs === 0 || baseline.passed !== baseline.runs) {
    return { status: "unknown", changed: [], reason: `the control scenario does not hold even in the baseline (${baseline.passed}/${baseline.runs})` };
  }
  if (arm.passed !== arm.runs) {
    return {
      status: "not_surgical",
      changed: [],
      reason: `the intervention broke the control scenario, where the baseline is correct (${arm.passed}/${arm.runs} passed)`,
    };
  }
  if (baseline.footprint === null || arm.footprint === null || !baseline.stable || !arm.stable) {
    return { status: "unknown", changed: [], reason: "execution coverage of the control scenario is missing or unstable" };
  }
  // A whole file present in one measure and absent in the other is a measurement gap, not a behaviour change.
  const files = (f: Record<string, number>) => new Set(Object.keys(f).map((k) => k.slice(0, k.lastIndexOf("#"))));
  const a = files(baseline.footprint);
  const b = files(arm.footprint);
  const gaps = [...a].filter((f) => !b.has(f)).concat([...b].filter((f) => !a.has(f)));
  if (gaps.length > 0) return { status: "unknown", changed: [], reason: `coverage of ${gaps.join(", ")} is missing in one of the two measures` };
  const changed = footprintDiff(baseline.footprint, arm.footprint);
  return changed.length === 0
    ? { status: "surgical", changed, reason: "the control scenario executes the same functions the same number of times" }
    : {
        status: "not_surgical",
        changed,
        reason: `the intervention changes execution where the baseline is already correct: ${changed
          .slice(0, 4)
          .map((c) => `${c.key} ${c.baseline}→${c.other}`)
          .join(", ")}`,
      };
}

interface MatrixInput {
  baseline: Pick<ExperimentArm, "counts">;
  experiments: readonly Pick<Experiment, "hypothesisId" | "result" | "site" | "specificity" | "reversal">[];
  outcomes: readonly Pick<HypothesisOutcome, "id" | "status" | "statement">[];
  policy: RootCausePolicy;
}

/**
 * The evidence matrix of the surviving hypothesis (or of the investigation
 * when there is none). Pure: computed from recorded measurements only.
 */
export function evidenceMatrix({ baseline, experiments, outcomes, policy }: MatrixInput): { candidate: string | null; items: EvidenceItem[] } {
  const supported = outcomes.filter((o) => o.status === "SUPPORTED");
  const refuted = outcomes.filter((o) => o.status === "REFUTED");
  const unresolved = outcomes.filter((o) => o.status === "UNRESOLVED");
  const candidate = supported.length === 1 ? (supported[0]?.id ?? null) : null;
  const e = candidate === null ? undefined : experiments.find((x) => x.hypothesisId === candidate);
  const item = (id: EvidenceId, label: string, status: EvidenceItem["status"], required: boolean, detail: string): EvidenceItem => ({
    id,
    label,
    status,
    required,
    detail,
  });
  const na = (id: EvidenceId, label: string, required: boolean) => item(id, label, "not_applicable", required, "no single surviving hypothesis");

  const reproduced = baselineReproduced(baseline.counts, policy.runsPerArm);
  const items: EvidenceItem[] = [
    item("bug_reproduced", "Bug reproduced in every baseline run", reproduced ? "met" : "not_met", true, `${baseline.counts.reproduced}/${baseline.counts.runs}`),
  ];
  if (e === undefined) {
    items.push(
      na("site_executed", "Intervention site executed in the failing scenario", policy.requireExecutedSite),
      na("intervention_removes_bug", "Intervention removes the bug (sufficiency)", true),
      na("prediction_confirmed", "Prediction confirmed", true),
      na("reversal_restores_bug", "Reverting the intervention brings the bug back (A-B-A)", policy.requireReversal),
      na("intervention_surgical", "Intervention is surgical (no change where the baseline is correct)", policy.requireSurgical),
    );
  } else {
    const executions = e.site.executions;
    const reversalMet = e.reversal !== null && e.reversal.counts.runs >= policy.runsPerArm && e.reversal.counts.reproduced === e.reversal.counts.runs;
    items.push(
      item(
        "site_executed",
        "Intervention site executed in the failing scenario",
        executions === null ? "unknown" : executions > 0 ? "met" : "not_met",
        policy.requireExecutedSite,
        executions === null ? "no coverage of the site" : `${executions} execution(s) of the modified block (relevance, not causality)`,
      ),
      item("intervention_removes_bug", "Intervention removes the bug (sufficiency)", e.result.status === "CONFIRMED" ? "met" : "not_met", true, e.result.reason),
      item("prediction_confirmed", "Prediction confirmed", e.result.status === "CONFIRMED" ? "met" : "not_met", true, e.result.status),
      item(
        "reversal_restores_bug",
        "Reverting the intervention brings the bug back (A-B-A)",
        e.reversal === null ? "unknown" : reversalMet ? "met" : "not_met",
        policy.requireReversal,
        e.reversal === null ? "not run" : `${e.reversal.counts.reproduced}/${e.reversal.counts.runs} reproduced after reverting`,
      ),
      item(
        "intervention_surgical",
        "Intervention is surgical (no change where the baseline is correct)",
        e.specificity.status === "surgical" ? "met" : e.specificity.status === "not_surgical" ? "not_met" : "unknown",
        policy.requireSurgical,
        e.specificity.reason,
      ),
    );
  }
  items.push(
    item(
      "alternatives_refuted",
      "Alternative hypotheses refuted",
      refuted.length >= policy.minRefutedAlternatives && unresolved.length === 0 ? "met" : "not_met",
      true,
      `${refuted.length} refuted, ${unresolved.length} unresolved (${policy.minRefutedAlternatives} refutation(s) required)`,
    ),
    item("unique_survivor", "Exactly one hypothesis survives", supported.length === 1 ? "met" : "not_met", true, `${supported.length} supported`),
    item(
      "hypothesis_space_complete",
      "Every plausible cause was among the hypotheses",
      "unknown",
      false,
      "cannot be established by experiments: VALIDATED means validated against the alternatives tested",
    ),
  );
  return { candidate, items };
}

/**
 * The criterion for a VALIDATED root cause: every REQUIRED item of the
 * evidence matrix is met. In words (docs/06-root-cause-engine.md): the bug
 * reproduces in every baseline run; exactly one hypothesis survives and its
 * intervention removes the bug in every run (sufficiency, prediction
 * confirmed); its alternatives were refuted and none is unresolved; the
 * modified code executed in the failing scenario (relevance); reverting the
 * intervention brings the bug back (A-B-A); and the intervention is surgical:
 * it changes nothing where the baseline was already correct. The last one is
 * what separates removing a cause from adding a compensating change.
 * Otherwise REFUTED if every hypothesis was refuted, else INSUFFICIENT_EVIDENCE,
 * with the survivor (if any) reported as a candidate.
 */
export function decideRootCause(
  baseline: Pick<ExperimentArm, "counts">,
  experiments: MatrixInput["experiments"],
  outcomes: MatrixInput["outcomes"],
  policy: RootCausePolicy,
): RootCauseDecision {
  const { candidate, items } = evidenceMatrix({ baseline, experiments, outcomes, policy });
  const base = { hypothesisId: null, candidateHypothesisId: null, statement: null };
  const refuted = outcomes.filter((o) => o.status === "REFUTED");
  const supported = outcomes.filter((o) => o.status === "SUPPORTED");
  const unresolved = outcomes.filter((o) => o.status === "UNRESOLVED");
  const missing = items.filter((i) => i.required && i.status !== "met").map((i) => i.id);

  if (!baselineReproduced(baseline.counts, policy.runsPerArm)) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...base,
      evidenceLevel: "NONE",
      missing,
      reason: `the baseline did not reproduce the bug in every run (${baseline.counts.reproduced}/${baseline.counts.runs}, ${policy.runsPerArm} required)`,
    };
  }
  if (outcomes.length > 0 && refuted.length === outcomes.length) {
    return {
      status: "REFUTED",
      ...base,
      evidenceLevel: "REPRODUCED",
      missing,
      reason: `every hypothesis was refuted (${refuted.map((o) => o.id).join(", ")}): the cause is still unknown`,
    };
  }
  if (supported.length > 1) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...base,
      evidenceLevel: "SUFFICIENT",
      missing,
      reason: `the experiments do not discriminate: ${supported.map((o) => o.id).join(" and ")} each removed the bug when neutralized`,
    };
  }
  if (candidate === null) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...base,
      evidenceLevel: "REPRODUCED",
      missing,
      reason: unresolved.length > 0 ? `unresolved hypotheses remain: ${unresolved.map((o) => o.id).join(", ")}` : "no hypothesis was supported",
    };
  }
  const statement = supported[0]?.statement ?? null;
  if (missing.includes("alternatives_refuted") || missing.includes("unique_survivor")) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...base,
      candidateHypothesisId: candidate,
      statement,
      evidenceLevel: "SUFFICIENT",
      missing,
      reason:
        unresolved.length > 0
          ? `${candidate} removed the bug, but unresolved hypotheses remain: ${unresolved.map((o) => o.id).join(", ")}`
          : `${candidate} removed the bug, but only ${refuted.length} alternative(s) were refuted (${policy.minRefutedAlternatives} required): one confirming experiment is not enough`,
    };
  }
  if (missing.length > 0) {
    const details = items
      .filter((i) => missing.includes(i.id))
      .map((i) => `${i.label.charAt(0).toLowerCase()}${i.label.slice(1)}: ${i.status === "unknown" ? "unknown" : "not met"} (${i.detail})`);
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...base,
      candidateHypothesisId: candidate,
      statement,
      evidenceLevel: "CANDIDATE",
      missing,
      reason: `${candidate} is a root cause candidate — its intervention removes the bug and its alternatives were refuted — but ${details.join("; ")}`,
    };
  }
  return {
    status: "VALIDATED",
    hypothesisId: candidate,
    candidateHypothesisId: candidate,
    statement,
    evidenceLevel: "VALIDATED",
    missing,
    reason: `${candidate}: its intervention removes the bug in every run, reverting it brings the bug back, its modified code ran in the failing scenario, it changes nothing where the baseline is correct, and ${refuted
      .map((o) => o.id)
      .join(", ")} were refuted by their own interventions`,
  };
}

/**
 * The control scenario of a plan: its steps up to the last anchor that holds
 * before the last action preceding the failing step. In the baseline the
 * application is correct there (every assertion of it holds), so an
 * intervention that changes what executes in it is acting where there is no
 * defect. null when the plan has no such prefix.
 */
export function controlPlan(plan: TestPlan, failingStep: number): TestPlan | null {
  const isAction = (s: TestPlan["steps"][number]) => s.type === "navigate" || s.type === "click" || s.type === "fill" || s.type === "press";
  let lastAction = -1;
  for (let i = 0; i < Math.min(failingStep - 1, plan.steps.length); i++) {
    const step = plan.steps[i];
    if (step !== undefined && isAction(step)) lastAction = i;
  }
  let lastAnchor = -1;
  for (let i = 0; i < lastAction; i++) {
    const step = plan.steps[i];
    if (step?.type === "assert" && step.purpose === "anchor") lastAnchor = i;
  }
  if (lastAnchor < 0) return null;
  return { ...plan, id: `${plan.id.slice(0, 56)}-control`, title: `${plan.title} (control prefix)`, steps: plan.steps.slice(0, lastAnchor + 1) };
}

/**
 * Applies a replace mutation to a file's text. Refuses anything ambiguous:
 * the text must occur exactly once and the replacement must change it.
 */
export function applyMutationText(source: string, mutation: Pick<CodeMutation, "find" | "replace" | "file">): { ok: true; text: string } | { ok: false; reason: string } {
  const first = source.indexOf(mutation.find);
  if (first === -1) return { ok: false, reason: `the text to replace was not found in ${mutation.file}` };
  if (source.indexOf(mutation.find, first + 1) !== -1) return { ok: false, reason: `the text to replace occurs more than once in ${mutation.file}` };
  if (mutation.find === mutation.replace) return { ok: false, reason: "the mutation does not change anything" };
  return { ok: true, text: source.slice(0, first) + mutation.replace + source.slice(first + mutation.find.length) };
}

/** Minimal line diff of one replacement, for review. */
export function mutationDiff(file: string, mutation: Pick<CodeMutation, "find" | "replace">): string {
  const minus = mutation.find.split("\n").map((l) => `-${l}`);
  const plus = mutation.replace.split("\n").map((l) => `+${l}`);
  return [`--- a/${file}`, `+++ b/${file}`, ...minus, ...plus].join("\n");
}

// ---------------------------------------------------------------------------
// Evaluation against an independent ground truth (never given to the engine)
// ---------------------------------------------------------------------------

export const RootCauseGroundTruth = z.strictObject({
  schemaVersion: z.literal("exegezis.root-cause-ground-truth/v1"),
  bugId: z.string(),
  statement: z.string(),
  /**
   * Code where the true cause lives: a unique excerpt of the original file.
   * A validated hypothesis is correct if its intervention overlaps one of them.
   */
  locations: z.array(z.strictObject({ file: RelativePath, excerpt: z.string().min(1) })).min(1),
  /** What an honest engine should conclude with the hypotheses it was given. */
  expectedStatus: RootCauseStatus,
  note: z.string().optional(),
});
export type RootCauseGroundTruth = z.infer<typeof RootCauseGroundTruth>;

export const RootCauseEvaluation = z.strictObject({
  bugId: z.string(),
  status: RootCauseStatus,
  expectedStatus: RootCauseStatus,
  /** For VALIDATED: whether the validated cause is the true one. null otherwise. */
  correct: z.boolean().nullable(),
  /** Whether the surviving candidate (validated or not) intervenes at the true cause. null if there is none. */
  candidateCorrect: z.boolean().nullable(),
  falseValidation: z.boolean(),
  matchesExpected: z.boolean(),
  detail: z.string(),
});
export type RootCauseEvaluation = z.infer<typeof RootCauseEvaluation>;

/** Whether a mutation's target region overlaps a ground-truth excerpt, in the original source. */
export function interventionTouches(source: string, find: string, excerpt: string): boolean {
  const f = source.indexOf(find);
  const a = source.indexOf(excerpt);
  if (f === -1 || a === -1) return false;
  return f < a + excerpt.length && a < f + find.length;
}

/**
 * Scores a finished report against the ground truth. `sources` holds the
 * original (unmutated) text of the files the ground truth names.
 */
export function evaluateRootCause(
  report: Pick<RootCauseReport, "bugId" | "decision" | "hypotheses">,
  truth: RootCauseGroundTruth,
  sources: Readonly<Record<string, string>>,
): RootCauseEvaluation {
  const touches = (id: string | null): boolean | null => {
    const m = report.hypotheses.find((h) => h.id === id)?.intervention;
    if (id === null || m === undefined) return null;
    return truth.locations.some((l) => l.file === m.file && interventionTouches(sources[l.file] ?? "", m.find, l.excerpt));
  };
  const base = {
    bugId: report.bugId,
    status: report.decision.status,
    expectedStatus: truth.expectedStatus,
    candidateCorrect: touches(report.decision.candidateHypothesisId),
  };
  if (report.decision.status !== "VALIDATED") {
    return {
      ...base,
      correct: null,
      falseValidation: false,
      matchesExpected: report.decision.status === truth.expectedStatus,
      detail: `no root cause validated (${report.decision.status}); expected ${truth.expectedStatus}`,
    };
  }
  const hypothesis = report.hypotheses.find((h) => h.id === report.decision.hypothesisId);
  const mutation = hypothesis?.intervention;
  const correct =
    mutation !== undefined &&
    truth.locations.some((l) => l.file === mutation.file && interventionTouches(sources[l.file] ?? "", mutation.find, l.excerpt));
  return {
    ...base,
    correct,
    falseValidation: !correct,
    matchesExpected: correct && truth.expectedStatus === "VALIDATED",
    detail: correct
      ? `${hypothesis?.id ?? "?"} intervenes at the true cause (${mutation?.file ?? "?"})`
      : `${hypothesis?.id ?? "?"} was validated but does not touch the true cause: FALSE VALIDATION`,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export const RootCauseSuite = z.strictObject({
  schemaVersion: z.literal("exegezis.root-cause-suite/v1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  /** Case directories, each with investigation.json (engine input) and ground-truth.json (evaluation only). */
  cases: z.array(z.string()).min(1),
});
export type RootCauseSuite = z.infer<typeof RootCauseSuite>;

/** Case outcomes that could not be investigated at all (e.g. no code-level intervention exists). */
export const RootCauseSuiteCase = z.strictObject({
  id: z.string(),
  report: z.string().nullable(),
  status: RootCauseStatus,
  evidenceLevel: EvidenceLevel,
  baseline: ArmCounts.nullable(),
  experiments: z.array(z.strictObject({ hypothesisId: z.string(), counts: ArmCounts, status: ExperimentStatus })),
  evaluation: RootCauseEvaluation.nullable(),
  durationMs: z.number().nonnegative(),
});
export type RootCauseSuiteCase = z.infer<typeof RootCauseSuiteCase>;

export const RootCauseSuiteResult = z.strictObject({
  schemaVersion: z.literal("exegezis.root-cause-result/v2"),
  suite: z.string(),
  exegezisVersion: z.string(),
  startedAt: Timestamp,
  finishedAt: Timestamp,
  runsPerArm: z.int().positive(),
  cases: z.array(RootCauseSuiteCase),
  summary: z.strictObject({
    cases: z.int().nonnegative(),
    baselineReproduced: z.int().nonnegative(),
    validated: z.int().nonnegative(),
    correct: z.int().nonnegative(),
    falseValidations: z.int().nonnegative(),
    insufficientEvidence: z.int().nonnegative(),
    refuted: z.int().nonnegative(),
    matchesExpected: z.int().nonnegative(),
    hypothesesTested: z.int().nonnegative(),
    hypothesesRefuted: z.int().nonnegative(),
    candidates: z.int().nonnegative(),
  }),
  /**
   * Small-sample metrics, always reported next to their counts. Precision =
   * correct / validated; false validation rate = false validations / cases
   * evaluated; honest unknown rate = INSUFFICIENT_EVIDENCE / cases. null when
   * the denominator is 0.
   */
  metrics: z.strictObject({
    rootCausePrecision: z.number().nullable(),
    falseValidationRate: z.number().nullable(),
    honestUnknownRate: z.number().nullable(),
  }),
});
export type RootCauseSuiteResult = z.infer<typeof RootCauseSuiteResult>;

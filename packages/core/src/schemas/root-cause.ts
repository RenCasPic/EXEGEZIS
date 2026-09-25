import { z } from "zod";
import { RelativePath, Timestamp } from "./common.js";
import { Provenance } from "./policy.js";
import { ReproductionStatus } from "./reproduction.js";
import { RunVerdict } from "./run.js";

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
});
export type RootCausePolicy = z.infer<typeof RootCausePolicy>;

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
    policy: RootCausePolicy.default({ runsPerArm: 5, minRefutedAlternatives: 1 }),
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

export const ExperimentArm = z
  .strictObject({
    label: z.enum(["baseline", "intervention"]),
    /** Directory of the arm's reproduction, relative to the case directory. */
    path: z.string(),
    mutation: AppliedMutation.nullable(),
    counts: ArmCounts,
    /** reproduced / runs (0 when there were no runs). */
    rate: z.number().min(0).max(1),
    reproductionStatus: ReproductionStatus,
    attempts: z.array(ArmAttempt),
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

export const Experiment = z.strictObject({
  id: z.string(),
  hypothesisId: z.string(),
  intervention: CodeMutation,
  prediction: Prediction,
  baseline: ArmCounts,
  arm: ExperimentArm,
  /** intervention rate − baseline rate. */
  delta: z.number(),
  result: z.strictObject({ status: ExperimentStatus, reason: z.string() }),
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

export const RootCauseReport = z
  .strictObject({
    schemaVersion: z.literal("exegezis.root-cause-report/v1"),
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
    decision: z.strictObject({
      status: RootCauseStatus,
      hypothesisId: z.string().nullable(),
      statement: z.string().nullable(),
      reason: z.string(),
    }),
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
      const derived = decideRootCause(r.baseline.counts, r.outcomes, r.policy);
      return derived.status === r.decision.status && derived.hypothesisId === r.decision.hypothesisId;
    },
    { message: "the decision must follow deterministically from the baseline and the hypothesis outcomes", path: ["decision"] },
  )
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

/**
 * The minimum criterion for a VALIDATED root cause (all required):
 * 1. The baseline reproduces the bug in every run (≥ runsPerArm runs).
 * 2. Exactly one hypothesis is SUPPORTED: neutralizing its cause removed the
 *    bug in every run, with no invalid run.
 * 3. No hypothesis is left UNRESOLVED (untested or inconclusive).
 * 4. At least `minRefutedAlternatives` competing hypotheses were REFUTED by
 *    their own intervention, showing that changing related code is not enough
 *    to make the bug disappear.
 * Otherwise: REFUTED if every hypothesis was refuted, INSUFFICIENT_EVIDENCE
 * in every other case.
 */
export function decideRootCause(
  baseline: ArmCounts,
  outcomes: readonly Pick<HypothesisOutcome, "id" | "status" | "statement">[],
  policy: RootCausePolicy,
): { status: RootCauseStatus; hypothesisId: string | null; statement: string | null; reason: string } {
  const none = { hypothesisId: null, statement: null };
  if (!baselineReproduced(baseline, policy.runsPerArm)) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...none,
      reason: `the baseline did not reproduce the bug in every run (${baseline.reproduced}/${baseline.runs}, ${policy.runsPerArm} required)`,
    };
  }
  const supported = outcomes.filter((o) => o.status === "SUPPORTED");
  const refuted = outcomes.filter((o) => o.status === "REFUTED");
  const unresolved = outcomes.filter((o) => o.status === "UNRESOLVED");
  if (outcomes.length > 0 && refuted.length === outcomes.length) {
    return { status: "REFUTED", ...none, reason: `every hypothesis was refuted (${refuted.map((o) => o.id).join(", ")}): the cause is still unknown` };
  }
  if (supported.length > 1) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...none,
      reason: `the experiments do not discriminate: ${supported.map((o) => o.id).join(" and ")} each removed the bug when neutralized`,
    };
  }
  if (unresolved.length > 0) {
    return { status: "INSUFFICIENT_EVIDENCE", ...none, reason: `unresolved hypotheses remain: ${unresolved.map((o) => o.id).join(", ")}` };
  }
  const winner = supported[0];
  if (winner === undefined) return { status: "INSUFFICIENT_EVIDENCE", ...none, reason: "no hypothesis was supported" };
  if (refuted.length < policy.minRefutedAlternatives) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      ...none,
      reason: `${winner.id} was supported, but only ${refuted.length} alternative(s) were refuted (${policy.minRefutedAlternatives} required): one confirming experiment is not enough`,
    };
  }
  return {
    status: "VALIDATED",
    hypothesisId: winner.id,
    statement: winner.statement,
    reason: `${winner.id} is the only hypothesis whose intervention removed the bug in every run; ${refuted.map((o) => o.id).join(", ")} were refuted by their own interventions`,
  };
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
  const base = { bugId: report.bugId, status: report.decision.status, expectedStatus: truth.expectedStatus };
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
  baseline: ArmCounts.nullable(),
  experiments: z.array(z.strictObject({ hypothesisId: z.string(), counts: ArmCounts, status: ExperimentStatus })),
  evaluation: RootCauseEvaluation.nullable(),
  durationMs: z.number().nonnegative(),
});
export type RootCauseSuiteCase = z.infer<typeof RootCauseSuiteCase>;

export const RootCauseSuiteResult = z.strictObject({
  schemaVersion: z.literal("exegezis.root-cause-result/v1"),
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
  }),
});
export type RootCauseSuiteResult = z.infer<typeof RootCauseSuiteResult>;

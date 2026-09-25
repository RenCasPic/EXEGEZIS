import type { RootCauseStatus, VerificationOutcome } from "@exegezis/core";
import type { GenerationRecord } from "./generation";

/**
 * The investigation chain shown in the UI. Each stage's status is derived
 * only from artifacts on disk; stages the engine does not have yet are
 * `NOT IMPLEMENTED`, never a placeholder result.
 */
export const STAGES = [
  { id: "symptom", label: "Symptom" },
  { id: "plan", label: "AI Plan" },
  { id: "reproduction", label: "Reproduction" },
  { id: "evidence", label: "Evidence" },
  { id: "investigation", label: "Investigation" },
  { id: "root_cause", label: "Root Cause" },
  { id: "fix", label: "Fix" },
  { id: "verification", label: "Verification" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

/** Visual family of a status; the label always says exactly what happened. */
export type Tone = "positive" | "negative" | "warning" | "critical" | "neutral" | "running" | "unimplemented";

export interface StageState {
  id: StageId;
  label: string;
  status: string;
  tone: Tone;
  detail: string;
}

/** Capabilities EXEGEZIS does not have yet. Shown as such everywhere. */
export const NOT_IMPLEMENTED_STAGES: readonly StageId[] = ["fix", "verification"];

export const NOT_IMPLEMENTED_DETAIL: Record<"fix" | "verification", string> = {
  fix: "No fix generation yet. EXEGEZIS has not proposed or applied any code change as a fix (experimental mutations are discarded).",
  verification: "No before/after fix verification yet. Only the bug reproduction and root-cause experiments are verified.",
};

export const NO_ROOT_CAUSE_RUN = "No root-cause experiment has been run for this bug (exegezis root-cause).";

export function rootCauseTone(status: RootCauseStatus): Tone {
  return status === "VALIDATED" ? "positive" : status === "REFUTED" ? "critical" : "warning";
}

export interface StageInput {
  symptom: string | null;
  /** Plan authorship: a model-generated plan or a human-written one. */
  planSource: "model" | "human" | "tool" | "unknown" | null;
  generation: Pick<GenerationRecord, "status"> | null;
  generationDetail: string | null;
  /** Outcome of the investigation (BugReport, or the benchmark record when nothing ran). */
  outcome: VerificationOutcome | null;
  /** True only when a plan was executed and a BugReport exists. */
  executed: boolean;
  outcomeReason: string | null;
  reproduction: { failures: number; attempts: number } | null;
  running: boolean;
  /** Attempt directories exist on disk (false for archived results). */
  evidenceOnDisk: boolean;
  archived: boolean;
  /** The latest root-cause investigation of this bug, if one was run. */
  rootCause: { status: RootCauseStatus; experiments: number; hypotheses: number; reason: string } | null;
}

export function outcomeTone(outcome: VerificationOutcome): Tone {
  switch (outcome) {
    case "VERIFIED":
      return "positive";
    case "NOT_VERIFIED":
      return "neutral";
    case "INCONCLUSIVE":
      return "warning";
    case "FLAKY":
      return "warning";
    case "INVALID_PLAN":
      return "critical";
    case "UNSUPPORTED":
      return "negative";
  }
}

export const label = (value: string): string => value.replaceAll("_", " ");

export function deriveStages(input: StageInput): StageState[] {
  const stage = (id: StageId, status: string, tone: Tone, detail: string): StageState => ({
    id,
    label: STAGES.find((s) => s.id === id)?.label ?? id,
    status,
    tone,
    detail,
  });

  const symptom =
    input.symptom !== null
      ? stage("symptom", "PROVIDED", "positive", input.symptom)
      : stage("symptom", "NOT PROVIDED", "neutral", "This investigation started from a plan, not from a symptom.");

  let plan: StageState;
  if (input.generation !== null) {
    const status = input.generation.status;
    const tone: Tone =
      status === "generated" ? "positive" : status === "declined" ? "warning" : status === "invalid_generation" ? "critical" : "negative";
    plan = stage("plan", label(status).toUpperCase(), tone, input.generationDetail ?? "");
  } else if (input.planSource === "human") {
    plan = stage("plan", "HUMAN PLAN", "neutral", "The plan was written by a person; no model was involved.");
  } else if (input.running) {
    plan = stage("plan", "RUNNING", "running", "Waiting for the planner.");
  } else {
    plan = stage("plan", "NOT RUN", "neutral", "No planner output was recorded.");
  }

  let reproduction: StageState;
  if (input.outcome !== null && input.executed) {
    const repro = input.reproduction;
    const detail = repro === null ? (input.outcomeReason ?? "") : `${repro.failures}/${repro.attempts} runs failed the expectation. ${input.outcomeReason ?? ""}`;
    reproduction = stage("reproduction", label(input.outcome), outcomeTone(input.outcome), detail.trim());
  } else if (input.running) {
    reproduction = stage("reproduction", "RUNNING", "running", "The engine is executing the plan.");
  } else {
    const recorded = input.outcome === null ? "" : ` The investigation ended ${label(input.outcome)} without running anything.`;
    reproduction = stage("reproduction", "NOT RUN", "neutral", `No plan was executed, so nothing was reproduced or ruled out.${recorded}`);
  }

  let evidence: StageState;
  if (input.evidenceOnDisk) {
    evidence = stage("evidence", "AVAILABLE", "positive", "Evidence bundles of every attempt are on disk.");
  } else if (input.archived && input.executed) {
    evidence = stage("evidence", "NOT ARCHIVED", "neutral", "Archived results keep the report, not the evidence bundles.");
  } else if (input.running) {
    evidence = stage("evidence", "RUNNING", "running", "Evidence is being captured.");
  } else {
    evidence = stage("evidence", "AWAITING EVIDENCE", "neutral", "Nothing was executed, so no evidence exists.");
  }

  return [
    symptom,
    plan,
    reproduction,
    evidence,
    input.rootCause === null
      ? stage("investigation", "NOT RUN", "neutral", NO_ROOT_CAUSE_RUN)
      : stage(
          "investigation",
          `${input.rootCause.experiments} EXPERIMENTS`,
          input.rootCause.experiments > 0 ? "positive" : "warning",
          `${input.rootCause.hypotheses} hypotheses, ${input.rootCause.experiments} intervention experiments on isolated copies.`,
        ),
    input.rootCause === null
      ? stage("root_cause", "NOT RUN", "neutral", NO_ROOT_CAUSE_RUN)
      : stage("root_cause", label(input.rootCause.status), rootCauseTone(input.rootCause.status), input.rootCause.reason),
    stage("fix", "NOT IMPLEMENTED", "unimplemented", NOT_IMPLEMENTED_DETAIL.fix),
    stage("verification", "NOT IMPLEMENTED", "unimplemented", NOT_IMPLEMENTED_DETAIL.verification),
  ];
}

import type { EngineMessage, RootCauseStatus, VerificationOutcome } from "@exegezis/core";
import type { GenerationRecord } from "./generation";

/**
 * The investigation chain shown in the UI. Each stage's status is derived
 * only from artifacts on disk; stages the engine does not have yet are
 * `NOT_IMPLEMENTED`, never a placeholder result. Statuses are codes and
 * details are catalog keys, engine messages or recorded content: the UI
 * words them in the reader's language (docs/11-i18n.md).
 */
export const STAGES = [{ id: "symptom" }, { id: "plan" }, { id: "reproduction" }, { id: "evidence" }, { id: "investigation" }, { id: "root_cause" }, { id: "fix" }, { id: "verification" }] as const;
export type StageId = (typeof STAGES)[number]["id"];

/** Visual family of a status; the label always says exactly what happened. */
export type Tone = "ok" | "off" | "warn" | "bad" | "q" | "running" | "unimplemented";

/** Keys under common.stageDetail in the catalogs. */
export type StageDetailKey =
  | "noSymptom"
  | "humanPlan"
  | "waitingPlanner"
  | "noPlannerOutput"
  | "reproducing"
  | "notExecuted"
  | "notExecutedEnded"
  | "evidenceOnDisk"
  | "evidenceNotArchived"
  | "evidenceRunning"
  | "noEvidence"
  | "noRootCauseRun"
  | "experiments"
  | "fixNotImplemented"
  | "verificationNotImplemented";

export type StageDetail =
  | { kind: "key"; key: StageDetailKey; values?: Record<string, string | number> }
  /** Engine text: a message when the report has one, else the recorded English text. */
  | { kind: "engine"; message: EngineMessage | null; text: string | null; failures?: number; attempts?: number }
  /** Recorded content that is never translated (a symptom, a model's answer). */
  | { kind: "content"; text: string };

export interface StageState {
  id: StageId;
  /** A status code (PROVIDED, NOT_RUN, VERIFIED…), translated by StatusPill. */
  status: string;
  tone: Tone;
  detail: StageDetail;
}

/** Capabilities EXEGEZIS does not have yet. Shown as such everywhere. */
export const NOT_IMPLEMENTED_STAGES: readonly StageId[] = ["fix", "verification"];

/** Stage statuses that mean nothing was reached yet. */
export const NOT_REACHED: readonly string[] = ["NOT_PROVIDED", "NOT_RUN", "AWAITING_EVIDENCE", "HUMAN_PLAN"];

export function rootCauseTone(status: RootCauseStatus): Tone {
  return status === "VALIDATED" ? "ok" : status === "REFUTED" ? "off" : "q";
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
  outcomeMessage: EngineMessage | null;
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
      return "ok";
    case "NOT_VERIFIED":
      return "off";
    case "INCONCLUSIVE":
      return "q";
    case "FLAKY":
      return "warn";
    case "INVALID_PLAN":
      return "bad";
    case "UNSUPPORTED":
      return "q";
  }
}

export function deriveStages(input: StageInput): StageState[] {
  const stage = (id: StageId, status: string, tone: Tone, detail: StageDetail): StageState => ({ id, status, tone, detail });
  const key = (k: StageDetailKey, values?: Record<string, string | number>): StageDetail => (values === undefined ? { kind: "key", key: k } : { kind: "key", key: k, values });

  const symptom = input.symptom !== null ? stage("symptom", "PROVIDED", "ok", { kind: "content", text: input.symptom }) : stage("symptom", "NOT_PROVIDED", "q", key("noSymptom"));

  let plan: StageState;
  if (input.generation !== null) {
    const status = input.generation.status;
    const tone: Tone = status === "generated" ? "ok" : status === "declined" ? "warn" : status === "invalid_generation" ? "bad" : "off";
    plan = stage("plan", status.toUpperCase(), tone, { kind: "content", text: input.generationDetail ?? "" });
  } else if (input.planSource === "human") {
    plan = stage("plan", "HUMAN_PLAN", "q", key("humanPlan"));
  } else if (input.running) {
    plan = stage("plan", "RUNNING", "running", key("waitingPlanner"));
  } else {
    plan = stage("plan", "NOT_RUN", "q", key("noPlannerOutput"));
  }

  let reproduction: StageState;
  if (input.outcome !== null && input.executed) {
    const repro = input.reproduction;
    reproduction = stage("reproduction", input.outcome, outcomeTone(input.outcome), {
      kind: "engine",
      message: input.outcomeMessage,
      text: input.outcomeReason,
      ...(repro === null ? {} : { failures: repro.failures, attempts: repro.attempts }),
    });
  } else if (input.running) {
    reproduction = stage("reproduction", "RUNNING", "running", key("reproducing"));
  } else {
    reproduction = stage("reproduction", "NOT_RUN", "q", input.outcome === null ? key("notExecuted") : key("notExecutedEnded", { outcome: input.outcome }));
  }

  let evidence: StageState;
  if (input.evidenceOnDisk) evidence = stage("evidence", "AVAILABLE", "ok", key("evidenceOnDisk"));
  else if (input.archived && input.executed) evidence = stage("evidence", "NOT_ARCHIVED", "q", key("evidenceNotArchived"));
  else if (input.running) evidence = stage("evidence", "RUNNING", "running", key("evidenceRunning"));
  else evidence = stage("evidence", "AWAITING_EVIDENCE", "q", key("noEvidence"));

  const rc = input.rootCause;
  return [
    symptom,
    plan,
    reproduction,
    evidence,
    rc === null
      ? stage("investigation", "NOT_RUN", "q", key("noRootCauseRun"))
      : stage("investigation", "EXPERIMENTS", rc.experiments > 0 ? "ok" : "warn", key("experiments", { hypotheses: rc.hypotheses, experiments: rc.experiments })),
    rc === null ? stage("root_cause", "NOT_RUN", "q", key("noRootCauseRun")) : stage("root_cause", rc.status, rootCauseTone(rc.status), { kind: "engine", message: null, text: rc.reason }),
    stage("fix", "NOT_IMPLEMENTED", "unimplemented", key("fixNotImplemented")),
    stage("verification", "NOT_IMPLEMENTED", "unimplemented", key("verificationNotImplemented")),
  ];
}

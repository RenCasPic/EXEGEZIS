import { EvidenceLevel } from "@exegezis/core";
import type { Tone } from "./evidence/stages";

/**
 * Verdict → visual family (docs/08-design-system.md). Every verdict name the
 * engine writes is listed; an unknown one is shown as "q" (unknown), never
 * as a success.
 */
const FAMILY: Record<string, Tone> = {
  VERIFIED: "ok",
  VALIDATED: "ok",
  CANDIDATE: "warn",
  SUFFICIENT: "warn",
  INTERMITTENT: "warn",
  FLAKY: "warn",
  INCONCLUSIVE: "q",
  INSUFFICIENT: "q",
  INSUFFICIENT_EVIDENCE: "q",
  UNSUPPORTED: "q",
  NOT_VERIFIED: "off",
  REFUTED: "off",
  FALSE_VALIDATION: "bad",
  INVALID_PLAN: "bad",
};

export function verdictTone(verdict: string): Tone {
  return FAMILY[verdict.trim().toUpperCase().replaceAll(" ", "_")] ?? "q";
}

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = EvidenceLevel.options;

export function evidenceLevelIndex(level: EvidenceLevel): number {
  return EVIDENCE_LEVELS.indexOf(level);
}

/** One run in a RunHistory: proven (ok), inconclusive (q) or not proven (off). */
export type RunMark = "ok" | "q" | "off";

import type { VerificationOutcome } from "@exegezis/core";

/**
 * A short name for why a result is not VERIFIED, taken from the reason the
 * engine recorded (core deriveOutcome and the verification criteria; the
 * English text, which every report has). It only names what the text already
 * says; the full reason is always shown next to it. Returns a catalog key
 * (common.shortReason.*).
 */
export type ShortReason = "falsePremise" | "weakAnchor" | "timeout" | "evaluationErrors" | "unstable" | "missingEvidence" | "redactionFailed" | "unsupportedAssertion" | "missingTarget" | "notExecuted";

const PATTERNS: [RegExp, ShortReason][] = [
  [/is an anchor: the premise of the plan/i, "falsePremise"],
  [/weakly anchored/i, "weakAnchor"],
  [/timed out without a conclusion/i, "timeout"],
  [/could not be evaluated/i, "evaluationErrors"],
  [/not deterministic|not stable/i, "unstable"],
  [/missing evidence|not linked to a screenshot|manifest is incomplete/i, "missingEvidence"],
  [/redaction failed/i, "redactionFailed"],
  [/assertions are not supported|not supported by the adapter/i, "unsupportedAssertion"],
  [/does not exist on the observed page/i, "missingTarget"],
  [/no attempts were executed/i, "notExecuted"],
];

export function shortReason(outcome: VerificationOutcome | null, reason: string | null): ShortReason | null {
  if (outcome === null || outcome === "VERIFIED" || reason === null) return null;
  for (const [pattern, label] of PATTERNS) if (pattern.test(reason)) return label;
  return null;
}

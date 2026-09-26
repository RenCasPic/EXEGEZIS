import type { VerificationOutcome } from "@exegezis/core";

/**
 * A short name for why a result is not VERIFIED, taken from the reason the
 * engine recorded (core deriveOutcome and the verification criteria). It
 * only names what the text already says; the full reason is always shown
 * next to it.
 */
const PATTERNS: [RegExp, string][] = [
  [/is an anchor: the premise of the plan/i, "false premise"],
  [/weakly anchored/i, "weak anchor"],
  [/timed out without a conclusion/i, "timeout"],
  [/could not be evaluated/i, "evaluation errors"],
  [/not deterministic|not stable/i, "unstable"],
  [/missing evidence|not linked to a screenshot|manifest is incomplete/i, "missing evidence"],
  [/redaction failed/i, "redaction failed"],
  [/assertions are not supported|not supported by the adapter/i, "unsupported assertion"],
  [/does not exist on the observed page/i, "missing target"],
  [/no attempts were executed/i, "not executed"],
];

export function shortReason(outcome: VerificationOutcome | null, reason: string | null): string | null {
  if (outcome === null || outcome === "VERIFIED" || reason === null) return null;
  for (const [pattern, label] of PATTERNS) if (pattern.test(reason)) return label;
  return null;
}

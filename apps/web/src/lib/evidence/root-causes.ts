import { join } from "node:path";
import { RootCauseEvaluation, RootCauseReport } from "@exegezis/core";
import type { RootCauseRef, WorkspaceIndex } from "./discover";
import { readArtifact, valueOf, type Loaded } from "./read";

/**
 * A root-cause investigation as recorded by `exegezis root-cause`. The report
 * is parsed with the canonical schema, whose refinements re-derive the
 * decision from the experiments: a file that claims VALIDATED without the
 * experimental support fails to load and is shown as invalid.
 */
export interface RootCauseEntry {
  ref: RootCauseRef;
  report: Loaded<RootCauseReport>;
  /** Ground-truth evaluation, written after the report (benchmark cases only). */
  evaluation: RootCauseEvaluation | null;
}

export async function loadRootCauses(index: WorkspaceIndex): Promise<RootCauseEntry[]> {
  const entries = await Promise.all(
    index.rootCauses.map(async (ref) => ({
      ref,
      report: await readArtifact(join(ref.dir, "root-cause-report.json"), RootCauseReport),
      evaluation: valueOf(await readArtifact(join(ref.dir, "evaluation.json"), RootCauseEvaluation)),
    })),
  );
  const time = (e: RootCauseEntry) => (e.report.status === "ok" ? e.report.value.generatedAt : "");
  // An archived copy of a run that is still in runs/ is the same result: show it once.
  const live = new Set(entries.filter((e) => !e.ref.archived).map((e) => `${e.ref.caseId}@${time(e)}`));
  return entries.filter((e) => !e.ref.archived || !live.has(`${e.ref.caseId}@${time(e)}`)).sort((a, b) => time(b).localeCompare(time(a)));
}

/** The most recent entry of each case: what the current state of the engine says. */
export function latestPerCase(entries: readonly RootCauseEntry[]): RootCauseEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.ref.caseId) ? false : (seen.add(e.ref.caseId), true)));
}

/**
 * The most recent valid root-cause report whose case is this bug. Matched by
 * case id, not by bug id: variant cases (e.g. BUG-001-ADVERSARIAL, which
 * withholds the true hypothesis) are about the same bug but are not its
 * investigation, and must not be shown as its root cause.
 */
export function latestFor(entries: readonly RootCauseEntry[], caseId: string | null): (RootCauseEntry & { report: { status: "ok"; value: RootCauseReport } }) | null {
  if (caseId === null) return null;
  for (const e of entries) {
    if (e.report.status === "ok" && e.ref.caseId === caseId) return e as RootCauseEntry & { report: { status: "ok"; value: RootCauseReport } };
  }
  return null;
}

import type { InvestigationSummary } from "./evidence/investigations";
import type { JobRecord, JobStatus } from "./jobs";

/**
 * Investigation list filters, defined on real outcomes:
 * - verified: the engine returned VERIFIED.
 * - expected: a negative benchmark case whose result is the expected one
 *   (e.g. INCONCLUSIVE for a plan with a false premise). It is a success of
 *   the engine, so it never appears under needs-evidence, not-verified or failed.
 * - needs-evidence: it ran but could not conclude (INCONCLUSIVE, FLAKY) or never ran.
 * - not-verified: it ran conclusively and the expected behaviour held.
 * - failed: the plan could not be used (INVALID_PLAN, UNSUPPORTED, planner error).
 * - active: started from the UI and still running.
 */
export const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "verified", label: "Verified" },
  { id: "needs-evidence", label: "Needs Evidence" },
  { id: "expected", label: "Expected" },
  { id: "not-verified", label: "Not Verified" },
  { id: "failed", label: "Failed" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.some((f) => f.id === value) ? (value as StatusFilter) : "all";
}

/** A negative benchmark case that produced exactly its expected outcome. */
export function isExpectedNegative(s: InvestigationSummary): boolean {
  return s.benchmark?.kind === "negative" && s.outcome !== null && s.outcome === s.benchmark.expected;
}

export function matchesStatus(s: InvestigationSummary, filter: StatusFilter): boolean {
  if (filter !== "all" && filter !== "active" && filter !== "expected" && isExpectedNegative(s)) return false;
  switch (filter) {
    case "all":
      return true;
    case "active":
      return s.job?.status === "running" && s.outcome === null;
    case "verified":
      return s.outcome === "VERIFIED";
    case "needs-evidence":
      return (s.outcome === null && s.job?.status !== "running" && s.generation?.status !== "error") || s.outcome === "INCONCLUSIVE" || s.outcome === "FLAKY";
    case "not-verified":
      return s.outcome === "NOT_VERIFIED";
    case "expected":
      return isExpectedNegative(s);
    case "failed":
      return s.outcome === "INVALID_PLAN" || s.outcome === "UNSUPPORTED" || (s.outcome === null && s.generation?.status === "error");
  }
}

export function matchesQuery(s: InvestigationSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [s.title, s.symptom, s.ref.id, s.planId, s.ref.caseId, s.project].some((v) => v?.toLowerCase().includes(q) === true);
}

export function countByStatus(summaries: readonly InvestigationSummary[], jobs: readonly { job: JobRecord; status: JobStatus }[]) {
  return {
    all: summaries.length,
    active: jobs.filter((j) => j.job.kind === "ai-verify" && j.status === "running").length,
    verified: summaries.filter((s) => matchesStatus(s, "verified")).length,
    needsEvidence: summaries.filter((s) => matchesStatus(s, "needs-evidence")).length,
    expected: summaries.filter((s) => matchesStatus(s, "expected")).length,
  };
}

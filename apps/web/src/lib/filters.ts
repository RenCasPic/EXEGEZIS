import type { InvestigationSummary } from "./evidence/investigations";
import type { JobRecord, JobStatus } from "./jobs";

/**
 * Investigation list filters, defined on real outcomes:
 * - verified: the engine returned VERIFIED.
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
  { id: "not-verified", label: "Not Verified" },
  { id: "failed", label: "Failed" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.some((f) => f.id === value) ? (value as StatusFilter) : "all";
}

export function matchesStatus(s: InvestigationSummary, filter: StatusFilter): boolean {
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
    active: jobs.filter((j) => j.status === "running").length,
    verified: summaries.filter((s) => matchesStatus(s, "verified")).length,
    needsEvidence: summaries.filter((s) => matchesStatus(s, "needs-evidence")).length,
  };
}

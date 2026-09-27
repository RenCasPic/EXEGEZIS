import { describe, expect, it } from "vitest";
import { buildCases, planOrigin, proofMetrics } from "../src/lib/evidence/cases";
import type { InvestigationSummary } from "../src/lib/evidence/investigations";
import type { RootCauseEntry } from "../src/lib/evidence/root-causes";
import { isLoopbackHost } from "../src/lib/inspect-checks";

let n = 0;
function summary(p: {
  caseId?: string | null;
  suite?: string;
  kind?: "positive" | "negative";
  expected?: InvestigationSummary["outcome"];
  outcome: InvestigationSummary["outcome"];
  provider?: string | null;
  model?: string | null;
  createdAt: string;
  ms?: number | null;
  attempts?: number;
  rootCause?: "VALIDATED" | "CANDIDATE" | null;
}): InvestigationSummary {
  n += 1;
  const caseId = p.caseId ?? null;
  return {
    ref: { id: `inv-${n}`, kind: caseId === null ? "ai-verification" : "benchmark-case", dir: "", relDir: "", archived: false, benchmarkId: caseId === null ? null : `01M3AAAAAAAAAAAAAAAAAAAAA${n % 10}-${p.suite ?? "buggy-shop"}`, caseId, jobId: null },
    title: `case ${caseId ?? n}`,
    symptom: null,
    project: null,
    target: null,
    createdAt: p.createdAt,
    outcome: p.outcome,
    outcomeSource: "bug-report",
    outcomeReason: null,
    outcomeMessage: null,
    reproduction: p.attempts === undefined ? null : ({ attempts: p.attempts, failures: p.attempts } as InvestigationSummary["reproduction"]),
    reproductionMs: p.ms ?? null,
    provenance: null,
    generation: p.provider === undefined ? null : ({ status: "generated", provider: p.provider, model: p.model ?? null } as InvestigationSummary["generation"]),
    planId: caseId,
    compiledTest: null,
    evidenceOnDisk: true,
    benchmark: caseId === null ? null : { expected: p.expected ?? "VERIFIED", passed: p.outcome === (p.expected ?? "VERIFIED"), kind: p.kind ?? "positive" },
    job: null,
    rootCause: p.rootCause === undefined || p.rootCause === null ? null : ({ evidenceLevel: p.rootCause, status: p.rootCause === "VALIDATED" ? "VALIDATED" : "INSUFFICIENT_EVIDENCE" } as InvestigationSummary["rootCause"]),
    problems: [],
    stages: [],
  };
}

// Newest first, like loadSummaries.
const summaries = [
  summary({ caseId: "BUG-001", outcome: "VERIFIED", provider: "mock", model: "mock-planner", createdAt: "2026-09-26T12:00:00Z", ms: 1, attempts: 3 }),
  summary({ caseId: "BUG-001", outcome: "VERIFIED", provider: "anthropic", model: "claude-opus-5", suite: "buggy-shop-ai", createdAt: "2026-09-26T11:00:00Z", ms: 40_000, attempts: 3, rootCause: "VALIDATED" }),
  summary({ caseId: "BUG-001", outcome: "VERIFIED", createdAt: "2026-09-25T11:00:00Z", ms: 20_000, attempts: 10 }),
  summary({ caseId: "BUG-002", outcome: "VERIFIED", provider: "mock", createdAt: "2026-09-26T10:00:00Z", ms: 5, attempts: 3 }),
  summary({ caseId: "HEALTHY-001", kind: "negative", expected: "NOT_VERIFIED", outcome: "NOT_VERIFIED", createdAt: "2026-09-26T09:00:00Z" }),
  summary({ caseId: "HEALTHY-001", suite: "buggy-shop-ai", kind: "negative", expected: "NOT_VERIFIED", outcome: "VERIFIED", provider: "anthropic", model: "claude-opus-5", createdAt: "2026-09-26T08:00:00Z" }),
  summary({ caseId: null, outcome: "INCONCLUSIVE", provider: "anthropic", model: "claude-opus-5", createdAt: "2026-09-26T07:00:00Z" }),
];

describe("cases", () => {
  const cases = buildCases(summaries);
  const byKey = new Map(cases.map((c) => [c.key, c]));

  it("merges a bug across suites and runs, and takes its state from the latest non-replay result", () => {
    const bug = byKey.get("bug:BUG-001");
    expect(bug?.latest.ref.id).toBe(summaries[1]?.ref.id);
    expect(bug?.origin).toEqual({ kind: "ai", model: "claude-opus-5" });
    expect(bug?.evidence).toBe("VALIDATED");
    expect(bug?.runs.map((r) => `${r.replay ? "R" : ""}${r.mark}`)).toEqual(["ok", "ok", "Rok"]);
    expect(bug?.group).toBe("proven");
  });

  it("never counts a replay-only case as proven", () => {
    const bug = byKey.get("bug:BUG-002");
    expect(bug).toMatchObject({ replayOnly: true, group: "pending", origin: { kind: "replay" } });
  });

  it("keeps negative cases per suite and files them as expected or pending", () => {
    expect(byKey.get("neg:buggy-shop:HEALTHY-001")).toMatchObject({ group: "expected", asExpected: true });
    expect(byKey.get("neg:buggy-shop-ai:HEALTHY-001")).toMatchObject({ group: "pending", asExpected: false, outcome: "VERIFIED" });
  });

  it("computes one value per case, excluding replays", () => {
    const m = proofMetrics(cases, summaries, [] as RootCauseEntry[]);
    expect(m.verifiedBugs).toBe(1);
    expect(m.reproductions).toBe(2);
    expect(m.attempts).toBe(13);
    expect(m.falseVerified).toBe(1);
    expect(m.negativeCases).toBe(2);
    expect(m.medianMsToVerify).toBe(40_000);
    expect(m.timedCases).toBe(1);
  });

  it("labels plan origins", () => {
    expect(planOrigin(summaries[0] as InvestigationSummary)).toEqual({ kind: "replay" });
    expect(planOrigin(summaries[2] as InvestigationSummary)).toEqual({ kind: "human" });
  });
});

describe("permission confirmation", () => {
  it("is not needed for loopback targets only", () => {
    for (const h of ["localhost", "127.0.0.1", "127.1.2.3", "[::1]", "app.localhost"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["example.com", "192.168.1.10", "localhost.evil.com", "127.0.0.1.nip.io"]) expect(isLoopbackHost(h)).toBe(false);
  });
});

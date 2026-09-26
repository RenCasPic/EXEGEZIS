import type { EvidenceLevel, VerificationOutcome } from "@exegezis/core";
import { median } from "../format";
import type { RunMark } from "../verdicts";
import type { InvestigationSummary } from "./investigations";
import type { RootCauseEntry } from "./root-causes";

/**
 * One row per case for the home page. A case is what a result is about:
 * - a seeded bug (BUG-001…) across every suite and run that targeted it;
 * - a negative benchmark case, per suite (same id, different symptom);
 * - an ad-hoc investigation, on its own.
 *
 * The state of a case is its latest result that did not come from a replayed
 * (mock) planner response. Replays still show in the run history, flagged,
 * but never count as proof.
 */
export type PlanOrigin = { kind: "ai"; model: string } | { kind: "human" } | { kind: "replay" } | { kind: "unknown" };

export type CaseGroup = "proven" | "pending" | "expected";

export interface CaseRow {
  key: string;
  caseId: string;
  suite: string | null;
  title: string;
  kind: "positive" | "negative" | "adhoc";
  /** The investigation that gives the case its state. */
  latest: InvestigationSummary;
  outcome: VerificationOutcome | null;
  expected: VerificationOutcome | null;
  /** Latest result matches the benchmark's expected outcome (negative and positive cases). */
  asExpected: boolean | null;
  origin: PlanOrigin;
  /** Only replays exist for this case: its state is a replay. */
  replayOnly: boolean;
  evidence: EvidenceLevel | null;
  runs: { mark: RunMark; replay: boolean; id: string }[];
  group: CaseGroup;
  createdAt: string | null;
}

export function isReplay(s: InvestigationSummary): boolean {
  return s.generation?.provider === "mock";
}

export function planOrigin(s: InvestigationSummary): PlanOrigin {
  if (isReplay(s)) return { kind: "replay" };
  if (s.generation !== null) return { kind: "ai", model: s.generation.model ?? s.generation.provider ?? "modelo no registrado" };
  if (s.provenance?.source === "human" || s.ref.kind === "verification" || (s.ref.kind === "benchmark-case" && s.generation === null)) return { kind: "human" };
  return { kind: "unknown" };
}

export function runMark(outcome: VerificationOutcome | null): RunMark {
  if (outcome === "VERIFIED") return "ok";
  if (outcome === "NOT_VERIFIED" || outcome === "INVALID_PLAN") return "off";
  return "q";
}

function suiteOf(s: InvestigationSummary): string | null {
  const id = s.ref.benchmarkId;
  if (id === null) return null;
  // Archived runs are "<suite>~<run>"; local runs "<ulid>-<suite>".
  return id.includes("~") ? (id.split("~")[0] ?? null) : id.replace(/^[0-9A-Z]{26}-/, "");
}

function caseKey(s: InvestigationSummary): { key: string; caseId: string; suite: string | null; kind: CaseRow["kind"] } {
  const suite = suiteOf(s);
  if (s.ref.caseId !== null && s.benchmark !== null) {
    if (s.benchmark.kind === "positive") return { key: `bug:${s.ref.caseId}`, caseId: s.ref.caseId, suite: null, kind: "positive" };
    return { key: `neg:${suite ?? "?"}:${s.ref.caseId}`, caseId: s.ref.caseId, suite, kind: "negative" };
  }
  const id = s.planId ?? s.ref.id;
  return { key: `adhoc:${s.ref.id}`, caseId: id, suite: null, kind: "adhoc" };
}

/**
 * Root-cause evidence only counts on top of a reproduction: a case whose own
 * latest result is not VERIFIED shows NONE even if the bug id has a
 * root-cause report elsewhere.
 */
function evidenceLevel(s: InvestigationSummary): EvidenceLevel | null {
  if (s.outcome === null) return null;
  if (s.outcome !== "VERIFIED") return "NONE";
  return s.rootCause?.evidenceLevel ?? "REPRODUCED";
}

/** Summaries are newest first (loadSummaries). */
export function buildCases(summaries: readonly InvestigationSummary[]): CaseRow[] {
  const groups = new Map<string, InvestigationSummary[]>();
  for (const s of summaries) {
    if (s.outcome === null && s.job?.status === "running") continue;
    const { key } = caseKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rows: CaseRow[] = [];
  for (const [key, list] of groups) {
    const real = list.filter((s) => !isReplay(s));
    const latest = (real[0] ?? list[0]) as InvestigationSummary;
    const { caseId, suite, kind } = caseKey(latest);
    const expected = latest.benchmark?.expected ?? null;
    const asExpected = latest.benchmark === null ? null : latest.outcome === latest.benchmark.expected;
    const group: CaseGroup =
      kind === "negative" ? (asExpected === true ? "expected" : "pending") : latest.outcome === "VERIFIED" && real.length > 0 ? "proven" : "pending";
    rows.push({
      key,
      caseId,
      suite,
      title: latest.title,
      kind,
      latest,
      outcome: latest.outcome,
      expected,
      asExpected,
      origin: planOrigin(latest),
      replayOnly: real.length === 0,
      evidence: evidenceLevel(latest),
      runs: [...list].reverse().map((s) => ({ mark: runMark(s.outcome), replay: isReplay(s), id: s.ref.id })),
      group,
      createdAt: latest.createdAt,
    });
  }
  return rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export interface ProofMetrics {
  verifiedBugs: number;
  /** VERIFIED investigations (non-replay) of those bugs, and the browser attempts behind them. */
  reproductions: number;
  attempts: number;
  validatedCauses: number;
  rootCauseCases: number;
  falseValidations: number;
  falseVerified: number;
  negativeCases: number;
  medianMsToVerify: number | null;
  timedCases: number;
}

export function proofMetrics(cases: readonly CaseRow[], summaries: readonly InvestigationSummary[], rootCausesLatest: readonly RootCauseEntry[]): ProofMetrics {
  const proven = cases.filter((c) => c.group === "proven");
  const provenKeys = new Set(proven.map((c) => c.key));
  const reproductions = summaries.filter((s) => !isReplay(s) && s.outcome === "VERIFIED" && provenKeys.has(caseKey(s).key));
  const negatives = cases.filter((c) => c.kind === "negative" && !c.replayOnly);
  const times = proven.map((c) => c.latest.reproductionMs).filter((ms): ms is number => ms !== null);
  const reports = rootCausesLatest.flatMap((e) => (e.report.status === "ok" ? [{ report: e.report.value, evaluation: e.evaluation }] : []));
  return {
    verifiedBugs: proven.length,
    reproductions: reproductions.length,
    attempts: reproductions.reduce((n, s) => n + (s.reproduction?.attempts ?? 0), 0),
    validatedCauses: reports.filter((r) => r.report.decision.status === "VALIDATED").length,
    rootCauseCases: reports.length,
    falseValidations: reports.filter((r) => r.evaluation?.falseValidation === true).length,
    falseVerified: negatives.filter((c) => c.outcome === "VERIFIED").length,
    negativeCases: negatives.length,
    medianMsToVerify: median(times),
    timedCases: times.length,
  };
}

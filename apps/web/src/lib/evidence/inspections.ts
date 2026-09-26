import { join } from "node:path";
import {
  ConsoleFile,
  NetworkFile,
  SEVERITIES,
  type ConsoleMessageEvidence,
  type Finding,
  type InspectionReport,
  type NetworkExchangeEvidence,
  type PageErrorEvidence,
  type Severity,
} from "@exegezis/core";
import type { InspectionRef } from "./discover";
import { getIndex } from "./investigations";
import { readArtifact, readText, valueOf } from "./read";

/**
 * Inspections as the UI shows them. Everything comes from the report written
 * by `exegezis inspect`; a report that does not match its schema (including
 * verdicts or counts that do not follow from the observations) is shown as
 * invalid, never partially.
 */
export async function listInspections(): Promise<InspectionRef[]> {
  return (await getIndex()).inspections;
}

export async function findInspection(id: string): Promise<InspectionRef | null> {
  return (await listInspections()).find((i) => i.id === id) ?? null;
}

export interface FindingFilters {
  severity: Severity | null;
  check: string | null;
  page: string | null;
  q: string;
}

export function parseFindingFilters(params: Record<string, string | string[] | undefined>): FindingFilters {
  const one = (key: string): string | null => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s === undefined || s === "" ? null : s;
  };
  const severity = one("severity");
  return {
    severity: severity !== null && (SEVERITIES as readonly string[]).includes(severity) ? (severity as Severity) : null,
    check: one("check"),
    page: one("page"),
    q: one("q") ?? "",
  };
}

export function filterFindings(findings: readonly Finding[], f: FindingFilters): Finding[] {
  const q = f.q.trim().toLowerCase();
  return findings.filter(
    (x) =>
      (f.severity === null || x.severity === f.severity) &&
      (f.check === null || x.checkId === f.check) &&
      (f.page === null || x.page === f.page) &&
      (q === "" || [x.id, x.title, x.detail, x.page].some((v) => v.toLowerCase().includes(q))),
  );
}

const SEVERITY_ORDER = new Map(SEVERITIES.map((s, i) => [s, i]));

/** Most severe first, then by id: the order the report is read in. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => (SEVERITY_ORDER.get(a.severity) ?? 9) - (SEVERITY_ORDER.get(b.severity) ?? 9) || (a.id < b.id ? -1 : 1));
}

/** The evidence records a finding points at, resolved from their files. */
export interface FindingEvidence {
  console: ConsoleMessageEvidence[];
  pageErrors: PageErrorEvidence[];
  exchanges: NetworkExchangeEvidence[];
  spec: string | null;
}

export async function loadFindingEvidence(ref: InspectionRef, finding: Finding): Promise<FindingEvidence> {
  const result: FindingEvidence = { console: [], pageErrors: [], exchanges: [], spec: null };
  for (const e of finding.evidence) {
    if (e.ref === undefined) continue;
    if (e.kind === "console") {
      const file = valueOf(await readArtifact(join(ref.dir, e.path), ConsoleFile));
      result.console.push(...(file?.messages.filter((m) => m.id === e.ref) ?? []));
      result.pageErrors.push(...(file?.pageErrors.filter((m) => m.id === e.ref) ?? []));
    }
    if (e.kind === "network") {
      const file = valueOf(await readArtifact(join(ref.dir, e.path), NetworkFile));
      result.exchanges.push(...(file?.exchanges.filter((x) => x.id === e.ref) ?? []));
    }
  }
  if (finding.spec !== null) result.spec = await readText(join(ref.dir, finding.spec), 64 * 1024);
  return result;
}

/** One row per visited page URL: run 1's visit, with how many runs reached it. */
export function pageRows(report: InspectionReport) {
  const byUrl = new Map<string, { url: string; depth: number; status: string; httpStatus: number | null; reason: string | null; runs: number; findings: number }>();
  for (const p of report.pages) {
    const row = byUrl.get(p.url);
    if (row === undefined) {
      byUrl.set(p.url, {
        url: p.url,
        depth: p.depth,
        status: p.status,
        httpStatus: p.httpStatus,
        reason: p.reason,
        runs: p.runPath === null ? 0 : 1,
        findings: report.findings.filter((f) => f.page === p.url && f.verdict === "VERIFIED").length,
      });
    } else if (p.runPath !== null) row.runs += 1;
  }
  return [...byUrl.values()];
}

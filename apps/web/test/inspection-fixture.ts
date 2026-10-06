import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFindings,
  deriveFindings,
  deriveInspectionStatus,
  deriveSummary,
  InspectionReport,
  type CheckResult,
  type InspectionObservation,
  type PageVisit,
  type PageWrite,
} from "@exegezis/core";

/**
 * A small, self-consistent inspection report built with the same derivation
 * functions the inspector uses: 3 runs, one finding seen 3/3 (VERIFIED, with a
 * spec) and one seen 1/3 (INTERMITTENT), plus one page write.
 */
export function buildReport(id = "01M3TEST00000000000000000A", origin = "http://127.0.0.1:4300"): InspectionReport {
  const url = `${origin}/`;
  const runs = 3;
  const pages: PageVisit[] = [1, 2, 3].map((run) => ({
    url,
    depth: 0,
    run,
    status: "OK",
    finalUrl: url,
    httpStatus: 200,
    settled: true,
    reason: null,
    runPath: `pages/run-${run}/R${run}`,
    blockedWrites: 0,
    block: null,
    device: "desktop" as const,
  }));
  const failing: InspectionObservation = {
    fingerprint: "failed-requests:GET /api/fail",
    title: "GET /api/fail → 500",
    detail: "The server answered 500.",
    severity: "serious",
    thirdParty: false,
    evidence: [{ kind: "network", path: "pages/run-1/R1/network.json", ref: "net-0001", description: "The failed request" }],
    assertion: { kind: "request", request: { url: "/api/fail" }, expected: "ok" },
  };
  const flaky: InspectionObservation = { ...failing, fingerprint: "failed-requests:GET /api/flaky", title: "GET /api/flaky → 500", assertion: null };
  const checks: CheckResult[] = [1, 2, 3].map((run) => ({
    checkId: "failed-requests",
    checkVersion: "1.0.0",
    page: url,
    run,
    status: "ran",
    error: null,
    observations: run === 1 ? [failing, flaky] : [failing],
    device: "desktop" as const,
  }));
  const pageWrites: PageWrite[] = [{ method: "POST", url: `${origin}/api/track`, status: 200, page: url, run: 1, blocked: false, device: "desktop" }];
  const { groups } = deriveFindings(checks, pages, runs, false);
  const findings = buildFindings(groups, (g) => ({
    checkVersion: "1.0.0",
    reproduction: [`Open ${url}.`, "Check the request."],
    spec: g.occurrences.length === runs ? "specs/INSPECT-F-001.spec.ts" : null,
    settled: true,
  }));
  const options = { maxPages: 20, maxDepth: 2, runs, pageTimeoutMs: 30_000, totalTimeoutMs: 600_000, delayMs: 0, checks: ["failed-requests"], strictReadonly: false, ignoreRobots: false, storageState: false };
  return InspectionReport.parse({
    schemaVersion: "exegezis.inspection-report/v1",
    id,
    target: { url, origin },
    startedAt: "2026-09-26T10:00:00.000Z",
    finishedAt: "2026-09-26T10:01:00.000Z",
    exegezisVersion: "0.1.0",
    options,
    tools: { userAgent: "EXEGEZIS-Inspector/0.1.0", playwright: "1.63.0", axe: null, axeRules: [], checks: [{ id: "failed-requests", version: "1.0.0" }] },
    robots: { respected: true, fetched: false, disallow: [] },
    totalTimeoutReached: false,
    status: deriveInspectionStatus(pages, false),
    pages,
    externalLinks: [],
    pageWrites,
    checks,
    findings,
    summary: deriveSummary(findings, pages, pageWrites, checks, options),
  });
}

/** Writes the report and the evidence it points at under `dir`. */
export async function writeInspection(dir: string, report: InspectionReport = buildReport()): Promise<void> {
  await mkdir(join(dir, "pages/run-1/R1"), { recursive: true });
  await mkdir(join(dir, "specs"), { recursive: true });
  await writeFile(join(dir, "inspection-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(dir, "specs/INSPECT-F-001.spec.ts"), "// spec\n");
  await writeFile(
    join(dir, "pages/run-1/R1/network.json"),
    JSON.stringify({
      schemaVersion: "exegezis.network/v1",
      exchanges: [
        {
          kind: "network_exchange",
          id: "net-0001",
          request: { timestamp: "2026-09-26T10:00:01.000Z", method: "GET", url: `${report.target.origin}/api/fail`, resourceType: "fetch", isNavigation: false, headers: {} },
          response: { timestamp: "2026-09-26T10:00:01.050Z", status: 500, statusText: "Internal Server Error", headers: {}, fromServiceWorker: false },
        },
      ],
    }),
  );
}

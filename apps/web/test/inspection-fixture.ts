import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFindings,
  deriveFindings,
  deriveInspectionStatus,
  deriveIssueGroups,
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
    metrics: { ttfbMs: 120 + run * 10, fcpMs: 800, lcpMs: 2400 + run * 100, cls: 0.02, tbtMs: 150, loadMs: 1500, bytes: 1_200_000, requests: 40 },
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

/**
 * A report with something in every area (v2, desktop and mobile, 3 runs):
 * an accessibility rule on the menu, a missing CSP on every page, a poor LCP
 * on mobile, a third party's uncompressed script, a soft 404, small touch
 * targets in the menu; and lab metrics for every visit.
 */
export function buildAreasReport(id = "01M4AREAS0000000000000000A", origin = "https://shop.example"): InspectionReport {
  const urls = [`${origin}/`, `${origin}/about`];
  const runs = 3;
  const devices = ["desktop", "mobile"] as const;
  const pages: PageVisit[] = devices.flatMap((device) =>
    urls.flatMap((url, i) =>
      [1, 2, 3].map((run) => ({
        url,
        depth: i,
        run,
        status: "OK" as const,
        finalUrl: url,
        httpStatus: 200,
        settled: true,
        reason: null,
        runPath: `pages/${device === "desktop" ? "" : "mobile-"}run-${run}/P${i}`,
        blockedWrites: 0,
        block: null,
        device,
        metrics: { ttfbMs: 300 + run * 40, fcpMs: 900 + run * 50, lcpMs: device === "mobile" && i === 0 ? 5000 + run * 200 : 1800 + run * 100, cls: 0.05 * run, tbtMs: 120 * run, loadMs: 2100, bytes: 2_400_000 + run * 1000, requests: 60 + run },
      })),
    ),
  );
  const o = (fingerprint: string, title: string, severity: InspectionObservation["severity"], detail = "", thirdParty = false): InspectionObservation => ({ fingerprint, title, detail, severity, thirdParty, evidence: [], assertion: null });
  const checks: CheckResult[] = pages.map((p) => {
    const home = p.depth === 0;
    const observations: InspectionObservation[] = [
      o("a11y:link-name nav > a.icon", "Links must have discernible text (link-name): nav > a.icon", "serious"),
      o("security-headers:csp-missing", "No Content-Security-Policy", "moderate"),
      o("heavy-resources:uncompressed https://ads.example/x.js", "JavaScript sent without compression: x.js", "minor", "", true),
    ];
    if (p.device === "mobile") {
      observations.push(o("mobile-tap-targets:nav > ul > li:nth-of-type(1) > a", "Touch target smaller than 24×24 px: «Menu»", "moderate", "nav > ul > li:nth-of-type(1) > a is 18×18 px; WCAG 2.2 (2.5.8, Target Size Minimum) asks for at least 24×24 px, or enough space around it."));
      if (home) observations.push(o("perf-vitals:lcp", `Largest Contentful Paint ${((p.metrics?.lcpMs ?? 0) / 1000).toFixed(1)} s (poor: over 4 s)`, "moderate"));
    }
    if (home && p.device === "desktop") observations.push(o("site-config:soft-404", "Missing pages answer 200 («soft 404»)", "moderate"));
    return { checkId: "", checkVersion: "1.0.0", page: p.url, run: p.run, status: "ran" as const, error: null, observations, device: p.device };
  }).flatMap((c) => {
    // One result per check, as the inspector records them.
    const byCheck = new Map<string, InspectionObservation[]>();
    for (const ob of c.observations) {
      const checkId = ob.fingerprint.slice(0, ob.fingerprint.indexOf(":"));
      byCheck.set(checkId, [...(byCheck.get(checkId) ?? []), ob]);
    }
    return [...byCheck.entries()].map(([checkId, observations]) => ({ ...c, checkId, observations }));
  });
  const { groups } = deriveFindings(checks, pages, runs, false);
  const findings = buildFindings(groups, () => ({ checkVersion: "1.0.0", reproduction: ["Open the page."], spec: null, settled: true }));
  const checkIds = [...new Set(checks.map((c) => c.checkId))];
  const options = { maxPages: 10, maxDepth: 1, runs, pageTimeoutMs: 30_000, totalTimeoutMs: 600_000, delayMs: 0, checks: checkIds, strictReadonly: false, ignoreRobots: false, storageState: false, devices: [...devices] };
  return InspectionReport.parse({
    schemaVersion: "exegezis.inspection-report/v2",
    id,
    target: { url: urls[0], origin },
    startedAt: "2026-10-07T10:00:00.000Z",
    finishedAt: "2026-10-07T10:03:00.000Z",
    exegezisVersion: "0.1.0",
    options,
    tools: { userAgent: "EXEGEZIS-Inspector/0.1.0", playwright: "1.63.0", axe: "4.13.0", axeRules: ["link-name"], checks: checkIds.map((c) => ({ id: c, version: "1.0.0" })) },
    robots: { respected: true, fetched: true, disallow: [] },
    totalTimeoutReached: false,
    status: deriveInspectionStatus(pages, false),
    pages,
    externalLinks: [],
    skippedForSafety: [{ url: `${origin}/logout`, from: urls[0], reason: "looks like a logout or destructive action (logout)" }],
    pageWrites: [],
    checks,
    findings,
    summary: deriveSummary(findings, pages, [], checks, options),
    groups: deriveIssueGroups(findings),
  });
}

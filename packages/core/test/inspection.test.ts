import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Assertion,
  buildFindings,
  deriveFindings,
  deriveInspectionStatus,
  deriveSummary,
  describeAssertion,
  InspectionReport,
  normalizeMessage,
  normalizePageUrl,
  TestPlan,
  type CheckResult,
  type InspectionObservation,
  type PageVisit,
} from "../src/index.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("page-health assertions (additive)", () => {
  it("parses the five new kinds and describes them", () => {
    const kinds = [
      { kind: "console", level: "error", contains: "boom", expected: "absent" },
      { kind: "page_error", contains: "undefined is not a function", expected: "absent" },
      { kind: "request", request: { method: "GET", url: "/api/fail" }, expected: "ok" },
      { kind: "link", url: "http://localhost/missing", expected: "ok" },
      { kind: "a11y", rule: "image-alt", selector: "img#logo", expected: "no_violation" },
    ];
    for (const k of kinds) {
      const parsed = Assertion.parse(k);
      expect(describeAssertion(parsed)).toBeTypeOf("string");
    }
    expect(Assertion.safeParse({ kind: "a11y", rule: "Image Alt", selector: "img", expected: "no_violation" }).success).toBe(false);
    expect(Assertion.safeParse({ kind: "console", level: "error", contains: "", expected: "absent" }).success).toBe(false);
  });

  it("keeps every existing plan loadable", () => {
    for (const bug of ["BUG-001", "BUG-002", "BUG-003"]) {
      const plan = JSON.parse(readFileSync(join(REPO, "benchmarks/buggy-shop/cases", bug, "plan.json"), "utf8")) as unknown;
      expect(TestPlan.safeParse(plan).success).toBe(true);
    }
  });
});

describe("normalization", () => {
  it("drops fragments from page URLs and volatile parts from messages", () => {
    expect(normalizePageUrl("http://a.test/x?q=1#top")).toBe("http://a.test/x?q=1");
    expect(normalizeMessage("Failed to load http://a.test/api?id=42 with status 500 (req 9f8e7d6c5b4a)")).toBe(
      "Failed to load http://a.test/api with status <n> (req <id>)",
    );
  });
});

const PAGE = "http://fixture.test/";
const visit = (run: number, status: PageVisit["status"] = "OK", url = PAGE, depth = 0): PageVisit => ({
  url,
  depth,
  run,
  status,
  finalUrl: url,
  httpStatus: 200,
  settled: true,
  reason: null,
  runPath: `pages/run-${run}/x`,
  blockedWrites: 0,
});
const obs = (fingerprint: string, severity: InspectionObservation["severity"] = "serious"): InspectionObservation => ({
  fingerprint,
  title: fingerprint,
  detail: "",
  severity,
  thirdParty: false,
  evidence: [],
  assertion: null,
});
const check = (run: number, observations: InspectionObservation[], page = PAGE): CheckResult => ({
  checkId: "js-exceptions",
  checkVersion: "1.0.0",
  page,
  run,
  status: "ran",
  error: null,
  observations,
});

describe("verdicts", () => {
  const pages = [visit(1), visit(2), visit(3)];
  const checks = [check(1, [obs("a"), obs("b")]), check(2, [obs("a")]), check(3, [obs("a"), obs("b")])];

  it("VERIFIED only when observed in every run; otherwise INTERMITTENT", () => {
    const { groups } = deriveFindings(checks, pages, 3, false);
    expect(groups.find((g) => g.fingerprint === "a")).toMatchObject({ verdict: "VERIFIED", occurrences: [1, 2, 3] });
    expect(groups.find((g) => g.fingerprint === "b")).toMatchObject({ verdict: "INTERMITTENT", occurrences: [1, 3] });
  });

  it("discards observations of DEGRADED visits under --strict-readonly", () => {
    const degraded = [visit(1, "DEGRADED"), visit(2), visit(3)];
    const strict = deriveFindings(checks, degraded, 3, true);
    expect(strict.discarded).toBe(2);
    expect(strict.groups.find((g) => g.fingerprint === "a")?.verdict).toBe("INTERMITTENT");
  });

  it("derives the overall status from the entry page", () => {
    expect(deriveInspectionStatus([visit(1)], false)).toBe("COMPLETED");
    expect(deriveInspectionStatus([visit(1, "BLOCKED")], false)).toBe("BLOCKED");
    expect(deriveInspectionStatus([visit(1, "UNREACHABLE")], false)).toBe("UNREACHABLE");
    expect(deriveInspectionStatus([visit(1), visit(1, "TIMEOUT", "http://fixture.test/b", 1)], false)).toBe("PARTIAL");
    expect(deriveInspectionStatus([visit(1)], true)).toBe("PARTIAL");
    expect(deriveInspectionStatus([], false)).toBe("UNREACHABLE");
    expect(deriveInspectionStatus([], false, true)).toBe("ENGINE_ERROR");
    expect(deriveInspectionStatus([visit(1)], false, true)).toBe("ENGINE_ERROR");
  });
});

describe("report re-derivation: a manipulated report does not load", () => {
  const pages = [visit(1), visit(2), visit(3)];
  const checks = [check(1, [obs("a"), obs("b")]), check(2, [obs("a")]), check(3, [obs("a"), obs("b")])];
  const options = {
    maxPages: 20,
    maxDepth: 2,
    runs: 3,
    pageTimeoutMs: 30000,
    totalTimeoutMs: 600000,
    delayMs: 500,
    checks: ["js-exceptions"],
    strictReadonly: false,
    ignoreRobots: false,
    storageState: false,
  };
  const { groups } = deriveFindings(checks, pages, 3, false);
  const findings = buildFindings(groups, () => ({ checkVersion: "1.0.0", reproduction: [], spec: null, settled: true }));
  const report = {
    schemaVersion: "exegezis.inspection-report/v1",
    id: "x",
    target: { url: PAGE, origin: "http://fixture.test" },
    startedAt: "2026-09-25T00:00:00.000Z",
    finishedAt: "2026-09-25T00:00:01.000Z",
    exegezisVersion: "0.1.0",
    options,
    tools: { userAgent: "EXEGEZIS-Inspector/0.1.0", playwright: "1.63.0", axe: "4.13.0", axeRules: ["image-alt"], checks: [{ id: "js-exceptions", version: "1.0.0" }] },
    robots: { respected: true, fetched: true, disallow: [] },
    totalTimeoutReached: false,
    status: "COMPLETED",
    pages,
    externalLinks: [],
    pageWrites: [],
    checks,
    findings,
    summary: deriveSummary(findings, pages, [], checks, options),
  };

  it("loads when everything follows from the observations", () => {
    expect(RootIsValid(report)).toBe(true);
    expect(report.summary.verified.serious).toBe(1);
    expect(report.summary.intermittent).toBe(1);
  });

  it("rejects an intermittent finding promoted to VERIFIED", () => {
    const tampered = { ...report, findings: report.findings.map((f) => ({ ...f, verdict: "VERIFIED" })) };
    expect(RootIsValid(tampered)).toBe(false);
  });

  it("rejects a finding with invented occurrences, a dropped finding, a wrong count or a wrong status", () => {
    expect(RootIsValid({ ...report, findings: report.findings.map((f) => ({ ...f, occurrences: [1, 2, 3] })) })).toBe(false);
    expect(RootIsValid({ ...report, findings: report.findings.slice(1) })).toBe(false);
    expect(RootIsValid({ ...report, summary: { ...report.summary, intermittent: 0 } })).toBe(false);
    expect(RootIsValid({ ...report, status: "BLOCKED" })).toBe(false);
  });

  it("loads reports written before the browser and engine-error fields existed", () => {
    const parsed = InspectionReport.parse(report);
    expect(parsed.engineError).toBeNull();
    expect(parsed.tools.browser).toBeNull();
  });

  it("an engine error is ENGINE_ERROR and nothing else: never UNREACHABLE, never COMPLETED", () => {
    const engineError = { message: "no browser could be started", attempts: [{ engine: "chromium (Playwright)", error: "Executable doesn't exist" }], remedy: ["exegezis doctor --install"] };
    const empty = { ...report, pages: [], checks: [], findings: [], engineError, summary: deriveSummary([], [], [], [], options) };
    expect(RootIsValid({ ...empty, status: "ENGINE_ERROR" })).toBe(true);
    expect(RootIsValid({ ...empty, status: "UNREACHABLE" })).toBe(false);
    expect(RootIsValid({ ...report, status: "ENGINE_ERROR" })).toBe(false);
  });

  it("rejects a finding whose severity differs from the observation", () => {
    expect(RootIsValid({ ...report, findings: report.findings.map((f) => ({ ...f, severity: "minor" })) })).toBe(false);
  });
});

function RootIsValid(value: unknown): boolean {
  return InspectionReport.safeParse(value).success;
}

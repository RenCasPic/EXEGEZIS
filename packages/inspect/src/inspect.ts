import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compileToPlaywright } from "@exegezis/compiler-playwright";
import {
  buildFindings,
  deriveFindings,
  deriveInspectionStatus,
  deriveIssueGroups,
  deriveSummary,
  describeAssertion,
  hashJson,
  InspectionReport,
  normalizePageUrl,
  TestPlan,
  type CheckResult,
  type FindingGroup,
  type PageVisit,
  type PageWrite,
} from "@exegezis/core";
import { selectChecks, type Check, type LinkStatus, type PageEvidence } from "./checks/index.js";
import { crawlSite, type CrawlOptions, type CrawlProgress } from "./crawl.js";

export { PROGRESS_FILE, unsafeLinkMatcher, userAgentFor } from "./crawl.js";

export const INSPECTION_REPORT_FILE = "inspection-report.json";

export interface InspectOptions extends CrawlOptions {
  id: string;
  checks?: string[];
  /** Internal links probed per run, beyond the pages visited. */
  maxLinkChecks?: number;
  onProgress?: (progress: InspectionProgress) => void;
}

export type InspectionProgress = CrawlProgress;

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;

/**
 * Inspects a site: the shared crawl (crawl.ts) visits it; checks are pure
 * functions of each visit's recorded evidence; verdicts come from how many
 * runs an observation appeared in. Read-only.
 */
export async function inspectSite(options: InspectOptions): Promise<InspectionReport> {
  const checks = selectChecks(options.checks);
  const maxLinkChecks = options.maxLinkChecks ?? 100;
  return crawlSite(options, async (crawl) => {
    const { cfg, entry, origin, pages, visits, probe, allowed, unsafe, overBudget, strict, engineError, report } = crawl;

    // Link statuses per run: a visited page answers for itself; other internal links get one GET each.
    const probed = new Map<string, LinkStatus>();
    let probes = 0;
    const statusOf = async (url: string, run: number): Promise<LinkStatus> => {
      const own = pages.find((p) => p.run === run && p.url === url && p.httpStatus !== null);
      if (own !== undefined) return { url, status: own.httpStatus, error: null, checked: true };
      if (!allowed(url) || unsafe(url, "") !== null) return { url, status: null, error: null, checked: false };
      const key = `${run} ${url}`;
      const cached = probed.get(key);
      if (cached !== undefined) return cached;
      if (probes >= maxLinkChecks * cfg.runs || overBudget()) return { url, status: null, error: null, checked: false };
      probes += 1;
      const r = await probe.get(url);
      const status: LinkStatus = r.ok ? { url, status: r.status, error: null, checked: true } : { url, status: null, error: r.error, checked: true };
      probed.set(key, status);
      return status;
    };

    const results: CheckResult[] = [];
    for (const { visit: v, evidence } of engineError === null ? visits : []) {
      const runChecks = evidence !== null && (v.status === "OK" || v.status === "DEGRADED" || (v.status === "HTTP_ERROR" && v.depth === 0));
      let links: LinkStatus[] = [];
      if (runChecks) {
        const internal = [...new Set(evidence.inspection.links.map((l) => normalizePageUrl(l.href)).filter((u) => new URL(u).origin === origin))];
        links = await Promise.all(internal.map((u) => statusOf(u, v.run)));
      }
      for (const check of checks) {
        results.push(runCheck(check, v, runChecks && evidence !== null ? { ...evidence, links } : null));
      }
    }

    // Verdicts, then specs for the VERIFIED findings.
    if (engineError === null) await report({ phase: "specs" });
    const { groups } = deriveFindings(results, pages, cfg.runs, strict);
    const specs = new Map<string, string | null>();
    const specDir = join(options.dir, "specs");
    await mkdir(specDir, { recursive: true });
    const ordered = buildFindings(groups, () => ({ checkVersion: "", reproduction: [], spec: null, settled: true }));
    for (const f of ordered) {
      const group = groups.find((g) => g.page === f.page && g.checkId === f.checkId && g.fingerprint === f.fingerprint) as FindingGroup;
      specs.set(group.key, f.verdict === "VERIFIED" && f.assertion !== null ? await writeSpec(f.id, f.title, f.page, f.assertion, specDir, options) : null);
    }
    const findings = buildFindings(groups, (g) => ({
      checkVersion: checks.find((c) => c.id === g.checkId)?.version ?? "",
      reproduction: reproductionSteps(g),
      spec: specs.get(g.key) ?? null,
      settled: pages.filter((p) => p.url === g.page && g.occurrences.includes(p.run)).every((p) => p.settled === true),
    }));

    const pageWrites: PageWrite[] = visits.flatMap(({ visit: v, evidence }) =>
      (evidence?.network.exchanges ?? [])
        .filter((x) => !["GET", "HEAD", "OPTIONS"].includes(x.request.method))
        .map((x) => ({
          method: x.request.method,
          url: x.request.url,
          status: x.response?.status ?? null,
          page: v.url,
          run: v.run,
          // The adapter's own record of what it blocked is the source of truth.
          blocked: (evidence?.inspection.blockedWrites ?? []).some((b) => b.method === x.request.method && b.url === x.request.url),
        })),
    );
    const browser = visits.find((v) => v.browser !== null)?.browser ?? null;
    const firstAxe = visits.find((v) => v.evidence?.inspection.axe !== null && v.evidence?.inspection.axe !== undefined)?.evidence?.inspection.axe ?? null;
    const reportOptions = {
      maxPages: cfg.maxPages,
      maxDepth: cfg.maxDepth,
      runs: cfg.runs,
      pageTimeoutMs: cfg.pageTimeoutMs,
      totalTimeoutMs: cfg.totalTimeoutMs,
      delayMs: cfg.delayMs,
      checks: checks.map((c) => c.id),
      strictReadonly: strict,
      ignoreRobots: options.ignoreRobots === true,
      storageState: options.storageState !== undefined,
    };
    const inspection = InspectionReport.parse({
      schemaVersion: "exegezis.inspection-report/v2",
      id: options.id,
      target: { url: entry, origin },
      startedAt: crawl.startedAt,
      finishedAt: new Date().toISOString(),
      exegezisVersion: options.exegezisVersion,
      options: reportOptions,
      tools: {
        userAgent: crawl.userAgent,
        playwright: PLAYWRIGHT_VERSION,
        axe: firstAxe?.version ?? null,
        axeRules: firstAxe?.rules ?? [],
        checks: checks.map((c) => ({ id: c.id, version: c.version })),
        browser,
      },
      robots: { respected: options.ignoreRobots !== true, fetched: crawl.robotsFetched, disallow: crawl.robots?.disallow ?? [] },
      totalTimeoutReached: crawl.totalTimeoutReached,
      engineError,
      skippedForSafety: [...crawl.skippedForSafety.values()],
      access: { session: crawl.sessionUsed, httpCredentials: crawl.access?.httpCredentials !== undefined, wafToken: crawl.access?.wafToken !== undefined, traceDropped: crawl.traceDropped },
      rateLimit: crawl.rateLimit,
      status: deriveInspectionStatus(pages, crawl.totalTimeoutReached, engineError !== null),
      pages,
      externalLinks: [...crawl.externalLinks.entries()].map(([url, from]) => ({ url, from })),
      pageWrites,
      checks: results,
      findings,
      summary: deriveSummary(findings, pages, pageWrites, results, { runs: cfg.runs, strictReadonly: strict }),
      groups: deriveIssueGroups(findings),
    });
    await writeFile(join(options.dir, INSPECTION_REPORT_FILE), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
    await report({ phase: "done", current: null });
    return inspection;
  });
}

function runCheck(check: Check, v: PageVisit, evidence: PageEvidence | null): CheckResult {
  const base = { checkId: check.id, checkVersion: check.version, page: v.url, run: v.run };
  if (evidence === null) return { ...base, status: "skipped", error: null, observations: [] };
  try {
    return { ...base, status: "ran", error: null, observations: check.run(evidence) };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : String(error), observations: [] };
  }
}

function reproductionSteps(g: FindingGroup): string[] {
  const steps = [`Open ${g.page} in a fresh browser context (no cookies, no cache).`, "Wait until the network is idle and the DOM stops changing."];
  if (g.first.assertion !== null) steps.push(`Check: ${describeAssertion(g.first.assertion)}.`);
  steps.push(`Observed: ${g.first.title}`);
  return steps;
}

async function writeSpec(id: string, title: string, page: string, assertion: NonNullable<FindingGroup["first"]["assertion"]>, dir: string, options: InspectOptions): Promise<string | null> {
  const plan = TestPlan.parse({
    schemaVersion: "exegezis.test-plan/v1",
    id: `INSPECT-${id}`,
    title: title.slice(0, 200),
    target: { kind: "web", baseUrl: `${new URL(page).origin}/` },
    provenance: { source: "tool", generator: "exegezis-inspect", model: null, version: options.exegezisVersion, promptVersion: null, createdAt: null },
    steps: [
      { type: "navigate", url: `${new URL(page).pathname}${new URL(page).search}` },
      { type: "assert", id: "correct-behaviour", purpose: "expectation", timeoutMs: 10_000, description: "The correct behaviour the finding contradicts", assertion },
    ],
  });
  try {
    const spec = compileToPlaywright(plan, { exegezisVersion: options.exegezisVersion, planHash: hashJson(plan), planPath: `specs/${id}.plan.json` });
    await writeFile(join(dir, `${id}.plan.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(join(dir, spec.fileName), spec.source, "utf8");
    return `specs/${spec.fileName}`;
  } catch {
    return null;
  }
}

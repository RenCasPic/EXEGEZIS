import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ProbeResult } from "@exegezis/adapter-browser";
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
import { selectChecks, selectSiteChecks, type Check, type LinkStatus, type PageEvidence } from "./checks/index.js";
import { probeSite, type SiteCheck, type SiteEvidence } from "./site.js";
import { crawlSite, type CrawlOptions, type CrawlProgress } from "./crawl.js";
import { DEFAULT_DEVICES } from "./devices.js";

export { PROGRESS_FILE, unsafeLinkMatcher, userAgentFor } from "./crawl.js";
export { DEFAULT_DEVICES, DEVICE_PROFILES } from "./devices.js";

export const INSPECTION_REPORT_FILE = "inspection-report.json";

/** Answers another site gives automated requests rather than people (bot protection, rate limits). */
const REFUSALS = new Set([401, 403, 429, 503, 999]);

/** Network-level failures of our own requests (not answers of the site). */
const OWN_NETWORK_ERROR = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|socket hang up/i;

/**
 * What a link's GET says about it. A link of the site that redirects to
 * another site which turns automated requests away (Udemy, LinkedIn…) is not
 * broken: what that site would answer a person is unknown, so it is not checked.
 */
export function linkStatus(url: string, origin: string, r: ProbeResult): LinkStatus {
  // The site's own host failing at the network level, right after its pages loaded, is this
  // computer's connection (DNS, timeouts, resets), not a broken link.
  if (!r.ok && new URL(url).origin === origin && OWN_NETWORK_ERROR.test(r.error)) return { url, status: null, error: null, checked: false };
  if (!r.ok) return { url, status: null, error: r.error, checked: true };
  if (new URL(r.finalUrl).origin !== origin && REFUSALS.has(r.status)) return { url, status: null, error: null, checked: false };
  return { url, status: r.status, error: null, checked: true };
}

export interface InspectOptions extends CrawlOptions {
  id: string;
  checks?: string[];
  /** Internal links probed per run, beyond the pages visited. */
  maxLinkChecks?: number;
  /** Tests only: the CA that signed the fixture's certificate, so the TLS check can trust it. */
  tlsCa?: string;
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
  const siteChecks = selectSiteChecks(options.checks);
  const maxLinkChecks = options.maxLinkChecks ?? 100;
  // Every page on desktop and on mobile unless told otherwise.
  return crawlSite({ ...options, devices: options.devices ?? DEFAULT_DEVICES }, async (crawl) => {
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
      const status = linkStatus(url, origin, await probe.get(url));
      probed.set(key, status);
      return status;
    };

    const results: CheckResult[] = [];
    for (const { visit: v, evidence } of engineError === null ? visits : []) {
      const runChecks = evidence !== null && (v.status === "OK" || v.status === "DEGRADED" || (v.status === "HTTP_ERROR" && v.depth === 0));
      let links: LinkStatus[] = [];
      if (runChecks) {
        // An address with a redacted part (a session id in the URL) cannot be requested as it was.
        const internal = [...new Set(evidence.inspection.links.filter((l) => URL.canParse(l.href)).map((l) => normalizePageUrl(l.href)).filter((u) => new URL(u).origin === origin && !/\[REDACTED\]|%5BREDACTED%5D/i.test(u)))];
        links = await Promise.all(internal.map((u) => statusOf(u, v.run)));
      }
      for (const check of checks) {
        results.push(runCheck(check, v, runChecks && evidence !== null ? { ...evidence, links } : null));
      }
    }

    // The site as a whole (HTTPS, configuration): probed once per run, recorded against the entry page.
    const primary = cfg.devices[0] ?? "desktop";
    for (let run = 1; engineError === null && siteChecks.length > 0 && run <= cfg.runs; run++) {
      const at = pages.find((p) => p.url === entry && p.run === run && p.device === primary);
      if (at === undefined || (at.status !== "OK" && at.status !== "DEGRADED")) continue;
      await report({ current: `${origin} (HTTPS, robots.txt, sitemap)` });
      const facts = await probeSite(probe, entry, run, {
        ...(options.tlsCa === undefined ? {} : { tlsCa: options.tlsCa }),
        // Self-signed fixtures without their CA: the certificate cannot be judged.
        skipTls: options.ignoreHTTPSErrors === true && options.tlsCa === undefined,
        robotsAllowed: allowed,
      });
      const path = `site-run-${run}.json`;
      await writeFile(join(options.dir, path), `${JSON.stringify(facts, null, 2)}\n`, "utf8");
      for (const check of siteChecks) results.push(runSiteCheck(check, entry, run, primary, { facts, path }));
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
      // A spec runs in a desktop browser: written for what is verified on desktop.
      const onDesktop = group.devices.some((d) => d.device === "desktop" && d.verdict === "VERIFIED");
      specs.set(group.key, onDesktop && f.assertion !== null ? await writeSpec(f.id, f.title, f.page, f.assertion, specDir, options) : null);
    }
    const findings = buildFindings(groups, (g) => ({
      checkVersion: [...checks, ...siteChecks].find((c) => c.id === g.checkId)?.version ?? "",
      reproduction: reproductionSteps(g),
      spec: specs.get(g.key) ?? null,
      settled: pages.filter((p) => p.url === g.page && g.devices.some((d) => d.device === p.device && d.occurrences.includes(p.run))).every((p) => p.settled === true),
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
          device: v.device,
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
      checks: [...checks, ...siteChecks].map((c) => c.id),
      strictReadonly: strict,
      ignoreRobots: options.ignoreRobots === true,
      storageState: options.storageState !== undefined,
      devices: cfg.devices,
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
        checks: [...checks, ...siteChecks].map((c) => ({ id: c.id, version: c.version })),
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
  const base = { checkId: check.id, checkVersion: check.version, page: v.url, run: v.run, device: v.device };
  if (evidence === null) return { ...base, status: "skipped", error: null, observations: [] };
  try {
    return { ...base, status: "ran", error: null, observations: check.run(evidence) };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : String(error), observations: [] };
  }
}

function runSiteCheck(check: SiteCheck, entry: string, run: number, device: PageVisit["device"], evidence: SiteEvidence): CheckResult {
  const base = { checkId: check.id, checkVersion: check.version, page: entry, run, device };
  try {
    return { ...base, status: "ran", error: null, observations: check.run(evidence) };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : String(error), observations: [] };
  }
}

function reproductionSteps(g: FindingGroup): string[] {
  const where = g.devices.filter((d) => d.verdict === "VERIFIED").map((d) => d.device);
  const as = where.length === 0 ? (g.devices[0]?.device ?? "desktop") : where.join(" and ");
  const steps = [`Open ${g.page} as ${as} (see DEVICE_PROFILES) in a fresh browser context (no cookies, no cache).`, "Wait until the page's own requests are done and the DOM stops changing."];
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

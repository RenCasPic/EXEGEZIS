import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { BrowserAdapter, HttpProbe, type AdapterAccess, type BrowserChannel, type ConcreteChannel } from "@exegezis/adapter-browser";
import { compileToPlaywright } from "@exegezis/compiler-playwright";
import {
  buildFindings,
  ConsoleFile,
  deriveFindings,
  deriveInspectionStatus,
  deriveIssueGroups,
  deriveSummary,
  describeAssertion,
  executeRun,
  hashJson,
  InspectionReport,
  INSPECTABLE,
  isEngineUnavailable,
  NetworkFile,
  normalizePageUrl,
  ObservationsFile,
  PageInspectionFile,
  RunRecorder,
  silentLogger,
  TestPlan,
  type CheckResult,
  type EngineErrorInfo,
  type FindingGroup,
  type PageVisit,
  type PageWrite,
} from "@exegezis/core";
import { selectChecks, type Check, type LinkStatus, type PageEvidence } from "./checks/index.js";
import { classifyVisit } from "./classify.js";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.js";

export const INSPECTION_REPORT_FILE = "inspection-report.json";
export const PROGRESS_FILE = "progress.json";

export interface InspectOptions {
  url: string;
  /** The inspection directory (created by the caller, e.g. runs/inspections/<id>). */
  dir: string;
  id: string;
  exegezisVersion: string;
  maxPages?: number;
  maxDepth?: number;
  runs?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  delayMs?: number;
  checks?: string[];
  storageState?: string;
  strictReadonly?: boolean;
  ignoreRobots?: boolean;
  headed?: boolean;
  /** Tests only (self-signed fixtures): the CLI never sets it. */
  ignoreHTTPSErrors?: boolean;
  /** Which browser to drive (see adapter-browser browsers.ts). Default: auto. */
  browserChannel?: BrowserChannel;
  /**
   * Saved access for the origin, decrypted by the caller (never written to
   * the report). With a session, --strict-readonly is on unless
   * `strictReadonly: false` is passed explicitly.
   */
  access?: AdapterAccess | null;
  /** Extra link patterns never visited (site setting), added to the built-in list. */
  unsafeLinkPatterns?: string[];
  /** Rate limiting: longest single wait and total waiting before giving up (ms). */
  maxRateLimitWaitMs?: number;
  maxRateLimitTotalMs?: number;
  /** Internal links probed per run, beyond the pages visited. */
  maxLinkChecks?: number;
  onProgress?: (progress: InspectionProgress) => void;
}

export interface InspectionProgress {
  phase: "robots" | "crawl" | "repeat" | "specs" | "done";
  run: number;
  runs: number;
  pagesDone: number;
  pagesPlanned: number;
  current: string | null;
  updatedAt: string;
}

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;

interface Visit {
  visit: PageVisit;
  evidence: Omit<PageEvidence, "links"> | null;
  /** The browser the adapter actually started for this visit. */
  browser: { channel: ConcreteChannel; version: string; system: boolean } | null;
  /** The trace held secrets of the saved access that could not be removed, so it was not kept. */
  traceDropped: boolean;
}

export function userAgentFor(version: string): string {
  return `EXEGEZIS-Inspector/${version}`;
}

/**
 * Inspects a site: run 1 walks it breadth-first within the same origin and
 * budget; runs 2..N revisit the same pages in fresh browser contexts. Checks
 * are pure functions of each visit's recorded evidence; verdicts come from
 * how many runs an observation appeared in. Read-only: the inspection only
 * navigates (goto) and makes GET/HEAD requests of its own.
 */
export async function inspectSite(options: InspectOptions): Promise<InspectionReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const entry = normalizePageUrl(options.url);
  const origin = new URL(entry).origin;
  const cfg = {
    maxPages: options.maxPages ?? 20,
    maxDepth: options.maxDepth ?? 2,
    runs: options.runs ?? 3,
    pageTimeoutMs: options.pageTimeoutMs ?? 30_000,
    totalTimeoutMs: options.totalTimeoutMs ?? 600_000,
    delayMs: options.delayMs ?? 500,
    maxLinkChecks: options.maxLinkChecks ?? 100,
  };
  const checks = selectChecks(options.checks);
  const userAgent = userAgentFor(options.exegezisVersion);
  const access = options.access ?? null;
  const sessionUsed = access?.storageState !== undefined;
  // With a session, read-only is strict unless explicitly turned off.
  const strict = options.strictReadonly ?? sessionUsed;
  const unsafe = unsafeLinkMatcher(options.unsafeLinkPatterns ?? []);
  const skippedForSafety = new Map<string, { url: string; from: string; reason: string }>();
  const rateLimit = { retries: 0, waitedSeconds: 0 };
  const maxWaitMs = options.maxRateLimitWaitMs ?? 60_000;
  const maxTotalMs = options.maxRateLimitTotalMs ?? 300_000;
  let traceDropped = false;
  const overBudget = () => Date.now() - t0 > cfg.totalTimeoutMs;
  let totalTimeoutReached = false;
  let lastNavigation = 0;

  const progress: InspectionProgress = { phase: "robots", run: 1, runs: cfg.runs, pagesDone: 0, pagesPlanned: 1, current: entry, updatedAt: startedAt };
  const report = async (patch: Partial<InspectionProgress>) => {
    Object.assign(progress, patch, { updatedAt: new Date().toISOString() });
    options.onProgress?.({ ...progress });
    await writeFile(join(options.dir, PROGRESS_FILE), `${JSON.stringify(progress, null, 2)}\n`, "utf8");
  };
  await mkdir(options.dir, { recursive: true });
  await report({});

  const probe = await HttpProbe.create({
    userAgent,
    timeoutMs: cfg.pageTimeoutMs,
    ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
    ...(options.ignoreHTTPSErrors === true ? { ignoreHTTPSErrors: true } : {}),
  });

  try {
    // robots.txt limits what is discovered, never the URL the user gave.
    let robots: RobotsRules | null = null;
    let robotsFetched = false;
    if (options.ignoreRobots !== true) {
      const result = await probe.get(`${origin}/robots.txt`, { text: true });
      if (result.ok && result.status === 200 && result.text !== null && !/text\/html/i.test(result.contentType ?? "")) {
        robots = parseRobots(result.text);
        robotsFetched = true;
      }
    }
    const allowed = (url: string) => robots === null || url === entry || isAllowed(robots, url);

    const pages: PageVisit[] = [];
    const visits: Visit[] = [];
    const externalLinks = new Map<string, string>();
    // The browser could not start on this machine: stop at once. Nothing more
    // is visited, no page is marked UNREACHABLE for it, no finding is derived.
    let engineError: EngineErrorInfo | null = null;

    let pace = cfg.delayMs;
    const visit = async (url: string, depth: number, run: number): Promise<Visit> => {
      for (let attempt = 0; ; attempt++) {
        const wait = pace - (Date.now() - lastNavigation);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastNavigation = Date.now();
        const v = await visitPage({ url, depth, run, dir: options.dir, options, userAgent, strict, pageTimeoutMs: cfg.pageTimeoutMs, origin, access, sessionUsed });
        if (v.traceDropped) traceDropped = true;
        // RATE_LIMITED: respect Retry-After (or back off), slow down, and try the same page again, within caps.
        const b = v.visit.block;
        if (b?.kind === "RATE_LIMITED") {
          const askedMs = b.retryAfterSeconds === null ? Math.min(maxWaitMs, 2000 * 2 ** attempt) : b.retryAfterSeconds * 1000;
          if (askedMs <= maxWaitMs && rateLimit.waitedSeconds * 1000 + askedMs <= maxTotalMs) {
            rateLimit.retries += 1;
            rateLimit.waitedSeconds += askedMs / 1000;
            pace = Math.min(Math.max(pace * 2, 1000), 10_000);
            await report({ current: `${url} (rate limited: waiting ${Math.ceil(askedMs / 1000)} s)` });
            await new Promise((r) => setTimeout(r, askedMs));
            continue;
          }
        }
        pages.push(v.visit);
        visits.push(v);
        return v;
      }
    };

    try {
      // Run 1: discovery.
      await report({ phase: "crawl", run: 1 });
      const targets: { url: string; depth: number }[] = [];
      const queue: { url: string; depth: number }[] = [{ url: entry, depth: 0 }];
      const seen = new Set([entry]);
      while (queue.length > 0) {
        const next = queue.shift() as { url: string; depth: number };
        if (overBudget()) {
          totalTimeoutReached = true;
          pages.push(skipped(next.url, next.depth, "SKIPPED_BUDGET", "the total time budget was used up"));
          continue;
        }
        if (targets.length >= cfg.maxPages) {
          pages.push(skipped(next.url, next.depth, "SKIPPED_BUDGET", `--max-pages ${cfg.maxPages} reached`));
          continue;
        }
        await report({ current: next.url, pagesPlanned: Math.min(cfg.maxPages, targets.length + queue.length + 1) });
        const v = await visit(next.url, next.depth, 1);
        targets.push(next);
        await report({ pagesDone: targets.length });
        if (next.depth === 0 && ["BLOCKED", "UNREACHABLE", "TIMEOUT"].includes(v.visit.status)) break;
        if (v.evidence === null || (v.visit.status !== "OK" && v.visit.status !== "DEGRADED")) continue;
        for (const link of v.evidence.inspection.links) {
          const url = normalizePageUrl(link.href);
          if (new URL(url).origin !== origin) {
            if (!externalLinks.has(url)) externalLinks.set(url, next.url);
            continue;
          }
          if (seen.has(url)) continue;
          seen.add(url);
          const danger = unsafe(url, link.text);
          if (danger !== null) {
            // Never followed: logging out or a destructive action behind a GET.
            skippedForSafety.set(url, { url, from: next.url, reason: danger });
            continue;
          }
          if (!allowed(url)) {
            pages.push(skipped(url, next.depth + 1, "SKIPPED_ROBOTS", "disallowed by robots.txt"));
            continue;
          }
          if (next.depth + 1 <= cfg.maxDepth) queue.push({ url, depth: next.depth + 1 });
        }
      }

      // Runs 2..N: the same pages, fresh contexts. No re-discovery: a stable page set.
      const revisit = targets.filter((t) => {
        const first = pages.find((p) => p.run === 1 && p.url === t.url);
        return first !== undefined && INSPECTABLE.includes(first.status);
      });
      for (let run = 2; run <= cfg.runs; run++) {
        await report({ phase: "repeat", run, pagesDone: 0, pagesPlanned: revisit.length });
        for (const [i, t] of revisit.entries()) {
          if (overBudget()) {
            totalTimeoutReached = true;
            pages.push(skipped(t.url, t.depth, "SKIPPED_BUDGET", "the total time budget was used up", run));
            continue;
          }
          await report({ current: t.url });
          await visit(t.url, t.depth, run);
          await report({ pagesDone: i + 1 });
        }
      }
    } catch (error) {
      if (!isEngineUnavailable(error)) throw error;
      engineError = error.toInfo();
    }

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
      if (probes >= cfg.maxLinkChecks * cfg.runs || overBudget()) return { url, status: null, error: null, checked: false };
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
      startedAt,
      finishedAt: new Date().toISOString(),
      exegezisVersion: options.exegezisVersion,
      options: reportOptions,
      tools: {
        userAgent,
        playwright: PLAYWRIGHT_VERSION,
        axe: firstAxe?.version ?? null,
        axeRules: firstAxe?.rules ?? [],
        checks: checks.map((c) => ({ id: c.id, version: c.version })),
        browser,
      },
      robots: { respected: options.ignoreRobots !== true, fetched: robotsFetched, disallow: robots?.disallow ?? [] },
      totalTimeoutReached,
      engineError,
      skippedForSafety: [...skippedForSafety.values()],
      access: { session: sessionUsed, httpCredentials: access?.httpCredentials !== undefined, wafToken: access?.wafToken !== undefined, traceDropped },
      rateLimit,
      status: deriveInspectionStatus(pages, totalTimeoutReached, engineError !== null),
      pages,
      externalLinks: [...externalLinks.entries()].map(([url, from]) => ({ url, from })),
      pageWrites,
      checks: results,
      findings,
      summary: deriveSummary(findings, pages, pageWrites, results, { runs: cfg.runs, strictReadonly: strict }),
      groups: deriveIssueGroups(findings),
    });
    await writeFile(join(options.dir, INSPECTION_REPORT_FILE), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
    await report({ phase: "done", current: null });
    return inspection;
  } finally {
    await probe.dispose();
  }
}

function skipped(url: string, depth: number, status: "SKIPPED_BUDGET" | "SKIPPED_ROBOTS", reason: string, run = 1): PageVisit {
  return { url, depth, run, status, finalUrl: null, httpStatus: null, settled: null, reason, runPath: null, blockedWrites: 0, block: null };
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

interface VisitArgs {
  url: string;
  depth: number;
  run: number;
  dir: string;
  options: InspectOptions;
  userAgent: string;
  strict: boolean;
  pageTimeoutMs: number;
  origin: string;
  /** A saved session is loaded into the visit's browser context. */
  sessionUsed?: boolean;
  access?: AdapterAccess | null;
}

/** One page, one run: a fresh browser, navigate + observe, then the adapter's inspection evidence. */
async function visitPage(args: VisitArgs): Promise<Visit> {
  const { url, depth, run, dir, options, userAgent, strict, origin } = args;
  const recorder = await RunRecorder.create({ outputDir: join(dir, "pages", `run-${run}`) });
  const runPath = relative(dir, recorder.dir).split("\\").join("/");
  const plan = TestPlan.parse({
    schemaVersion: "exegezis.test-plan/v1",
    id: "inspect-visit",
    title: `Inspect ${url}`.slice(0, 200),
    target: { kind: "web", baseUrl: url },
    steps: [
      { type: "navigate", url, timeoutMs: args.pageTimeoutMs },
      { type: "observe", label: "page" },
    ],
  });
  const adapter = new BrowserAdapter(
    {
    headless: options.headed !== true,
    browserChannel: options.browserChannel ?? "auto",
    inspect: true,
    userAgent,
    trace: run === 1,
    navigationTimeoutMs: args.pageTimeoutMs,
    blockPageWrites: strict,
    ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
    ...(options.ignoreHTTPSErrors === true ? { ignoreHTTPSErrors: true } : {}),
    },
    args.access ?? null,
  );
  const outcome = await executeRun({ adapter, plan, recorder, logger: silentLogger, command: "inspect", exegezisVersion: options.exegezisVersion });
  const read = async <T>(file: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T | null> => {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(join(recorder.dir, file), "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
  const [consoleFile, network, inspection, observations] = await Promise.all([
    read("console.json", ConsoleFile),
    read("network.json", NetworkFile),
    read("inspection.json", PageInspectionFile),
    read("observations.json", ObservationsFile),
  ]);
  const navigationError = outcome.metadata.error?.phase === "action" ? outcome.metadata.error.message : null;
  const c = classifyVisit({ navigationError, network, inspection, requestedUrl: url, strictReadonly: strict, sessionUsed: args.sessionUsed === true });
  const shot = observations?.screenshots[0];
  // The screenshot of the blocked page is the block's evidence.
  const block = c.block === null ? null : { ...c.block, evidence: { ...c.block.evidence, screenshot: shot === undefined ? null : `${runPath}/${shot.path}` } };
  const visit: PageVisit = {
    url,
    depth,
    run,
    status: c.status,
    finalUrl: c.finalUrl,
    httpStatus: c.httpStatus,
    settled: inspection === null ? null : inspection.settled.network && inspection.settled.dom,
    reason: c.reason,
    runPath,
    blockedWrites: inspection?.blockedWrites.length ?? 0,
    block,
  };
  const evidence =
    consoleFile !== null && network !== null && inspection !== null
      ? { page: url, origin, depth, run, runPath, console: consoleFile, network, inspection, observations, hasTrace: run === 1 && outcome.manifest.artifacts.some((a) => a.type === "trace") }
      : null;
  const b = outcome.metadata.environment?.browser;
  const browser = b?.channel === undefined ? null : { channel: b.channel, version: b.version, system: b.system === true };
  const traceDropped = /trace discarded/.test(outcome.metadata.collectors["trace"]?.detail ?? "");
  return { visit, evidence, browser, traceDropped };
}

/** Links that log out or act destructively behind a GET: never visited (docs/09-access.md §4). */
const UNSAFE_WORDS = "logout|log-out|log_out|signout|sign-out|sign_out|cerrar-sesion|cerrar_sesion|salir|delete|remove|destroy|unsubscribe|cancel|revoke|deactivate|borrar|eliminar|darse-de-baja";
const UNSAFE_PATH = new RegExp(`(^|[/._?=&-])(${UNSAFE_WORDS})([/._?=&-]|$)`, "i");
const UNSAFE_TEXT = /^\s*(log ?out|sign ?out|cerrar sesi[oó]n|salir|delete|remove|unsubscribe|cancel|borrar|eliminar|darse de baja)\b/i;

export function unsafeLinkMatcher(extra: readonly string[]): (url: string, text: string) => string | null {
  const custom = extra.filter((p) => p.trim() !== "").map((p) => p.trim().toLowerCase());
  return (url, text) => {
    let target = url;
    try {
      const u = new URL(url);
      target = `${u.pathname}${u.search}`;
    } catch {
      // keep the raw value
    }
    const path = UNSAFE_PATH.exec(target);
    if (path !== null) return `looks like a logout or destructive action (${path[2]?.toLowerCase() ?? ""})`;
    if (UNSAFE_TEXT.test(text)) return `link text "${text.trim().slice(0, 40)}" looks like a logout or destructive action`;
    const hit = custom.find((p) => target.toLowerCase().includes(p));
    return hit === undefined ? null : `matches the site's pattern "${hit}"`;
  };
}

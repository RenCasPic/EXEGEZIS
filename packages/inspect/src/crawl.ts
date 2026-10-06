import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BrowserAdapter, HttpProbe, type AdapterAccess, type BrowserChannel, type ConcreteChannel } from "@exegezis/adapter-browser";
import {
  ConsoleFile,
  englishOf,
  executeRun,
  INSPECTABLE,
  isEngineUnavailable,
  msg,
  NetworkFile,
  normalizePageUrl,
  ObservationsFile,
  PageInspectionFile,
  RunRecorder,
  silentLogger,
  TestPlan,
  TextBlocksFile,
  type EngineErrorInfo,
  type EngineMessage,
  type PageVisit,
} from "@exegezis/core";
import type { PageEvidence } from "./checks/index.js";
import { classifyVisit } from "./classify.js";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.js";

/*
 * The walk over a site, shared by inspections and searches (docs/10-search.md
 * §1): robots.txt, the breadth-first discovery of run 1, the revisits of runs
 * 2..N in fresh contexts, the page and time budgets, unsafe links, rate
 * limits, blocks, saved access and ENGINE_ERROR. What is done with each
 * visit's evidence belongs to the caller.
 */

export const PROGRESS_FILE = "progress.json";

export interface CrawlOptions {
  url: string;
  /** The output directory (created by the caller, e.g. runs/inspections/<id>). */
  dir: string;
  exegezisVersion: string;
  maxPages?: number;
  maxDepth?: number;
  runs?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  delayMs?: number;
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
  /** Run axe-core on each visit (inspections). Default true. */
  axe?: boolean;
  /** Keep a Playwright trace of the first run. Default true. */
  trace?: boolean;
  /** Search mode: record the page text in blocks (text-blocks.json). */
  extract?: { includeHidden: boolean };
  /** Pages visited at the same time (default 3). */
  concurrency?: number;
  /** At most this many visits to the same site at once, whatever `concurrency` says (default 3): never overload it. */
  perSiteLimit?: number;
  /**
   * When a page counts as loaded (adapter-browser options.ts): "first-party"
   * (default) waits for the page's own requests, DOM and main content and
   * ignores ads and analytics; "load" waits for the load event and the whole
   * network, as before.
   */
  readiness?: "first-party" | "load";
  onProgress?: (progress: CrawlProgress) => void;
}

/** Visits at the same time and per site, by default. */
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_PER_SITE_LIMIT = 3;

/** Runs `work` on every item with at most `limit` at a time; results in the items' order. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i] as T, i);
    }
  });
  await Promise.all(lanes);
  return results;
}

export interface CrawlProgress {
  phase: "robots" | "crawl" | "repeat" | "specs" | "search" | "ai" | "done";
  run: number;
  runs: number;
  pagesDone: number;
  pagesPlanned: number;
  current: string | null;
  updatedAt: string;
}

export interface Visit {
  visit: PageVisit;
  evidence: Omit<PageEvidence, "links"> | null;
  /** The browser the adapter actually started for this visit. */
  browser: { channel: ConcreteChannel; version: string; system: boolean } | null;
  /** The trace held secrets of the saved access that could not be removed, so it was not kept. */
  traceDropped: boolean;
  /** Search mode: the page text in blocks. */
  textBlocks: TextBlocksFile | null;
}

/** Everything the walk found, handed to the caller while the HTTP probe is still open. */
export interface Crawl {
  startedAt: string;
  entry: string;
  origin: string;
  cfg: { maxPages: number; maxDepth: number; runs: number; pageTimeoutMs: number; totalTimeoutMs: number; delayMs: number; concurrency: number };
  userAgent: string;
  strict: boolean;
  sessionUsed: boolean;
  access: AdapterAccess | null;
  robots: RobotsRules | null;
  robotsFetched: boolean;
  /** Whether robots.txt lets a URL be discovered (the entry always is). */
  allowed: (url: string) => boolean;
  unsafe: (url: string, text: string) => string | null;
  pages: PageVisit[];
  visits: Visit[];
  externalLinks: Map<string, string>;
  skippedForSafety: Map<string, { url: string; from: string; reason: string }>;
  rateLimit: { retries: number; waitedSeconds: number };
  traceDropped: boolean;
  totalTimeoutReached: boolean;
  engineError: EngineErrorInfo | null;
  overBudget: () => boolean;
  probe: HttpProbe;
  report: (patch: Partial<CrawlProgress>) => Promise<void>;
}

export function userAgentFor(version: string): string {
  return `EXEGEZIS-Inspector/${version}`;
}

/**
 * Walks a site: run 1 breadth-first within the same origin and budget; runs
 * 2..N revisit the same pages in fresh browser contexts. Several pages are
 * visited at once (`concurrency`, never more than `perSiteLimit` on the
 * site), level by level, so the pages found and their order are the same as
 * one at a time. Read-only: it only navigates (goto) and makes GET/HEAD
 * requests of its own. `use` receives the result while the HTTP probe is
 * open; the probe is closed afterwards.
 */
export async function crawlSite<T>(options: CrawlOptions, use: (crawl: Crawl) => Promise<T>): Promise<T> {
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
    concurrency: Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, options.perSiteLimit ?? DEFAULT_PER_SITE_LIMIT)),
  };
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
  let nextStart = 0;

  const progress: CrawlProgress = { phase: "robots", run: 1, runs: cfg.runs, pagesDone: 0, pagesPlanned: 1, current: entry, updatedAt: startedAt };
  const report = async (patch: Partial<CrawlProgress>) => {
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
    // Navigations start at least `pace` apart, whatever runs in parallel (polite to the site).
    const startSlot = async (): Promise<void> => {
      const now = Date.now();
      const at = Math.max(now, nextStart);
      nextStart = at + pace;
      if (at > now) await new Promise((r) => setTimeout(r, at - now));
    };
    const readiness = options.readiness ?? "first-party";
    let done = 0;
    const visit = async (url: string, depth: number, run: number): Promise<Visit> => {
      for (let attempt = 0; ; attempt++) {
        await startSlot();
        const v = await visitPage({ url, depth, run, dir: options.dir, options, userAgent, strict, pageTimeoutMs: cfg.pageTimeoutMs, origin, access, sessionUsed, readiness });
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
        return v;
      }
    };
    // Visits finish in any order: each is kept with its place, and sorted once at the end.
    const order = new Map<Visit, number>();
    const placed: { place: number; page: PageVisit }[] = [];
    let seq = 0;
    const keep = (v: Visit, place: number) => {
      order.set(v, place);
      visits.push(v);
      placed.push({ place, page: v.visit });
    };
    const skip = (page: PageVisit, place = seq++) => placed.push({ place, page });

    try {
      // Run 1: discovery, breadth-first, one level at a time (the pages of a level in parallel).
      await report({ phase: "crawl", run: 1 });
      const targets: { url: string; depth: number }[] = [];
      let level: { url: string; depth: number }[] = [{ url: entry, depth: 0 }];
      const seen = new Set([entry]);
      let stop = false;
      while (level.length > 0 && !stop) {
        const now: { url: string; depth: number; place: number }[] = [];
        for (const next of level) {
          if (overBudget()) {
            totalTimeoutReached = true;
            skip(skipped(next.url, next.depth, "SKIPPED_BUDGET", msg("pageTimeBudget")));
            continue;
          }
          if (targets.length >= cfg.maxPages) {
            skip(skipped(next.url, next.depth, "SKIPPED_BUDGET", msg("pageMaxPages", { max: String(cfg.maxPages) })));
            continue;
          }
          targets.push(next);
          now.push({ ...next, place: seq++ });
        }
        await report({ pagesPlanned: Math.min(cfg.maxPages, targets.length) });
        const results = await pool(now, cfg.concurrency, async (t) => {
          await report({ current: t.url });
          const v = await visit(t.url, t.depth, 1);
          keep(v, t.place);
          await report({ pagesDone: ++done });
          return v;
        });
        const following: { url: string; depth: number }[] = [];
        for (const [i, v] of results.entries()) {
          const from = now[i] as { url: string; depth: number };
          if (from.depth === 0 && ["BLOCKED", "UNREACHABLE", "TIMEOUT"].includes(v.visit.status)) {
            stop = true;
            break;
          }
          if (v.evidence === null || (v.visit.status !== "OK" && v.visit.status !== "DEGRADED")) continue;
          for (const link of v.evidence.inspection.links) {
            const url = normalizePageUrl(link.href);
            if (new URL(url).origin !== origin) {
              if (!externalLinks.has(url)) externalLinks.set(url, from.url);
              continue;
            }
            if (seen.has(url)) continue;
            seen.add(url);
            const danger = unsafe(url, link.text);
            if (danger !== null) {
              // Never followed: logging out or a destructive action behind a GET.
              skippedForSafety.set(url, { url, from: from.url, reason: danger });
              continue;
            }
            if (!allowed(url)) {
              skip(skipped(url, from.depth + 1, "SKIPPED_ROBOTS", msg("pageRobots")));
              continue;
            }
            if (from.depth + 1 <= cfg.maxDepth) following.push({ url, depth: from.depth + 1 });
          }
        }
        level = following;
      }

      // Runs 2..N: the same pages, fresh contexts. No re-discovery: a stable page set.
      const revisit = targets.filter((t) => {
        const first = placed.find((p) => p.page.run === 1 && p.page.url === t.url)?.page;
        return first !== undefined && INSPECTABLE.includes(first.status);
      });
      // All the repetitions share the parallel lanes; each visit is still a fresh browser.
      const repeats: { url: string; depth: number; run: number; place: number }[] = [];
      for (let run = 2; run <= cfg.runs; run++) for (const t of revisit) repeats.push({ ...t, run, place: seq++ });
      if (repeats.length > 0) {
        done = 0;
        await report({ phase: "repeat", run: 2, pagesDone: 0, pagesPlanned: revisit.length });
        await pool(repeats, cfg.concurrency, async (t) => {
          if (overBudget()) {
            totalTimeoutReached = true;
            skip(skipped(t.url, t.depth, "SKIPPED_BUDGET", msg("pageTimeBudget"), t.run), t.place);
            return;
          }
          await report({ current: t.url });
          const v = await visit(t.url, t.depth, t.run);
          keep(v, t.place);
          done++;
          // Progress per repetition: the repetition reached and its pages done.
          const run = 2 + Math.floor((done - 1) / Math.max(1, revisit.length));
          await report({ run: Math.min(run, cfg.runs), pagesDone: ((done - 1) % Math.max(1, revisit.length)) + 1 });
        });
      }
    } catch (error) {
      if (!isEngineUnavailable(error)) throw error;
      engineError = error.toInfo();
    }
    // The visits in the order a one-at-a-time walk would have made them.
    visits.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
    pages.push(...placed.sort((x, y) => x.place - y.place).map((p) => p.page));

    return await use({
      startedAt,
      entry,
      origin,
      cfg,
      userAgent,
      strict,
      sessionUsed,
      access,
      robots,
      robotsFetched,
      allowed,
      unsafe,
      pages,
      visits,
      externalLinks,
      skippedForSafety,
      rateLimit,
      traceDropped,
      totalTimeoutReached,
      engineError,
      overBudget,
      probe,
      report,
    });
  } finally {
    await probe.dispose();
  }
}

export function skipped(url: string, depth: number, status: "SKIPPED_BUDGET" | "SKIPPED_ROBOTS", reason: EngineMessage, run = 1): PageVisit {
  return { url, depth, run, status, finalUrl: null, httpStatus: null, settled: null, reason: englishOf(reason), reasonMessage: reason, runPath: null, blockedWrites: 0, block: null };
}

interface VisitArgs {
  url: string;
  depth: number;
  run: number;
  dir: string;
  options: CrawlOptions;
  userAgent: string;
  strict: boolean;
  pageTimeoutMs: number;
  origin: string;
  /** A saved session is loaded into the visit's browser context. */
  sessionUsed?: boolean;
  access?: AdapterAccess | null;
  readiness: "first-party" | "load";
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
      // First-party readiness: the page is ready by its own signals (adapter), not when every ad has loaded.
      { type: "navigate", url, timeoutMs: args.pageTimeoutMs, ...(args.readiness === "first-party" ? { waitUntil: "domcontentloaded" as const } : {}) },
      { type: "observe", label: "page" },
    ],
  });
  const adapter = new BrowserAdapter(
    {
      headless: options.headed !== true,
      browserChannel: options.browserChannel ?? "auto",
      inspect: true,
      axe: options.axe ?? true,
      extractText: options.extract !== undefined,
      includeHiddenText: options.extract?.includeHidden ?? true,
      userAgent,
      trace: run === 1 && options.trace !== false,
      navigationTimeoutMs: args.pageTimeoutMs,
      blockPageWrites: strict,
      readiness: args.readiness === "first-party" ? "first-party" : "networkidle",
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
  const [consoleFile, network, inspection, observations, textBlocks] = await Promise.all([
    read("console.json", ConsoleFile),
    read("network.json", NetworkFile),
    read("inspection.json", PageInspectionFile),
    read("observations.json", ObservationsFile),
    options.extract === undefined ? Promise.resolve(null) : read("text-blocks.json", TextBlocksFile),
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
    ...(c.reasonMessage === undefined ? {} : { reasonMessage: c.reasonMessage }),
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
  return { visit, evidence, browser, traceDropped, textBlocks };
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

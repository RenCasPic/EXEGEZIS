import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  deriveSearchCoverage,
  deriveSearchHits,
  deriveSearchStatus,
  deriveSearchSummary,
  INSPECTABLE,
  queryParts,
  SearchReport,
  TextBlocksFile,
  type EngineErrorInfo,
  type ExclusionCount,
  type MeaningCandidate,
  type PageVisit,
  type SearchAiUsage,
  type SearchObservation,
  type SearchQuery,
} from "@exegezis/core";
import { crawlSite, type CrawlOptions, type CrawlProgress } from "@exegezis/inspect";
import { compileExact, excludedBy, matchBlock, toObservation, type CompiledQuery } from "./exact.js";
import { MEANING_PROMPT_VERSION, runMeaning, type MeaningPage } from "./meaning.js";
import type { SearchModelClient } from "./model.js";
import { STEMMER } from "./variants.js";

export const SEARCH_REPORT_FILE = "search-report.json";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;

export interface SearchSiteOptions extends Omit<CrawlOptions, "axe" | "trace" | "extract"> {
  id: string;
  query: SearchQuery;
  savedSearchId?: string | null;
  /** Include text a visitor does not see (marked). Default true. */
  includeHidden?: boolean;
  /** The model for the meaning part, with the cost limit. Without it, a meaning part is reported as not run. */
  model?: { client: SearchModelClient; maxCostUsd: number } | null;
  /** "Today", for the past-date detector (tests). */
  now?: Date;
  /** Reuse the pages of an earlier search in `dir` (e.g. after approving its cost): no new visit to the site. */
  reuse?: { dir: string; report: SearchReport };
}

interface WalkedVisit {
  page: string;
  run: number;
  runPath: string | null;
  status: PageVisit["status"];
  textBlocks: TextBlocksFile | null;
}

/** What the walk over the site produced, from a fresh crawl or from an earlier search. */
interface Walked {
  startedAt: string;
  entry: string;
  origin: string;
  cfg: { maxPages: number; maxDepth: number; runs: number };
  userAgent: string;
  strict: boolean;
  robots: { respected: boolean; fetched: boolean; disallow: string[] };
  access: { session: boolean; httpCredentials: boolean; wafToken: boolean };
  totalTimeoutReached: boolean;
  engineError: EngineErrorInfo | null;
  pages: PageVisit[];
  skippedForSafety: { url: string; from: string; reason: string }[];
  browser: { channel: string; version: string; system: boolean } | null;
  visits: WalkedVisit[];
  report: (patch: Partial<CrawlProgress>) => Promise<void>;
}

/**
 * Searches a site (docs/10-search.md): the shared crawl in search mode
 * (text blocks, no axe, no trace), then the exact part over every run and the
 * meaning part over the first run, then the report — parsed with its own
 * schema, so a report that does not re-derive is never written.
 */
export async function searchSite(options: SearchSiteOptions): Promise<SearchReport> {
  const includeHidden = options.includeHidden ?? true;
  if (options.reuse !== undefined) return analyze(options, await fromReuse(options, options.reuse), includeHidden);
  return crawlSite({ ...options, axe: false, trace: false, extract: { includeHidden } }, async (crawl) =>
    analyze(
      options,
      {
        startedAt: crawl.startedAt,
        entry: crawl.entry,
        origin: crawl.origin,
        cfg: crawl.cfg,
        userAgent: crawl.userAgent,
        strict: crawl.strict,
        robots: { respected: options.ignoreRobots !== true, fetched: crawl.robotsFetched, disallow: crawl.robots?.disallow ?? [] },
        access: { session: crawl.sessionUsed, httpCredentials: crawl.access?.httpCredentials !== undefined, wafToken: crawl.access?.wafToken !== undefined },
        totalTimeoutReached: crawl.totalTimeoutReached,
        engineError: crawl.engineError,
        pages: crawl.pages,
        skippedForSafety: [...crawl.skippedForSafety.values()],
        browser: crawl.visits.find((v) => v.browser !== null)?.browser ?? null,
        visits: crawl.visits.map((v) => ({ page: v.visit.url, run: v.visit.run, runPath: v.visit.runPath, status: v.visit.status, textBlocks: v.textBlocks })),
        report: crawl.report,
      },
      includeHidden,
    ),
  );
}

async function fromReuse(options: SearchSiteOptions, reuse: { dir: string; report: SearchReport }): Promise<Walked> {
  const r = reuse.report;
  await mkdir(options.dir, { recursive: true });
  await cp(join(reuse.dir, "pages"), join(options.dir, "pages"), { recursive: true });
  const visits: WalkedVisit[] = [];
  for (const p of r.pages) {
    let textBlocks: TextBlocksFile | null = null;
    if (p.runPath !== null) {
      try {
        textBlocks = TextBlocksFile.parse(JSON.parse(await readFile(join(options.dir, p.runPath, "text-blocks.json"), "utf8")));
      } catch {
        textBlocks = null;
      }
    }
    visits.push({ page: p.url, run: p.run, runPath: p.runPath, status: p.status, textBlocks });
  }
  const report = (patch: Partial<CrawlProgress>): Promise<void> => {
    options.onProgress?.({ phase: "search", run: 1, runs: r.options.runs, pagesDone: 0, pagesPlanned: 0, current: null, ...patch, updatedAt: new Date().toISOString() });
    return Promise.resolve();
  };
  return {
    startedAt: new Date().toISOString(),
    entry: r.target.url,
    origin: r.target.origin,
    cfg: { maxPages: r.options.maxPages, maxDepth: r.options.maxDepth, runs: r.options.runs },
    userAgent: r.tools.userAgent,
    strict: r.options.strictReadonly,
    robots: r.robots,
    access: r.access,
    totalTimeoutReached: r.totalTimeoutReached,
    engineError: r.engineError,
    pages: r.pages,
    skippedForSafety: r.skippedForSafety,
    browser: r.tools.browser,
    visits,
    report,
  };
}

interface ExactResult {
  observations: SearchObservation[];
  excluded: ExclusionCount[];
}

function runExact(q: CompiledQuery, visits: readonly WalkedVisit[], now: Date): ExactResult {
  const observations: SearchObservation[] = [];
  // Blocks are counted once however many loads saw them (same page, same text).
  const excl = new Map<string, { blocks: Set<string>; pages: Set<string>; keys: Set<string> }>();
  const exclFor = (term: string) => {
    let e = excl.get(term);
    if (e === undefined) {
      e = { blocks: new Set(), pages: new Set(), keys: new Set() };
      excl.set(term, e);
    }
    return e;
  };
  for (const v of visits) {
    if (v.textBlocks === null || !INSPECTABLE.includes(v.status)) continue;
    const ref = { page: v.page, run: v.run, runPath: v.runPath };
    const lang = v.textBlocks.lang;
    const blocks = v.textBlocks.blocks;
    const hitting = blocks.map((b) => ({ block: b, by: excludedBy(b, q) }));
    const pageExcludedBy = q.excludeScope === "page" ? (hitting.find((h) => h.by !== null)?.by ?? null) : null;
    for (const { block, by } of hitting) {
      const reason = pageExcludedBy ?? by;
      const matches = matchBlock(block, q, lang, now);
      if (reason !== null) {
        const e = exclFor(reason);
        if (by !== null) e.blocks.add(JSON.stringify([v.page, block.kind, block.text]));
        e.pages.add(v.page);
        for (const m of matches) e.keys.add(toObservation(ref, block, m).key);
        continue;
      }
      for (const m of matches) observations.push(toObservation(ref, block, m));
    }
  }
  const reported = new Set(observations.map((o) => o.key));
  return {
    observations,
    excluded: q.excluded.map((e) => {
      const x = excl.get(e.label);
      return { term: e.label, scope: q.excludeScope, blocks: x?.blocks.size ?? 0, pages: x?.pages.size ?? 0, hits: x === undefined ? 0 : [...x.keys].filter((k) => !reported.has(k)).length };
    }),
  };
}

async function analyze(options: SearchSiteOptions, walked: Walked, includeHidden: boolean): Promise<SearchReport> {
  const parts = queryParts(options.query);
  const now = options.now ?? new Date();
  await walked.report({ phase: "search", current: null });

  const languages: Record<string, string | null> = {};
  for (const v of walked.visits) if (v.run === 1 && v.textBlocks !== null) languages[v.page] = v.textBlocks.lang;

  let observations: SearchObservation[] = [];
  let excluded: ExclusionCount[] = [];
  if (parts.exact !== null && walked.engineError === null) {
    const r = runExact(compileExact(parts.exact), walked.visits, now);
    observations = r.observations;
    excluded = r.excluded;
  }

  let candidates: MeaningCandidate[] = [];
  let ai: SearchAiUsage | null = null;
  if (parts.meaning !== null && walked.engineError === null) {
    const pages: MeaningPage[] = walked.visits
      .filter((v) => v.run === 1 && v.textBlocks !== null && INSPECTABLE.includes(v.status))
      .map((v) => ({ page: v.page, runPath: v.runPath, lang: v.textBlocks?.lang ?? null, blocks: v.textBlocks?.blocks ?? [] }));
    const model = options.model ?? null;
    if (model === null) {
      ai = emptyUsage("none", "none", 0, "model error: no model configured for the meaning part");
    } else if (pages.length > 0) {
      await walked.report({ phase: "ai", current: null, pagesDone: 0, pagesPlanned: pages.length });
      try {
        const r = await runMeaning({
          client: model.client,
          description: parts.meaning.description,
          pages,
          maxCostUsd: model.maxCostUsd,
          onBatch: (done, total) => void walked.report({ current: `lote ${done} de ${total}` }),
        });
        candidates = r.candidates;
        ai = r.usage;
      } catch (error) {
        ai = emptyUsage(model.client.provider, model.client.model, model.maxCostUsd, `model error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      ai = emptyUsage(model.client.provider, model.client.model, model.maxCostUsd, null);
    }
  }

  const hits = deriveSearchHits(observations, candidates, walked.cfg.runs);
  const body = {
    schemaVersion: "exegezis.search-report/v1" as const,
    id: options.id,
    target: { url: walked.entry, origin: walked.origin },
    startedAt: walked.startedAt,
    finishedAt: new Date().toISOString(),
    exegezisVersion: options.exegezisVersion,
    query: options.query,
    savedSearchId: options.savedSearchId ?? null,
    options: { maxPages: walked.cfg.maxPages, maxDepth: walked.cfg.maxDepth, runs: walked.cfg.runs, strictReadonly: walked.strict, ignoreRobots: options.ignoreRobots === true, includeHidden },
    tools: { userAgent: walked.userAgent, playwright: PLAYWRIGHT_VERSION, stemmer: parts.exact?.variants === true ? STEMMER : null, browser: walked.browser },
    robots: walked.robots,
    access: walked.access,
    totalTimeoutReached: walked.totalTimeoutReached,
    engineError: walked.engineError,
    pages: walked.pages,
    skippedForSafety: walked.skippedForSafety,
    languages,
    observations,
    candidates,
    excluded,
    ai,
    hits,
    coverage: deriveSearchCoverage(walked.pages, walked.skippedForSafety),
    summary: deriveSearchSummary(hits, candidates),
  };
  const report = SearchReport.parse({ ...body, status: deriveSearchStatus(body) });
  await mkdir(options.dir, { recursive: true });
  await writeFile(join(options.dir, SEARCH_REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await walked.report({ phase: "done", current: null });
  return report;
}

function emptyUsage(provider: string, model: string, maxCostUsd: number, error: string | null): SearchAiUsage {
  return { provider, model, promptVersion: MEANING_PROMPT_VERSION, estimateUsd: 0, maxCostUsd, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, calls: 0, pagesSent: [], redactions: 0, error };
}

export async function loadSearchReport(dir: string): Promise<SearchReport> {
  return SearchReport.parse(JSON.parse(await readFile(join(dir, SEARCH_REPORT_FILE), "utf8")));
}

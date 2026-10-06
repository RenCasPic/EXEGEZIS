import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MeaningQuery, SuggestedTerm, ulid, type SearchQuery, type SearchReport } from "@exegezis/core";
import {
  AnthropicSearchClient,
  compareSearches,
  describeQuery,
  exactQueryFrom,
  findTemplate,
  htmlToPdf,
  listTemplates,
  loadSearchReport,
  MockSearchClient,
  placeLabel,
  readReview,
  readSearchSettings,
  renderReportHtml,
  saveSearch,
  savedSearch,
  SEARCH_REPORT_FILE,
  searchSite,
  suggestTerms,
  templateQuery,
  toCsv,
  touchSavedSearch,
  type SearchModelClient,
} from "@exegezis/search";
import { cliLocale, engineText, t } from "./i18n.js";
import { EXIT, UsageError } from "./args.js";
import { printEngineError } from "./doctor.js";
import { remedyFor } from "./inspect.js";
import type { SearchCommand, SearchExportArgs, SearchRunArgs, SearchSuggestArgs } from "./search-args.js";
import { loadAccess, openStore } from "./session.js";
import { absolute, displayPath, printer, type CliIo } from "./shared.js";

/** The model was not called: its estimate was over the cost limit. */
export const EXIT_COST_LIMIT = 8;

export async function searchCommand(command: SearchCommand, io: CliIo, exegezisVersion: string): Promise<number> {
  switch (command.action) {
    case "run":
      return searchRun(command, io, exegezisVersion);
    case "suggest":
      return searchSuggest(command, io);
    case "export":
      return searchExport(command, io);
    case "templates": {
      const templates = await listTemplates();
      if (command.json) {
        io.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
        return EXIT.ok;
      }
      const out = printer(io);
      for (const tpl of templates) out(t("search.template", { id: tpl.id, version: String(tpl.version), origin: tpl.origin, kind: tpl.meaning === null ? "exact" : "both", name: tpl.name }));
      return EXIT.ok;
    }
  }
}

function modelClient(model: string, mockResponse: string | undefined, io: CliIo): SearchModelClient {
  if (mockResponse === undefined) return new AnthropicSearchClient(model);
  const text = readFileSync(absolute(io, mockResponse), "utf8");
  return new MockSearchClient(() => text, model);
}

const defined = <K extends string>(key: K, value: number | null | undefined) => (value === null || value === undefined ? {} : ({ [key]: value } as Record<K, number>));

interface Definition {
  url: string;
  query: SearchQuery;
  savedSearchId: string | null;
  options: { maxPages?: number; maxDepth?: number; runs?: number; includeHidden: boolean; noSession: boolean };
}

async function definitionOf(c: SearchRunArgs): Promise<Definition> {
  if (c.saved !== undefined) {
    const s = await savedSearch(c.saved);
    if (s === null) throw new UsageError(t("search.noSaved", { id: c.saved }));
    return {
      url: c.url ?? s.url,
      query: s.query,
      savedSearchId: s.id,
      options: {
        ...defined("maxPages", c.maxPages ?? s.options.maxPages),
        ...defined("maxDepth", c.maxDepth ?? s.options.maxDepth),
        ...defined("runs", c.runs ?? s.options.runs),
        includeHidden: s.options.includeHidden,
        noSession: c.noSession || s.options.noSession,
      },
    };
  }
  let query: SearchQuery;
  if (c.meaning !== undefined) query = MeaningQuery.parse({ kind: "meaning", description: c.meaning });
  else if (c.template !== undefined) {
    const tpl = await findTemplate(c.template);
    if (tpl === null) throw new UsageError(t("search.noTemplate", { id: c.template }));
    query = templateQuery(tpl, { withMeaning: c.withMeaning });
  } else {
    let suggested: SuggestedTerm[] = [];
    if (c.suggested !== undefined) {
      try {
        suggested = SuggestedTerm.array().parse(JSON.parse(c.suggested));
      } catch {
        throw new UsageError(t("search.suggestedJson"));
      }
    }
    try {
      query = exactQueryFrom({ ...(c.terms === undefined ? {} : { terms: c.terms }), variants: c.variants, excludeScope: c.excludeScope, regex: c.regex ?? null, suggested });
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  }
  const options = {
    ...(c.maxPages === undefined ? {} : { maxPages: c.maxPages }),
    ...(c.maxDepth === undefined ? {} : { maxDepth: c.maxDepth }),
    ...(c.runs === undefined ? {} : { runs: c.runs }),
    includeHidden: c.includeHidden,
    noSession: c.noSession,
  };
  if (c.url === undefined) throw new UsageError(t("args.missing", { option: "--url <site>" }));
  let savedSearchId: string | null = null;
  if (c.save !== undefined) {
    const s = await saveSearch({
      name: c.save,
      url: c.url,
      query,
      options: { maxPages: c.maxPages ?? null, maxDepth: c.maxDepth ?? null, runs: c.runs ?? null, includeHidden: c.includeHidden, noSession: c.noSession },
    });
    savedSearchId = s.id;
  }
  return { url: c.url, query, savedSearchId, options };
}

/** The previous run of the same saved search in this output directory, for «solo lo nuevo». */
async function previousRun(root: string, savedSearchId: string, currentId: string): Promise<SearchReport | null> {
  const base = join(root, "searches");
  if (!existsSync(base)) return null;
  const ids = readdirSync(base)
    .filter((n) => n < currentId && existsSync(join(base, n, SEARCH_REPORT_FILE)))
    .sort()
    .reverse();
  for (const id of ids) {
    try {
      const raw = JSON.parse(readFileSync(join(base, id, SEARCH_REPORT_FILE), "utf8")) as { savedSearchId?: string | null };
      if (raw.savedSearchId === savedSearchId) return await loadSearchReport(join(base, id));
    } catch {
      // an unreadable or incoherent report is not a previous run
    }
  }
  return null;
}

async function searchRun(c: SearchRunArgs, io: CliIo, exegezisVersion: string): Promise<number> {
  const out = printer(io);
  const def = await definitionOf(c);
  const id = ulid();
  const root = absolute(io, c.output);
  const dir = join(root, "searches", id);
  const settings = await readSearchSettings();
  const model = c.model ?? settings.model;
  const maxCostUsd = c.maxCostUsd ?? settings.maxCostUsd;

  const saved = def.options.noSession ? { access: null, entry: null, warning: null } : await loadAccess(def.url, io);
  const access = saved.access;
  const session = access?.storageState !== undefined;
  const strict = c.strictReadonly ?? session;
  const ignoreRobots = c.ignoreRobots || saved.entry?.settings.robotsOwner === true;
  const meaningOnly = def.query.kind === "meaning";
  const runs = def.options.runs ?? (meaningOnly ? 1 : 3);

  let reuse: { dir: string; report: SearchReport } | undefined;
  if (c.reuse !== undefined) {
    const reuseDir = existsSync(absolute(io, c.reuse)) ? absolute(io, c.reuse) : join(root, "searches", c.reuse);
    reuse = { dir: reuseDir, report: await loadSearchReport(reuseDir) };
  }

  out(t("search.title"));
  out();
  out(t("common.targetLine", { url: def.url }));
  out(t("search.query", { query: describeQuery({ query: def.query }, cliLocale()) }));
  if (saved.warning !== null) io.stderr.write(`${t("inspect.warning", { message: saved.warning })}\n`);
  if (access !== null) out(t("search.accessSaved"));
  else if (def.options.noSession) out(t("inspect.accessAnonymous"));
  const shown = reuse === undefined ? { maxPages: def.options.maxPages ?? 20, maxDepth: def.options.maxDepth ?? 2, runs } : reuse.report.options;
  out(t("search.budget", { pages: String(shown.maxPages), depth: String(shown.maxDepth), runs: shown.runs, reuse: reuse === undefined ? "" : t("search.reuse", { id: reuse.report.id }) }));
  const usesModel = def.query.kind === "meaning" || (def.query.kind === "template" && def.query.meaning !== null);
  if (usesModel) out(t("search.model", { model, limit: maxCostUsd.toFixed(2) }));
  out();

  let lastLine = "";
  const report = await searchSite({
    url: def.url,
    dir,
    id,
    exegezisVersion,
    query: def.query,
    savedSearchId: def.savedSearchId,
    includeHidden: def.options.includeHidden,
    runs,
    strictReadonly: strict,
    ignoreRobots,
    access,
    ...(saved.entry === null ? {} : { unsafeLinkPatterns: saved.entry.settings.unsafeLinkPatterns }),
    headed: c.headed,
    browserChannel: c.browserChannel,
    ...(def.options.maxPages === undefined ? {} : { maxPages: def.options.maxPages }),
    ...(def.options.maxDepth === undefined ? {} : { maxDepth: def.options.maxDepth }),
    ...(c.pageTimeoutMs === undefined ? {} : { pageTimeoutMs: c.pageTimeoutMs }),
    ...(c.totalTimeoutMs === undefined ? {} : { totalTimeoutMs: c.totalTimeoutMs }),
    ...(c.delayMs === undefined ? {} : { delayMs: c.delayMs }),
    ...(c.concurrency === undefined ? {} : { concurrency: c.concurrency }),
    model: usesModel ? { client: modelClient(model, c.mockResponse, io), maxCostUsd, language: cliLocale() } : null,
    ...(reuse === undefined ? {} : { reuse }),
    onProgress: (p) => {
      const line =
        p.phase === "crawl" || p.phase === "repeat"
          ? t("search.progressLoad", { run: String(p.run), runs: String(p.runs), done: String(p.pagesDone), planned: String(p.pagesPlanned), current: p.current === null ? "" : ` · ${p.current}` })
          : p.phase === "ai"
            ? t("search.progressModel", { current: p.current === null ? "" : ` · ${p.current}` })
            : `  ${p.phase}`;
      if (line !== lastLine) out(line);
      lastLine = line;
    },
  });

  if (def.savedSearchId !== null) await touchSavedSearch(def.savedSearchId);
  out();
  out(t("inspect.status", { status: report.status }));
  if (report.status === "ENGINE_ERROR" && report.engineError !== null) {
    out();
    printEngineError(io, report.engineError);
    return EXIT.engineError;
  }
  if (access !== null) {
    const expired = report.pages.some((p) => p.block?.kind === "SESSION_EXPIRED");
    await openStore().touch(def.url, { lastUsedAt: new Date().toISOString(), ...(expired ? { expired: true } : {}) });
  }
  const blocked = report.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  if (blocked !== null) {
    out(t("inspect.block", { kind: blocked.kind, detail: engineText(blocked.message, blocked.detail) }));
    for (const line of remedyFor(blocked.kind, report.target.origin, blocked.retryAfterSeconds)) out(`         ${line}`);
  }
  const cov = report.coverage;
  out(
    t("search.coverage", {
      searched: cov.searched,
      found: cov.found,
      rest: [
        cov.skippedBudget > 0 ? t("search.overBudget", { count: cov.skippedBudget }) : "",
        cov.skippedRobots > 0 ? t("search.robots", { count: cov.skippedRobots }) : "",
        cov.skippedSafety > 0 ? t("search.unsafe", { count: cov.skippedSafety }) : "",
        cov.blocked.length > 0 ? t("search.blocked", { count: cov.blocked.length }) : "",
        cov.failed > 0 ? t("search.failed", { count: cov.failed }) : "",
      ].join(""),
    }),
  );
  const s = report.summary;
  out(
    t("search.hits", {
      hits: s.hits,
      pages: s.pagesWithHits,
      verified: s.verified,
      intermittent: s.intermittent,
      suggested: s.suggested,
      rest: `${s.hidden > 0 ? t("search.hidden", { count: s.hidden }) : ""}${s.byVariant > 0 ? t("search.byVariant", { count: s.byVariant }) : ""}`,
    }),
  );
  for (const e of report.excluded) out(t("search.excluded", { term: e.term, scope: t(`search.scope.${e.scope}`), hits: e.hits, blocks: e.blocks, pages: e.pages }));
  if (report.ai !== null) {
    const a = report.ai;
    out(
      t("search.modelUsage", {
        model: a.model,
        calls: a.calls,
        input: String(a.inputTokens),
        output: String(a.outputTokens),
        cost: a.costUsd.toFixed(4),
        estimate: a.estimateUsd.toFixed(2),
        limit: a.maxCostUsd.toFixed(2),
        ms: String(a.latencyMs),
      }),
    );
    if (s.discardedQuotes > 0) out(t("search.discarded", { count: s.discardedQuotes }));
    if (a.error !== null) out(t("search.modelPart", { error: engineText(a.errorMessage, a.error) }));
    out(t("search.note"));
  }
  if (def.savedSearchId !== null) {
    const previous = await previousRun(root, def.savedSearchId, id);
    if (previous !== null) {
      const cmp = compareSearches(report, previous);
      const fresh = [...cmp.novelty.values()].filter((n) => n === "new").length;
      out(t("search.since", { id: previous.id, fresh: String(fresh), gone: String(cmp.gone.length) }));
    }
    out(t("search.savedSearch", { id: def.savedSearchId }));
  }
  if (report.hits.length === 0) out(t("search.noMatches", { count: cov.searched }));
  else {
    out();
    for (const h of report.hits.slice(0, 10)) out(`  [${h.verdict}${h.visible ? "" : t("search.notVisible")}${h.via === "variant" ? t("search.variantOf", { stem: h.stem ?? "" }) : ""}] ${h.page} — «${h.quote.slice(0, 120)}» (${placeLabel(h, cliLocale())})`);
    if (report.hits.length > 10) out(t("search.more", { count: report.hits.length - 10 }));
  }
  out();
  out(t("inspect.report"));
  out(displayPath(io, join(dir, SEARCH_REPORT_FILE), false));

  if (report.status === "BLOCKED" || report.status === "UNREACHABLE" || report.status === "TIMEOUT" || report.status === "AI_ERROR") return EXIT.inconclusive;
  if (report.status === "COST_LIMIT") return EXIT_COST_LIMIT;
  return EXIT.ok;
}

async function searchSuggest(c: SearchSuggestArgs, io: CliIo): Promise<number> {
  const settings = await readSearchSettings();
  const model = c.model ?? settings.model;
  const terms = exactTerms(c.terms);
  const result = await suggestTerms(modelClient(model, c.mockResponse, io), terms, c.maxCostUsd ?? settings.maxCostUsd, cliLocale());
  if (c.json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    const out = printer(io);
    for (const s of result.suggestions) out(t("search.suggestion", { term: s.term, relation: s.relation, from: s.from }));
    out(`${result.model} · ${result.costUsd.toFixed(4)} USD`);
  }
  return EXIT.ok;
}

function exactTerms(input: string): string[] {
  try {
    const q = exactQueryFrom({ terms: input });
    return [...q.terms, ...q.phrases];
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

async function searchExport(c: SearchExportArgs, io: CliIo): Promise<number> {
  const direct = absolute(io, c.search);
  const dir = existsSync(join(direct, SEARCH_REPORT_FILE)) ? direct : join(absolute(io, c.output), "searches", c.search);
  const report = await loadSearchReport(dir);
  const review = await readReview(dir);
  const target = c.out === undefined ? join(dir, `export.${c.format}`) : absolute(io, c.out);
  if (c.format === "csv") await writeFile(target, toCsv(report, review, c.separator, cliLocale()), "utf8");
  else await htmlToPdf(renderReportHtml(report, review, cliLocale()), target, c.browserChannel);
  printer(io)(displayPath(io, target, false));
  return EXIT.ok;
}

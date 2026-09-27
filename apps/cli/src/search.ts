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
  VERDICT_LABEL,
  type SearchModelClient,
} from "@exegezis/search";
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
      for (const t of templates) out(`${t.id} v${t.version} (${t.origin}${t.meaning === null ? ", no model" : ", exact + optional meaning"}) — ${t.name}`);
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
    if (s === null) throw new UsageError(`There is no saved search "${c.saved}".`);
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
    const t = await findTemplate(c.template);
    if (t === null) throw new UsageError(`There is no template "${c.template}". See: exegezis search templates`);
    query = templateQuery(t, { withMeaning: c.withMeaning });
  } else {
    let suggested: SuggestedTerm[] = [];
    if (c.suggested !== undefined) {
      try {
        suggested = SuggestedTerm.array().parse(JSON.parse(c.suggested));
      } catch {
        throw new UsageError('--suggested must be JSON: [{"term":"…","from":"…","relation":"…"}]');
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
  if (c.url === undefined) throw new UsageError("Missing required option --url <site>.");
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

  out("EXEGEZIS SEARCH");
  out();
  out(`Target:  ${def.url}`);
  out(`Query:   ${describeQuery({ query: def.query })}`);
  if (saved.warning !== null) io.stderr.write(`Warning: ${saved.warning}\n`);
  if (access !== null) out("Access:  with the saved access of this site (--no-session to search as an anonymous visitor)");
  else if (def.options.noSession) out("Access:  anonymous visitor (--no-session)");
  out(`Budget:  ${def.options.maxPages ?? 20} pages, depth ${def.options.maxDepth ?? 2}, ${runs} load${runs === 1 ? "" : "s"} per page${reuse === undefined ? "" : ` · reusing the pages of ${reuse.report.id} (the site is not visited again)`}`);
  const usesModel = def.query.kind === "meaning" || (def.query.kind === "template" && def.query.meaning !== null);
  if (usesModel) out(`Model:   ${model} · cost limit ${maxCostUsd.toFixed(2)} USD (estimated before any call)`);
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
    model: usesModel ? { client: modelClient(model, c.mockResponse, io), maxCostUsd } : null,
    ...(reuse === undefined ? {} : { reuse }),
    onProgress: (p) => {
      const line =
        p.phase === "crawl" || p.phase === "repeat"
          ? `  load ${p.run}/${p.runs} · ${p.pagesDone}/${p.pagesPlanned} pages${p.current === null ? "" : ` · ${p.current}`}`
          : p.phase === "ai"
            ? `  model${p.current === null ? "" : ` · ${p.current}`}`
            : `  ${p.phase}`;
      if (line !== lastLine) out(line);
      lastLine = line;
    },
  });

  if (def.savedSearchId !== null) await touchSavedSearch(def.savedSearchId);
  out();
  out(`Status:  ${report.status}`);
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
    out(`Block:   ${blocked.kind} — ${blocked.detail}`);
    for (const line of remedyFor(blocked.kind, report.target.origin, blocked.retryAfterSeconds)) out(`         ${line}`);
  }
  const cov = report.coverage;
  out(`Coverage: searched ${cov.searched} of ${cov.found} pages found${cov.skippedBudget > 0 ? ` · ${cov.skippedBudget} over --max-pages` : ""}${cov.skippedRobots > 0 ? ` · ${cov.skippedRobots} excluded by robots.txt` : ""}${cov.skippedSafety > 0 ? ` · ${cov.skippedSafety} unsafe links not visited` : ""}${cov.blocked.length > 0 ? ` · ${cov.blocked.length} blocked` : ""}${cov.failed > 0 ? ` · ${cov.failed} did not answer` : ""}`);
  const s = report.summary;
  out(`Hits:    ${s.hits} on ${s.pagesWithHits} page${s.pagesWithHits === 1 ? "" : "s"} · VERIFIED ${s.verified} · INTERMITTENT ${s.intermittent} · suggested (quote verified) ${s.suggested}${s.hidden > 0 ? ` · ${s.hidden} not visible` : ""}${s.byVariant > 0 ? ` · ${s.byVariant} through variants` : ""}`);
  for (const e of report.excluded) out(`Excluded by "${e.term}" (${e.scope}): ${e.hits} hits in ${e.blocks} blocks of ${e.pages} pages`);
  if (report.ai !== null) {
    const a = report.ai;
    out(`Model:   ${a.model} · ${a.calls} call${a.calls === 1 ? "" : "s"} · ${a.inputTokens} in / ${a.outputTokens} out tokens · ${a.costUsd.toFixed(4)} USD (estimate ${a.estimateUsd.toFixed(2)}, limit ${a.maxCostUsd.toFixed(2)}) · ${a.latencyMs} ms`);
    if (s.discardedQuotes > 0) out(`Discarded: ${s.discardedQuotes} model quote(s) that are not literally in the page`);
    if (a.error !== null) out(`Model part: ${a.error}`);
    out("Note:    a search by meaning can miss passages (false negatives); its hits are suggestions with a verified quote.");
  }
  if (def.savedSearchId !== null) {
    const previous = await previousRun(root, def.savedSearchId, id);
    if (previous !== null) {
      const cmp = compareSearches(report, previous);
      const fresh = [...cmp.novelty.values()].filter((n) => n === "new").length;
      out(`Since ${previous.id}: ${fresh} new · ${cmp.gone.length} no longer found`);
    }
    out(`Saved search: ${def.savedSearchId}`);
  }
  if (report.hits.length === 0) out(`0 matches in ${cov.searched} page${cov.searched === 1 ? "" : "s"} searched.`);
  else {
    out();
    for (const h of report.hits.slice(0, 10)) out(`  [${VERDICT_LABEL[h.verdict]}${h.visible ? "" : " · no visible"}${h.via === "variant" ? ` · variant of ${h.stem ?? ""}` : ""}] ${h.page} — «${h.quote.slice(0, 120)}» (${placeLabel(h)})`);
    if (report.hits.length > 10) out(`  … ${report.hits.length - 10} more in the report`);
  }
  out();
  out("Report:");
  out(displayPath(io, join(dir, SEARCH_REPORT_FILE), false));

  if (report.status === "BLOCKED" || report.status === "UNREACHABLE" || report.status === "TIMEOUT" || report.status === "AI_ERROR") return EXIT.inconclusive;
  if (report.status === "COST_LIMIT") return EXIT_COST_LIMIT;
  return EXIT.ok;
}

async function searchSuggest(c: SearchSuggestArgs, io: CliIo): Promise<number> {
  const settings = await readSearchSettings();
  const model = c.model ?? settings.model;
  const terms = exactTerms(c.terms);
  const result = await suggestTerms(modelClient(model, c.mockResponse, io), terms, c.maxCostUsd ?? settings.maxCostUsd);
  if (c.json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    const out = printer(io);
    for (const s of result.suggestions) out(`${s.term}  (${s.relation}, from ${s.from})`);
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
  if (c.format === "csv") await writeFile(target, toCsv(report, review, c.separator), "utf8");
  else await htmlToPdf(renderReportHtml(report, review), target, c.browserChannel);
  printer(io)(displayPath(io, target, false));
  return EXIT.ok;
}

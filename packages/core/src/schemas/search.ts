import { z } from "zod";
import { EngineErrorInfo } from "../engine.js";
import { EngineMessage } from "../messages.js";
import { canonicalJson, sha256 } from "../hash.js";
import { normalizeSearch, quoteAround, searchKey, textFragmentUrl, verifyQuote } from "../search-text.js";
import { deriveInspectionStatus, INSPECTABLE, InspectionStatus, PageVisit } from "./inspection.js";

/*
 * Searches over a site (docs/10-search.md §2). The report keeps the raw
 * observations (exact) and the raw model candidates (meaning); hits, verdicts,
 * the summary and the coverage are derived from them, and re-derived on load:
 * a report whose hits do not follow — or whose quotes are not literally in the
 * recorded block text — does not load.
 */

// ---------------------------------------------------------------------------
// Extraction (written by the adapter for each visit)
// ---------------------------------------------------------------------------

export const TextBlockKind = z.enum([
  "heading",
  "paragraph",
  "list-item",
  "cell",
  "button",
  "link",
  "label",
  "quote",
  "text",
  "alt",
  "title-attr",
  "aria-label",
  "meta-title",
  "meta-description",
  "og",
]);
export type TextBlockKind = z.infer<typeof TextBlockKind>;

export const BlockRect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type BlockRect = z.infer<typeof BlockRect>;

export const TextBlock = z.strictObject({
  /** Order of the block in the page (b1, b2…); stable within one visit only. */
  id: z.string(),
  kind: TextBlockKind,
  /** Heading level (1–6). */
  level: z.int().min(1).max(6).nullable(),
  text: z.string(),
  /** CSS selector of the element; null for page metadata. */
  selector: z.string().nullable(),
  /** Position in page coordinates (full-page screenshot); null when not rendered. */
  rect: BlockRect.nullable(),
  /** false: text in the page that a visitor does not see (closed accordion, hidden tab, display:none, aria-hidden). */
  visible: z.boolean(),
  /** Where attribute or metadata text came from (alt, og:title…). */
  source: z.string().nullable(),
});
export type TextBlock = z.infer<typeof TextBlock>;

export const TextBlocksFile = z.strictObject({
  schemaVersion: z.literal("exegezis.text-blocks/v1"),
  url: z.string(),
  lang: z.string().nullable(),
  title: z.string(),
  blocks: z.array(TextBlock),
  /** The page had more text than the extraction caps. */
  truncated: z.boolean(),
});
export type TextBlocksFile = z.infer<typeof TextBlocksFile>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const SearchDetector = z.enum(["email", "phone", "past-date"]);
export type SearchDetector = z.infer<typeof SearchDetector>;

export const SuggestedTerm = z.strictObject({
  term: z.string(),
  /** The term of the query it was suggested for. */
  from: z.string(),
  relation: z.string(),
});
export type SuggestedTerm = z.infer<typeof SuggestedTerm>;

export const ExactQuery = z.strictObject({
  kind: z.literal("exact"),
  /** Single words or several words without quotes (matched as whole words). */
  terms: z.array(z.string().min(1)),
  /** "Quoted phrases" (never expanded with variants). */
  phrases: z.array(z.string().min(1)),
  /** -words: the block (or page) that contains them is left out, and counted. */
  excluded: z.array(z.string().min(1)),
  excludeScope: z.enum(["block", "page"]).default("block"),
  variants: z.boolean().default(false),
  regex: z.string().nullable().default(null),
  detectors: z.array(SearchDetector).default([]),
  /** Terms a model suggested and the person accepted; searched exactly like the others. */
  suggested: z.array(SuggestedTerm).default([]),
});
export type ExactQuery = z.infer<typeof ExactQuery>;

export const MeaningQuery = z.strictObject({ kind: z.literal("meaning"), description: z.string().min(3) });
export type MeaningQuery = z.infer<typeof MeaningQuery>;

export const TemplateQuery = z.strictObject({
  kind: z.literal("template"),
  id: z.string(),
  version: z.int().positive(),
  name: z.string(),
  /** repository | user */
  origin: z.enum(["repository", "user"]),
  exact: ExactQuery.nullable(),
  meaning: MeaningQuery.nullable(),
});
export type TemplateQuery = z.infer<typeof TemplateQuery>;

export const SearchQuery = z.discriminatedUnion("kind", [ExactQuery, MeaningQuery, TemplateQuery]);
export type SearchQuery = z.infer<typeof SearchQuery>;
export type SearchQueryInput = z.input<typeof SearchQuery>;

/** The exact and meaning parts of any query. */
export function queryParts(q: SearchQuery): { exact: ExactQuery | null; meaning: MeaningQuery | null } {
  if (q.kind === "exact") return { exact: q, meaning: null };
  if (q.kind === "meaning") return { exact: null, meaning: q };
  return { exact: q.exact, meaning: q.meaning };
}

// ---------------------------------------------------------------------------
// Raw results
// ---------------------------------------------------------------------------

export const MatchVia = z.enum(["exact", "variant", "regex", "detector", "meaning"]);
export type MatchVia = z.infer<typeof MatchVia>;

const Span = z.strictObject({ start: z.int().nonnegative(), end: z.int().nonnegative() });

const Located = {
  page: z.string(),
  /** Run directory of the visit, relative to the search directory. */
  runPath: z.string().nullable(),
  blockId: z.string(),
  blockKind: TextBlockKind,
  visible: z.boolean(),
  selector: z.string().nullable(),
  rect: BlockRect.nullable(),
};

/** One exact match in one visit. */
export const SearchObservation = z.strictObject({
  run: z.int().positive(),
  ...Located,
  /** The query item that matched: a term, "a phrase", the regex, or a detector name. */
  term: z.string(),
  via: MatchVia.exclude(["meaning"]),
  /** The page's own words that matched. */
  matchedText: z.string(),
  /** Variant matches: the shared stem. */
  stem: z.string().nullable(),
  quote: z.string(),
  contextBefore: z.string(),
  contextAfter: z.string(),
  match: Span,
  key: z.string(),
});
export type SearchObservation = z.infer<typeof SearchObservation>;

export const Relevance = z.enum(["high", "medium", "low"]);
export type Relevance = z.infer<typeof Relevance>;

/** What a model proposed for one block, and whether its quote is literally there. */
export const MeaningCandidate = z.strictObject({
  ...Located,
  quote: z.string(),
  reason: z.string(),
  relevance: Relevance,
  /** The block text exactly as it was sent (after redaction): the quote is verified against it. */
  blockText: z.string(),
  verified: z.boolean(),
  rejection: z.string().nullable(),
});
export type MeaningCandidate = z.infer<typeof MeaningCandidate>;

export const HitVerdict = z.enum(["VERIFIED", "INTERMITTENT", "SUGGESTED_QUOTE_VERIFIED"]);
export type HitVerdict = z.infer<typeof HitVerdict>;

export const SearchHit = z.strictObject({
  id: z.string(),
  key: z.string(),
  source: z.enum(["exact", "meaning"]),
  ...Located,
  term: z.string().nullable(),
  via: MatchVia,
  matchedText: z.string(),
  stem: z.string().nullable(),
  quote: z.string(),
  contextBefore: z.string(),
  contextAfter: z.string(),
  match: Span,
  /** Runs where it was found. */
  occurrences: z.array(z.int().positive()),
  verdict: HitVerdict,
  reason: z.string().nullable(),
  relevance: Relevance.nullable(),
  textFragmentUrl: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const ExclusionCount = z.strictObject({
  term: z.string(),
  scope: z.enum(["block", "page"]),
  /** Distinct blocks that contain the term (counted once, whatever the number of loads). */
  blocks: z.int().nonnegative(),
  pages: z.int().nonnegative(),
  /** Distinct hits that would otherwise have been reported. */
  hits: z.int().nonnegative(),
});
export type ExclusionCount = z.infer<typeof ExclusionCount>;

export const SearchAiUsage = z.strictObject({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  /** Estimated before any call (upper bound). */
  estimateUsd: z.number().nonnegative(),
  maxCostUsd: z.number().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  costUsd: z.number().nonnegative(),
  latencyMs: z.int().nonnegative(),
  calls: z.int().nonnegative(),
  /** Pages whose text was sent to the model. */
  pagesSent: z.array(z.string()),
  /** Blocks the redaction changed before sending. */
  redactions: z.int().nonnegative(),
  /** Blocks repeated on several pages (header, footer…) sent only once, with their first page. */
  repeatedBlocks: z.int().nonnegative().default(0),
  /** Why the model part did not run or stopped (cost limit, no credentials…). English, for logs and older readers. */
  error: z.string().nullable(),
  /** The same, as a code and parameters (docs/11-i18n.md). Absent in older reports. */
  errorMessage: EngineMessage.optional(),
});
export type SearchAiUsage = z.infer<typeof SearchAiUsage>;

export const SearchStatus = z.enum([...InspectionStatus.options, "COST_LIMIT", "AI_ERROR"]);
export type SearchStatus = z.infer<typeof SearchStatus>;

export const SearchCoverage = z.strictObject({
  /** Distinct same-origin pages found (visited or not). */
  found: z.int().nonnegative(),
  /** Pages whose text was searched (first run). */
  searched: z.int().nonnegative(),
  skippedBudget: z.int().nonnegative(),
  skippedRobots: z.int().nonnegative(),
  skippedSafety: z.int().nonnegative(),
  blocked: z.array(z.strictObject({ url: z.string(), kind: z.string() })),
  failed: z.int().nonnegative(),
});
export type SearchCoverage = z.infer<typeof SearchCoverage>;

export const SearchSummary = z.strictObject({
  hits: z.int().nonnegative(),
  verified: z.int().nonnegative(),
  intermittent: z.int().nonnegative(),
  suggested: z.int().nonnegative(),
  hidden: z.int().nonnegative(),
  byVariant: z.int().nonnegative(),
  pagesWithHits: z.int().nonnegative(),
  discardedQuotes: z.int().nonnegative(),
});
export type SearchSummary = z.infer<typeof SearchSummary>;

const SearchReportBody = z.strictObject({
    schemaVersion: z.literal("exegezis.search-report/v1"),
    id: z.string(),
    target: z.strictObject({ url: z.string(), origin: z.string() }),
    startedAt: z.string(),
    finishedAt: z.string(),
    exegezisVersion: z.string(),
    query: SearchQuery,
    /** The saved search this run belongs to, if any. */
    savedSearchId: z.string().nullable(),
    options: z.strictObject({
      maxPages: z.int().positive(),
      maxDepth: z.int().nonnegative(),
      runs: z.int().positive(),
      strictReadonly: z.boolean(),
      ignoreRobots: z.boolean(),
      includeHidden: z.boolean(),
    }),
    tools: z.strictObject({
      userAgent: z.string(),
      playwright: z.string(),
      stemmer: z.string().nullable(),
      browser: z.strictObject({ channel: z.string(), version: z.string(), system: z.boolean() }).nullable(),
    }),
    robots: z.strictObject({ respected: z.boolean(), fetched: z.boolean(), disallow: z.array(z.string()) }),
    access: z.strictObject({ session: z.boolean(), httpCredentials: z.boolean(), wafToken: z.boolean() }),
    totalTimeoutReached: z.boolean(),
    engineError: EngineErrorInfo.nullable(),
    status: SearchStatus,
    pages: z.array(PageVisit),
    skippedForSafety: z.array(z.strictObject({ url: z.string(), from: z.string(), reason: z.string() })),
    /** Page languages seen (html lang), for the stemmer. */
    languages: z.record(z.string(), z.string().nullable()),
    observations: z.array(SearchObservation),
    candidates: z.array(MeaningCandidate),
    excluded: z.array(ExclusionCount),
    ai: SearchAiUsage.nullable(),
    hits: z.array(SearchHit),
    coverage: SearchCoverage,
    summary: SearchSummary,
  });
type SearchReportData = z.output<typeof SearchReportBody>;

export const SearchReport = SearchReportBody.superRefine((r, ctx) => {
  for (const issue of searchReportIssues(r)) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
});
export type SearchReport = z.output<typeof SearchReport>;
export type SearchReportInput = z.input<typeof SearchReport>;

// ---------------------------------------------------------------------------
// Deterministic rules
// ---------------------------------------------------------------------------

export function hitId(key: string): string {
  return `H-${sha256(key).slice(0, 12)}`;
}

/** The observation's key recomputed from what it says (a tampered quote or term changes it). */
export function observationKey(o: Pick<SearchObservation, "page" | "term" | "via" | "quote">): string {
  return searchKey(o.page, `${o.via}:${o.term}`, o.quote);
}

/** Meaning candidates with the quote re-checked against the block text; the page's own words become the quote. */
function meaningHit(c: MeaningCandidate): SearchHit | null {
  const check = verifyQuote(c.quote, c.blockText);
  if (!check.verified) return null;
  const q = quoteAround(c.blockText, check.start, check.end);
  const exact = c.blockText.slice(check.start, check.end).replace(/\s+/g, " ").trim();
  const key = searchKey(c.page, "meaning", exact);
  return {
    id: hitId(key),
    key,
    source: "meaning",
    page: c.page,
    runPath: c.runPath,
    blockId: c.blockId,
    blockKind: c.blockKind,
    visible: c.visible,
    selector: c.selector,
    rect: c.rect,
    term: null,
    via: "meaning",
    matchedText: exact,
    stem: null,
    quote: q.quote,
    contextBefore: q.contextBefore,
    contextAfter: q.contextAfter,
    match: q.match,
    occurrences: [1],
    verdict: "SUGGESTED_QUOTE_VERIFIED",
    reason: c.reason,
    relevance: c.relevance,
    textFragmentUrl: textFragmentUrl(c.page, exact),
  };
}

const VERDICT_ORDER: Record<HitVerdict, number> = { VERIFIED: 0, SUGGESTED_QUOTE_VERIFIED: 1, INTERMITTENT: 2 };

/**
 * Hits from the raw results: an exact hit is VERIFIED when its key appears in
 * every run, INTERMITTENT otherwise; a meaning hit exists only when its quote
 * is literally in the block that was sent.
 */
export function deriveSearchHits(observations: readonly SearchObservation[], candidates: readonly MeaningCandidate[], runs: number): SearchHit[] {
  const byKey = new Map<string, SearchObservation[]>();
  for (const o of observations) byKey.set(o.key, [...(byKey.get(o.key) ?? []), o]);
  const hits: SearchHit[] = [];
  for (const [key, list] of byKey) {
    const first = [...list].sort((a, b) => a.run - b.run)[0] as SearchObservation;
    const occurrences = [...new Set(list.map((o) => o.run))].sort((a, b) => a - b);
    hits.push({
      id: hitId(key),
      key,
      source: "exact",
      page: first.page,
      runPath: first.runPath,
      blockId: first.blockId,
      blockKind: first.blockKind,
      visible: first.visible,
      selector: first.selector,
      rect: first.rect,
      term: first.term,
      via: first.via,
      matchedText: first.matchedText,
      stem: first.stem,
      quote: first.quote,
      contextBefore: first.contextBefore,
      contextAfter: first.contextAfter,
      match: first.match,
      occurrences,
      verdict: occurrences.length >= runs ? "VERIFIED" : "INTERMITTENT",
      reason: null,
      relevance: null,
      textFragmentUrl: textFragmentUrl(first.page, first.matchedText.length >= 3 ? first.quote.slice(first.match.start, first.match.end) : first.quote),
    });
  }
  const seen = new Set(hits.map((h) => h.key));
  for (const c of candidates) {
    const hit = meaningHit(c);
    if (hit === null || seen.has(hit.key)) continue;
    seen.add(hit.key);
    hits.push(hit);
  }
  return hits.sort((a, b) => a.page.localeCompare(b.page) || VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.key.localeCompare(b.key));
}

export function deriveSearchSummary(hits: readonly SearchHit[], candidates: readonly MeaningCandidate[]): SearchSummary {
  return {
    hits: hits.length,
    verified: hits.filter((h) => h.verdict === "VERIFIED").length,
    intermittent: hits.filter((h) => h.verdict === "INTERMITTENT").length,
    suggested: hits.filter((h) => h.verdict === "SUGGESTED_QUOTE_VERIFIED").length,
    hidden: hits.filter((h) => !h.visible).length,
    byVariant: hits.filter((h) => h.via === "variant").length,
    pagesWithHits: new Set(hits.map((h) => h.page)).size,
    discardedQuotes: candidates.filter((c) => !verifyQuote(c.quote, c.blockText).verified).length,
  };
}

export function deriveSearchCoverage(pages: readonly PageVisit[], skippedForSafety: readonly { url: string }[]): SearchCoverage {
  const first = pages.filter((p) => p.run === 1);
  const urls = new Set([...first.map((p) => p.url), ...skippedForSafety.map((s) => s.url)]);
  return {
    found: urls.size,
    searched: first.filter((p) => INSPECTABLE.includes(p.status)).length,
    skippedBudget: first.filter((p) => p.status === "SKIPPED_BUDGET").length,
    skippedRobots: first.filter((p) => p.status === "SKIPPED_ROBOTS").length,
    skippedSafety: skippedForSafety.length,
    blocked: first.filter((p) => p.block !== null).map((p) => ({ url: p.url, kind: p.block?.kind ?? "" })),
    failed: first.filter((p) => (p.status === "UNREACHABLE" || p.status === "TIMEOUT") && p.block === null).length,
  };
}

/** COST_LIMIT / AI_ERROR only when the site itself could be searched. */
export function deriveSearchStatus(r: { pages: readonly PageVisit[]; totalTimeoutReached: boolean; engineError: unknown; ai: SearchAiUsage | null }): SearchStatus {
  const base = deriveInspectionStatus(r.pages, r.totalTimeoutReached, r.engineError !== null);
  if (base !== "COMPLETED" && base !== "PARTIAL") return base;
  if (r.ai?.error !== null && r.ai?.error !== undefined) return r.ai.error.startsWith("cost limit") ? "COST_LIMIT" : "AI_ERROR";
  return base;
}

export function searchReportIssues(r: SearchReportData): { message: string; path: (string | number)[] }[] {
  const issues: { message: string; path: (string | number)[] }[] = [];
  r.observations.forEach((o, i) => {
    if (o.key !== observationKey(o)) issues.push({ message: "the observation key does not follow from its page, term and quote", path: ["observations", i, "key"] });
    const matched = o.quote.slice(o.match.start, o.match.end);
    if (o.via !== "regex" && o.via !== "detector" && normalizeSearch(matched) !== normalizeSearch(o.matchedText)) {
      issues.push({ message: "the highlighted text is not the matched text", path: ["observations", i, "match"] });
    }
  });
  r.candidates.forEach((c, i) => {
    const check = verifyQuote(c.quote, c.blockText);
    if (check.verified !== c.verified) issues.push({ message: "a candidate's verified flag does not match a literal check of its quote", path: ["candidates", i, "verified"] });
  });
  if (canonicalJson(r.hits) !== canonicalJson(deriveSearchHits(r.observations, r.candidates, r.options.runs))) {
    issues.push({ message: "the hits (verdicts, occurrences, quotes) must follow from the observations and the verified quotes", path: ["hits"] });
  }
  if (canonicalJson(r.summary) !== canonicalJson(deriveSearchSummary(r.hits, r.candidates))) issues.push({ message: "the summary must follow from the hits", path: ["summary"] });
  if (canonicalJson(r.coverage) !== canonicalJson(deriveSearchCoverage(r.pages, r.skippedForSafety))) issues.push({ message: "the coverage must follow from the page visits", path: ["coverage"] });
  if (r.status !== deriveSearchStatus(r)) issues.push({ message: "the status must follow from the page visits and the model part", path: ["status"] });
  return issues;
}

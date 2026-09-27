import { deriveSearchCoverage, deriveSearchHits, deriveSearchStatus, deriveSearchSummary, observationKey, type PageVisit, type SearchObservation, type SearchReportInput } from "@exegezis/core";

const page: PageVisit = { url: "https://a.test/", depth: 0, run: 1, status: "OK", finalUrl: "https://a.test/", httpStatus: 200, settled: true, reason: null, runPath: "pages/run-1/x", blockedWrites: 0, block: null };

function observation(quote: string, term: string): SearchObservation {
  const at = quote.toLowerCase().indexOf(term);
  const base = {
    run: 1,
    page: page.url,
    runPath: page.runPath,
    blockId: "b1",
    blockKind: "paragraph" as const,
    visible: true,
    selector: "p",
    rect: null,
    term,
    via: "exact" as const,
    matchedText: quote.slice(at, at + term.length),
    stem: null,
    quote,
    contextBefore: "",
    contextAfter: "",
    match: { start: at, end: at + term.length },
  };
  return { ...base, key: observationKey(base) };
}

/** A small valid search report (one run), for review, export and comparison tests. */
export function sampleReport(options: { onlyFirst?: boolean } = {}): SearchReportInput {
  const observations = [observation("El médico, dijo \"hola\", visita los martes.", "médico"), ...(options.onlyFirst === true ? [] : [observation("Medicinas en recepción.", "medicinas")])];
  const hits = deriveSearchHits(observations, [], 1);
  const pages = [page];
  return {
    schemaVersion: "exegezis.search-report/v1",
    id: options.onlyFirst === true ? "S0" : "S1",
    target: { url: page.url, origin: "https://a.test" },
    startedAt: "2026-09-27T00:00:00.000Z",
    finishedAt: "2026-09-27T00:01:00.000Z",
    exegezisVersion: "0.1.0",
    query: { kind: "exact", terms: ["médico", "medicinas"], phrases: [], excluded: [], excludeScope: "block", variants: false, regex: null, detectors: [], suggested: [] },
    savedSearchId: null,
    options: { maxPages: 10, maxDepth: 1, runs: 1, strictReadonly: false, ignoreRobots: false, includeHidden: true },
    tools: { userAgent: "x", playwright: "1.63.0", stemmer: null, browser: null },
    robots: { respected: true, fetched: false, disallow: [] },
    access: { session: false, httpCredentials: false, wafToken: false },
    totalTimeoutReached: false,
    engineError: null,
    status: deriveSearchStatus({ pages, totalTimeoutReached: false, engineError: null, ai: null }),
    pages,
    skippedForSafety: [],
    languages: { [page.url]: "es" },
    observations,
    candidates: [],
    excluded: [],
    ai: null,
    hits,
    coverage: deriveSearchCoverage(pages, []),
    summary: deriveSearchSummary(hits, []),
  };
}

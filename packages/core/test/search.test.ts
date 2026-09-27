import { describe, expect, it } from "vitest";
import {
  deriveSearchCoverage,
  deriveSearchHits,
  deriveSearchStatus,
  deriveSearchSummary,
  findWhole,
  normalizeSearch,
  normalizeSearchText,
  observationKey,
  originalSpan,
  quoteAround,
  SearchReport,
  textFragmentUrl,
  verifyQuote,
  type MeaningCandidate,
  type PageVisit,
  type SearchObservation,
  type SearchReportInput,
} from "../src/index.js";

describe("search normalization", () => {
  it("folds accents and capitals, keeps ñ, unifies quotes and spaces", () => {
    expect(normalizeSearch("  MÉDICO  y  Medicina ")).toBe("medico y medicina");
    expect(normalizeSearch("Año")).toBe("año");
    expect(normalizeSearch("año")).not.toBe(normalizeSearch("ano"));
    // A decomposed ñ (n + U+0303) is still ñ.
    expect(normalizeSearch("año")).toBe("año");
    expect(normalizeSearch("«Curación» “total” ‘ya’")).toBe('"curacion" "total" \'ya\'');
    expect(normalizeSearch("pin­güino azul")).toBe("pinguino azul");
  });

  it("maps normalized positions back to the page's own words", () => {
    const original = "El  MÉDICO dijo";
    const n = normalizeSearchText(original);
    const at = n.text.indexOf("medico");
    const span = originalSpan(original, n, at, at + "medico".length);
    expect(original.slice(span.start, span.end)).toBe("MÉDICO");
  });

  it("matches whole words only", () => {
    expect(findWhole("la cura y la curacion", "cura")).toEqual([3]);
    expect(findWhole("curar", "cura")).toEqual([]);
    expect(findWhole("medicina natural", "medicina natural")).toEqual([0]);
  });

  it("quotes the sentence around a match, with context", () => {
    const text = "Primera frase. Aquí se habla de medicina tradicional. Tercera frase.";
    const at = text.indexOf("medicina");
    const q = quoteAround(text, at, at + "medicina".length);
    expect(q.quote).toBe("Aquí se habla de medicina tradicional.");
    expect(q.quote.slice(q.match.start, q.match.end)).toBe("medicina");
    expect(q.contextBefore).toBe("Primera frase. ");
    expect(q.contextAfter).toBe(" Tercera frase.");
  });

  it("builds a text-fragment link to the quote", () => {
    expect(textFragmentUrl("https://a.test/p#top", "curar-te, ya")).toBe("https://a.test/p#:~:text=curar%2Dte%2C%20ya");
    expect(textFragmentUrl("https://a.test/p", "uno dos tres cuatro cinco seis siete ocho nueve diez once")).toBe(
      "https://a.test/p#:~:text=uno%20dos%20tres%20cuatro%20cinco,siete%20ocho%20nueve%20diez%20once",
    );
  });
});

describe("quote verification", () => {
  const block = "Nuestro ministerio ora por los enfermos. La oración no sustituye al médico.";
  it("accepts a literal quote regardless of accents, capitals and ellipses", () => {
    expect(verifyQuote("la oracion no sustituye al MEDICO", block).verified).toBe(true);
    expect(verifyQuote("…ora por los enfermos…", block).verified).toBe(true);
  });
  it("rejects an invented quote, a deformed one and a trivially short one", () => {
    expect(verifyQuote("Dios cura el cáncer sin medicinas", block)).toMatchObject({ verified: false, rejection: "the quote is not in the text of that block" });
    expect(verifyQuote("La oración sustituye al médico", block).verified).toBe(false);
    expect(verifyQuote("médico", block)).toMatchObject({ verified: false, rejection: "the quote is too short to prove anything" });
  });
});

const page = (url: string, status: PageVisit["status"], run = 1, depth = 0): PageVisit => ({
  url,
  depth,
  run,
  status,
  finalUrl: url,
  httpStatus: status === "OK" ? 200 : null,
  settled: true,
  reason: null,
  runPath: `pages/run-${run}/x`,
  blockedWrites: 0,
  block: null,
});

function observation(run: number, quoteText: string, term: string): SearchObservation {
  const at = quoteText.toLowerCase().indexOf(term);
  const base = {
    run,
    page: "https://a.test/",
    runPath: `pages/run-${run}/x`,
    blockId: "b1",
    blockKind: "paragraph" as const,
    visible: true,
    selector: "p",
    rect: null,
    term,
    via: "exact" as const,
    matchedText: quoteText.slice(at, at + term.length),
    stem: null,
    quote: quoteText,
    contextBefore: "",
    contextAfter: "",
    match: { start: at, end: at + term.length },
  };
  return { ...base, key: observationKey(base) };
}

function report(): SearchReportInput {
  const pages = [page("https://a.test/", "OK", 1), page("https://a.test/", "OK", 2)];
  const observations = [observation(1, "La medicina es clave.", "medicina"), observation(2, "La medicina es clave.", "medicina"), observation(1, "Carrusel: medicina hoy.", "medicina")];
  const candidates: MeaningCandidate[] = [
    { page: "https://a.test/", runPath: null, blockId: "b2", blockKind: "paragraph", visible: true, selector: "p", rect: null, quote: "visitar al doctor cada año", reason: "habla de ir al médico", relevance: "high", blockText: "Recomendamos visitar al doctor cada año.", verified: true, rejection: null },
    { page: "https://a.test/", runPath: null, blockId: "b2", blockKind: "paragraph", visible: true, selector: "p", rect: null, quote: "los doctores curan todo", reason: "inventada", relevance: "high", blockText: "Recomendamos visitar al doctor cada año.", verified: false, rejection: "the quote is not in the text of that block" },
  ];
  const hits = deriveSearchHits(observations, candidates, 2);
  const ai = null;
  return {
    schemaVersion: "exegezis.search-report/v1",
    id: "S1",
    target: { url: "https://a.test/", origin: "https://a.test" },
    startedAt: "2026-09-27T00:00:00.000Z",
    finishedAt: "2026-09-27T00:01:00.000Z",
    exegezisVersion: "0.0.0",
    query: { kind: "exact", terms: ["medicina"], phrases: [], excluded: [], excludeScope: "block", variants: false, regex: null, detectors: [], suggested: [] },
    savedSearchId: null,
    options: { maxPages: 10, maxDepth: 1, runs: 2, strictReadonly: false, ignoreRobots: false, includeHidden: true },
    tools: { userAgent: "x", playwright: "1", stemmer: null, browser: null },
    robots: { respected: true, fetched: false, disallow: [] },
    access: { session: false, httpCredentials: false, wafToken: false },
    totalTimeoutReached: false,
    engineError: null,
    status: deriveSearchStatus({ pages, totalTimeoutReached: false, engineError: null, ai }),
    pages,
    skippedForSafety: [],
    languages: { "https://a.test/": "es" },
    observations,
    candidates,
    excluded: [],
    ai,
    hits,
    coverage: deriveSearchCoverage(pages, []),
    summary: deriveSearchSummary(hits, candidates),
  };
}

describe("search report", () => {
  it("derives VERIFIED (all runs), INTERMITTENT (some) and suggested hits; invented quotes are discarded and counted", () => {
    const r = SearchReport.parse(report());
    expect(r.hits.map((h) => h.verdict).sort()).toEqual(["INTERMITTENT", "SUGGESTED_QUOTE_VERIFIED", "VERIFIED"]);
    expect(r.summary).toMatchObject({ hits: 3, verified: 1, intermittent: 1, suggested: 1, discardedQuotes: 1 });
    // The page's own words are shown, not the model's.
    expect(r.hits.find((h) => h.source === "meaning")?.quote).toBe("Recomendamos visitar al doctor cada año.");
    expect(r.coverage).toMatchObject({ found: 1, searched: 1 });
  });

  it("does not load when a verdict, a quote or a flag was tampered with", () => {
    const upgraded = report();
    const hits = upgraded.hits as { verdict: string }[];
    hits.forEach((h) => (h.verdict = "VERIFIED"));
    expect(SearchReport.safeParse(upgraded).success).toBe(false);

    const quote = report();
    (quote.observations as SearchObservation[])[0]!.quote = "La medicina lo cura todo.";
    expect(SearchReport.safeParse(quote).success).toBe(false);

    const invented = report();
    (invented.candidates as MeaningCandidate[])[1]!.verified = true;
    expect(SearchReport.safeParse(invented).success).toBe(false);

    const coverage = report();
    (coverage.coverage as { found: number }).found = 50;
    expect(SearchReport.safeParse(coverage).success).toBe(false);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSearchCoverage, deriveSearchHits, deriveSearchStatus, deriveSearchSummary, observationKey, SearchReport, type PageVisit, type SearchObservation } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as exportGet } from "../src/app/api/searches/[id]/export/route";
import { discover } from "../src/lib/evidence/discover";
import { filterHits, groupHits, parseHitFilters } from "../src/lib/evidence/searches";
import { commandFor, JobRecord } from "../src/lib/jobs";
import { parseSearchForm, type SearchFormFields } from "../src/lib/search-options";

const form = (patch: Partial<SearchFormFields>): SearchFormFields => ({
  url: "https://a.test/",
  mode: "exact",
  terms: "medicina",
  meaning: "",
  template: "",
  withMeaning: false,
  variants: false,
  excludeScope: "",
  suggested: "",
  runs: "",
  maxPages: "",
  maxDepth: "",
  includeHidden: true,
  noSession: false,
  ignoreRobots: false,
  browserChannel: "auto",
  save: "",
  ...patch,
});

describe("the search form", () => {
  it("accepts an exact search and refuses what cannot run", () => {
    const ok = parseSearchForm(form({ terms: 'medicina, "tratamiento médico", -anuncio', excludeScope: "page", maxPages: "10" }));
    expect(ok).toMatchObject({ ok: true, input: { mode: "exact", excludeScope: "page", maxPages: 10, meaning: null } });
    expect(parseSearchForm(form({ url: "ftp://x" }))).toMatchObject({ ok: false });
    expect(parseSearchForm(form({ terms: " " }))).toMatchObject({ ok: false });
    expect(parseSearchForm(form({ terms: "-anuncio" }))).toMatchObject({ ok: false, error: { key: "common.errors.onlyExclusions" } });
    expect(parseSearchForm(form({ maxPages: "0" }))).toMatchObject({ ok: false });
    expect(parseSearchForm(form({ suggested: "not json" }))).toMatchObject({ ok: false });
  });

  it("a meaning search needs a description; accepted suggestions travel with an exact one", () => {
    expect(parseSearchForm(form({ mode: "meaning", meaning: "" }))).toMatchObject({ ok: false });
    expect(parseSearchForm(form({ mode: "meaning", meaning: "medicina, directa o indirecta" }))).toMatchObject({ ok: true, input: { mode: "meaning", terms: null } });
    const s = parseSearchForm(form({ terms: "curar", suggested: JSON.stringify([{ term: "curación", from: "curar", relation: "misma familia" }]) }));
    expect(s.ok && s.input.suggested.map((x) => x.term)).toEqual(["curación"]);
  });

  it("the job runs the CLI with one argument per value (no shell)", () => {
    const job = JobRecord.parse({
      schemaVersion: "exegezis.web-job/v1",
      kind: "search",
      id: "01JZ0000000000000000000000",
      status: "queued",
      pid: null,
      startedAt: "2026-09-27T00:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      error: null,
      url: "https://a.test/",
      mode: "exact",
      terms: 'medicina, "x; rm -rf"',
      meaning: null,
      template: null,
      withMeaning: false,
      variants: true,
      excludeScope: "page",
      suggested: [],
      runs: null,
      maxPages: 10,
      maxDepth: 1,
      includeHidden: false,
      noSession: true,
      ignoreRobots: false,
      browserChannel: "auto",
      maxCostUsd: null,
      saved: null,
      save: "Salud",
      reuse: null,
    });
    const args = commandFor(job);
    // The language of the person who started it goes first (older jobs: English).
    expect(args.slice(0, 7)).toEqual(["--lang", "en", "search", "--url", "https://a.test/", "--terms", 'medicina, "x; rm -rf"']);
    expect(args).toEqual(expect.arrayContaining(["--variants", "--exclude-scope", "page", "--no-hidden", "--no-session", "--save", "Salud", "--max-pages", "10"]));
  });
});

const page = (url: string): PageVisit => ({ url, depth: 0, run: 1, status: "OK", finalUrl: url, httpStatus: 200, settled: true, reason: null, runPath: null, blockedWrites: 0, block: null, device: "desktop", metrics: null });

function obs(url: string, quote: string, term: string): SearchObservation {
  const at = quote.toLowerCase().indexOf(term);
  const base = { run: 1, page: url, runPath: null, blockId: "b1", blockKind: "paragraph" as const, visible: true, selector: "p", rect: null, term, via: "exact" as const, matchedText: quote.slice(at, at + term.length), stem: null, quote, contextBefore: "", contextAfter: "", match: { start: at, end: at + term.length } };
  return { ...base, key: observationKey(base) };
}

function report(id: string) {
  const pages = [page("https://a.test/"), page("https://a.test/b")];
  const observations = [obs("https://a.test/", "El médico viene.", "médico"), obs("https://a.test/b", "La medicina natural.", "medicina"), obs("https://a.test/b", "Otro médico.", "médico")];
  const hits = deriveSearchHits(observations, [], 1);
  return SearchReport.parse({
    schemaVersion: "exegezis.search-report/v1",
    id,
    target: { url: "https://a.test/", origin: "https://a.test" },
    startedAt: "2026-09-27T00:00:00.000Z",
    finishedAt: "2026-09-27T00:01:00.000Z",
    exegezisVersion: "0.1.0",
    query: { kind: "exact", terms: ["médico", "medicina"], phrases: [], excluded: [], excludeScope: "block", variants: false, regex: null, detectors: [], suggested: [] },
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
    languages: {},
    observations,
    candidates: [],
    excluded: [],
    ai: null,
    hits,
    coverage: deriveSearchCoverage(pages, []),
    summary: deriveSearchSummary(hits, []),
  });
}

describe("hits in the detail view", () => {
  const r = report("S1");
  const empty = { schemaVersion: "exegezis.search-review/v1" as const, marks: {}, updatedAt: null };

  it("filters by text and review mark, and groups by page or by term", () => {
    expect(filterHits(r.hits, parseHitFilters({ q: "MEDICO" }), empty, null)).toHaveLength(2);
    const relevant = { ...empty, marks: { [r.hits[0]!.id]: "relevant" as const } };
    expect(filterHits(r.hits, parseHitFilters({ revision: "relevante" }), relevant, null)).toHaveLength(1);
    expect(filterHits(r.hits, parseHitFilters({ revision: "pendiente" }), relevant, null)).toHaveLength(2);
    expect(groupHits(r.hits, "page").map((g) => [g.key, g.hits.length])).toEqual([
      ["https://a.test/b", 2],
      ["https://a.test/", 1],
    ]);
    expect(groupHits(r.hits, "term").map((g) => [g.key, g.hits.length])).toEqual([
      ["médico", 2],
      ["medicina", 1],
    ]);
  });
});

describe("discovery and export", () => {
  let runs: string;
  const previous = process.env.EXEGEZIS_RUNS_DIR;
  beforeAll(async () => {
    runs = await mkdtemp(join(tmpdir(), "exegezis-web-search-"));
    process.env.EXEGEZIS_RUNS_DIR = runs;
    const good = join(runs, "searches", "01JZ0000000000000000000001");
    const bad = join(runs, "searches", "01JZ0000000000000000000002");
    await mkdir(good, { recursive: true });
    await mkdir(bad, { recursive: true });
    await writeFile(join(good, "search-report.json"), JSON.stringify(report("01JZ0000000000000000000001")));
    const tampered = JSON.parse(JSON.stringify(report("01JZ0000000000000000000002"))) as { hits: { quote: string }[] };
    tampered.hits[0]!.quote = "Un médico lo cura todo.";
    await writeFile(join(bad, "search-report.json"), JSON.stringify(tampered));
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.EXEGEZIS_RUNS_DIR;
    else process.env.EXEGEZIS_RUNS_DIR = previous;
    await rm(runs, { recursive: true, force: true });
  });

  it("finds searches on disk and never shows a tampered report", async () => {
    const index = await discover();
    const byId = new Map(index.searches.map((s) => [s.id, s.report.status]));
    expect(byId.get("01JZ0000000000000000000001")).toBe("ok");
    expect(byId.get("01JZ0000000000000000000002")).toBe("invalid");
  });

  it("exports a CSV that Excel opens (BOM, «;», accents)", async () => {
    const res = await exportGet(new Request("http://127.0.0.1/api/searches/01JZ0000000000000000000001/export?format=csv"), { params: Promise.resolve({ id: "01JZ0000000000000000000001" }) });
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const bytes = Buffer.from(await res.arrayBuffer());
    // The UTF-8 BOM that tells Excel the encoding (Response.text() would hide it).
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    expect(text.split("\r\n")[0]).toMatch(/^.Página;Tipo;Término;Cita/);
    expect(text).toContain("médico");
    const missing = await exportGet(new Request("http://127.0.0.1/x"), { params: Promise.resolve({ id: "01JZ0000000000000000000002" }) });
    expect(missing.status).toBe(404);
  });
});

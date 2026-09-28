import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchHit, SearchReport } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exactQueryFrom, findTemplate, loadSearchReport, MockSearchClient, SEARCH_REPORT_FILE, searchSite, templateQuery, type SearchModelClient, type SearchSiteOptions } from "../src/index.js";

/**
 * Searches end to end against inspect-lab /search/* in real Chromium
 * (docs/10-search.md §7): accents, capitals, plurals, hidden text, attributes,
 * a changing carousel and a control page with near misses only.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LAB = join(REPO, "examples/inspect-lab");
const WORK = join(REPO, "packages/search/test/.tmp-search");

let lab: ChildProcess;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

let counter = 0;
async function search(options: Partial<SearchSiteOptions> & Pick<SearchSiteOptions, "query">): Promise<{ report: SearchReport; dir: string }> {
  counter += 1;
  const dir = join(WORK, `search-${counter}`);
  const report = await searchSite({ url: `${base}search/`, dir, id: `S${counter}`, exegezisVersion: "0.1.0", runs: 1, maxPages: 10, maxDepth: 1, delayMs: 0, ...options });
  return { report, dir };
}

const at = (r: SearchReport, path: string) => r.hits.filter((h) => h.page === `${base}search/${path}`);
const words = (hits: SearchHit[]) => hits.map((h) => h.matchedText).sort();

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const port = await freePort();
  base = `http://127.0.0.1:${port}/`;
  lab = spawn(process.execPath, ["src/server.ts"], { cwd: LAB, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}__lab/health`)).ok) break;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error("inspect-lab did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
});

afterAll(() => {
  lab.kill();
  rmSync(WORK, { recursive: true, force: true });
});

describe("exact search on the fixture (3 loads)", () => {
  let report: SearchReport;
  let dir: string;
  beforeAll(async () => {
    await fetch(`${base}__lab/search-reset`);
    ({ report, dir } = await search({ runs: 3, query: exactQueryFrom({ terms: "medicina, médico, enfermedad, tratamiento, curar, curación, año" }) }));
  });

  it("covers every page it found, and says so", () => {
    expect(report.status).toBe("COMPLETED");
    expect(report.coverage).toMatchObject({ found: 5, searched: 5, skippedBudget: 0, skippedRobots: 0, blocked: [] });
  });

  it("finds accented and capitalized words, a word split by inline markup and «año»; never a plural without variants", () => {
    const salud = at(report, "salud");
    expect(words(salud.filter((h) => h.visible))).toEqual(["año", "curación", "medicina", "médico", "MÉDICO", "tratamiento"].sort());
    expect(salud.every((h) => h.verdict === "VERIFIED" && h.occurrences.length === 3)).toBe(true);
    // «enfermedades» and «Medicinas» are variants: not found with variants off.
    expect(salud.some((h) => /enfermedades|medicinas/i.test(h.matchedText))).toBe(false);
  });

  it("finds hidden text (closed accordion, display:none, aria-hidden) and marks it not visible", () => {
    const hidden = at(report, "salud").filter((h) => !h.visible);
    expect(words(hidden)).toEqual(["curar", "enfermedad", "médico", "Tratamiento"].sort());
  });

  it("finds the words that are only in attributes and metadata, with their kind", () => {
    const kinds = at(report, "atributos").map((h) => `${h.blockKind}:${h.matchedText}`).sort();
    expect(kinds).toEqual(["alt:médico", "aria-label:tratamiento", "meta-description:medicina", "og:Curar", "title-attr:Enfermedad"].sort());
  });

  it("reports the changing carousel slide as INTERMITTENT, apart from the verified hits", () => {
    const slide = at(report, "carrusel");
    expect(slide.map((h) => [h.matchedText, h.verdict, h.occurrences.length])).toEqual([["medicina", "INTERMITTENT", 1]]);
  });

  it("has 0 hits on the control page (near misses: medicinales, medio, «ano», curandero, enfermería…)", () => {
    expect(at(report, "control")).toEqual([]);
  });

  it("gives each hit a quote in the page's own words and a link to the phrase", () => {
    const h = at(report, "salud").find((x) => x.matchedText === "MÉDICO")!;
    expect(h.quote).toBe("El MÉDICO de la comunidad visita los martes.");
    expect(h.quote.slice(h.match.start, h.match.end)).toBe("MÉDICO");
    expect(h.textFragmentUrl).toBe(`${base}search/salud#:~:text=M%C3%89DICO`);
    expect(h.selector).toMatch(/p/);
    expect(h.rect).not.toBeNull();
  });

  it("re-derives on load; a tampered report does not load", async () => {
    expect((await loadSearchReport(dir)).summary).toEqual(report.summary);
    const path = join(dir, SEARCH_REPORT_FILE);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { hits: { verdict: string }[] };
    for (const h of raw.hits) h.verdict = "VERIFIED";
    writeFileSync(path, JSON.stringify(raw));
    await expect(loadSearchReport(dir)).rejects.toThrow(/hits/);
  });
});

describe("exclusion and variants", () => {
  it("-anuncio leaves out only its block by default, and counts what it hid", async () => {
    const { report } = await search({ query: exactQueryFrom({ terms: "medicina, médico, -anuncio" }) });
    expect(at(report, "salud").some((h) => /Anuncio/.test(h.quote))).toBe(false);
    expect(at(report, "salud").some((h) => h.matchedText === "MÉDICO")).toBe(true);
    expect(report.excluded).toEqual([{ term: "anuncio", scope: "block", blocks: 1, pages: 1, hits: 1 }]);
  });

  it("«excluir página entera» leaves out the whole page, and says so", async () => {
    const { report } = await search({ query: exactQueryFrom({ terms: "medicina, médico, -anuncio", excludeScope: "page" }) });
    expect(at(report, "salud")).toEqual([]);
    expect(report.excluded[0]).toMatchObject({ term: "anuncio", scope: "page", pages: 1 });
    expect(report.excluded[0]?.hits).toBeGreaterThanOrEqual(3);
  });

  it("variants find plurals, each saying through which stem", async () => {
    const { report } = await search({ query: exactQueryFrom({ terms: "enfermedad, medicina", variants: true }) });
    const variant = at(report, "salud").filter((h) => h.via === "variant");
    expect(Object.fromEntries(variant.map((h) => [h.matchedText, h.stem]))).toEqual({ enfermedades: "enferm", Medicinas: "medicin" });
    expect(report.tools.stemmer).toMatch(/snowball-stemmers@0\.6\.0/);
  });
});

/** A model that must never be called. */
const noModel: SearchModelClient = {
  provider: "forbidden",
  model: "claude-sonnet-5",
  count: () => Promise.reject(new Error("the model was called")),
  complete: () => Promise.reject(new Error("the model was called")),
};

describe("search by meaning (mock model) and templates", () => {
  const respond = (_system: string, user: string) => {
    const saludUrl = `${base}search/salud`;
    const block = /\[(b\d+)\] \(paragraph\) No abandones tu tratamiento/.exec(user)?.[1] ?? "b0";
    return JSON.stringify({
      findings: [
        { page: saludUrl, blockId: block, quote: "No abandones tu tratamiento médico sin consultarlo", reason: "habla de un tratamiento médico", relevance: "high" },
        { page: saludUrl, blockId: block, quote: "La fe cura cualquier enfermedad sin médicos", reason: "cita inventada", relevance: "high" },
        { page: saludUrl, blockId: block, quote: "No abandones nunca tu tratamiento médico", reason: "cita deformada", relevance: "medium" },
      ],
    });
  };

  it("shows verified quotes as suggestions, discards the invented and the deformed one and counts them", async () => {
    const client = new MockSearchClient(respond);
    const { report } = await search({ query: { kind: "meaning", description: "cualquier mención a la medicina" }, model: { client, maxCostUsd: 1 } });
    expect(report.hits.map((h) => [h.verdict, h.matchedText])).toEqual([["SUGGESTED_QUOTE_VERIFIED", "No abandones tu tratamiento médico sin consultarlo"]]);
    expect(report.summary.discardedQuotes).toBe(2);
    expect(report.ai).toMatchObject({ provider: "mock", model: "claude-sonnet-5", calls: 1, error: null, promptVersion: "search-meaning-v3" });
    expect(report.ai?.estimateUsd).toBeGreaterThan(0);
    expect(report.ai?.pagesSent).toHaveLength(5);
  });

  it("stops before the model when the estimate is over the limit; approving reuses the pages without visiting the site again", async () => {
    const client = new MockSearchClient(respond);
    const first = await search({ query: { kind: "meaning", description: "medicina" }, model: { client, maxCostUsd: 0.001 } });
    expect(first.report.status).toBe("COST_LIMIT");
    expect(client.calls).toBe(0);
    const approved = Math.ceil((first.report.ai?.estimateUsd ?? 0) * 100) / 100;
    counter += 1;
    const dir = join(WORK, `search-${counter}`);
    const second = await searchSite({ url: `${base}search/`, dir, id: `S${counter}`, exegezisVersion: "0.1.0", query: first.report.query, model: { client, maxCostUsd: approved }, reuse: { dir: first.dir, report: first.report } });
    expect(second.status).toBe("COMPLETED");
    expect(client.calls).toBe(1);
    expect(second.pages).toEqual(first.report.pages);
    expect(second.hits).toHaveLength(1);
  });

  it("a deterministic template never calls a model", async () => {
    const template = (await findTemplate("texto-relleno"))!;
    const { report } = await search({ query: templateQuery(template, { withMeaning: true }), model: { client: noModel, maxCostUsd: 1 } });
    expect(report.ai).toBeNull();
    expect(report.status).toBe("COMPLETED");
  });

  it("the health template runs its exact part without a model when asked", async () => {
    const template = (await findTemplate("salud-afirmaciones"))!;
    const { report } = await search({ query: templateQuery(template, { withMeaning: false }), model: { client: noModel, maxCostUsd: 1 } });
    expect(report.ai).toBeNull();
    expect(words(at(report, "salud").filter((h) => h.visible))).toEqual(expect.arrayContaining(["MÉDICO", "enfermedades", "Medicinas"]));
    // The control page only has «Tratamientos», which is literally one of the template's terms.
    expect(words(at(report, "control"))).toEqual(["Tratamientos"]);
  });
});

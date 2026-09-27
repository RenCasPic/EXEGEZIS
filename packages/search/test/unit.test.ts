import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSearchHits, SearchReport, type TextBlock } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareSearches,
  compileExact,
  costUsd,
  deleteSavedSearch,
  detect,
  estimateSuggestCost,
  exactQueryFrom,
  excludedBy,
  listSavedSearches,
  listTemplates,
  matchBlock,
  MockSearchClient,
  parseTermsInput,
  readReview,
  readSearchSettings,
  runMeaning,
  saveSearch,
  saveUserTemplate,
  setReviewMark,
  stemOf,
  suggestTerms,
  templateQuery,
  toCsv,
  writeSearchSettings,
  type MeaningPage,
} from "../src/index.js";

const block = (text: string, extra: Partial<TextBlock> = {}): TextBlock => ({ id: "b1", kind: "paragraph", level: null, text, selector: "p", rect: null, visible: true, source: null, ...extra });
const NOW = new Date("2026-09-27T12:00:00Z");

describe("the terms box", () => {
  it("splits items by commas, keeps quoted phrases whole and reads -exclusions", () => {
    expect(parseTermsInput('medicina, "tratamiento médico, urgente", -anuncio, -"medicina natural",  médico ')).toEqual({
      terms: ["medicina", "médico"],
      phrases: ["tratamiento médico, urgente"],
      excluded: ["anuncio", "medicina natural"],
    });
    expect(() => exactQueryFrom({ terms: " , -solo" })).toThrow(/Nothing to search for/);
  });
});

describe("exact matching", () => {
  const q = compileExact(exactQueryFrom({ terms: 'medicina, médico, curación, año, "tratamiento médico"' }));
  const terms = (text: string) => matchBlock(block(text), q, "es", NOW).map((m) => `${m.term}:${text.slice(m.start, m.end)}`);

  it("ignores accents and capitals, matches whole words only and keeps ñ apart from n", () => {
    expect(terms("El MÉDICO receta MEDICINA.")).toEqual(["médico:MÉDICO", "medicina:MEDICINA"]);
    expect(terms("Plantas medicinales y medios.")).toEqual([]);
    expect(terms("Feliz año")).toEqual(["año:año"]);
    expect(terms("el ano")).toEqual([]);
    // The phrase and the single term both match (two hits, each with its own term).
    expect(terms("Sigue tu tratamiento  Médico.")).toEqual(['"tratamiento médico":tratamiento  Médico', "médico:Médico"]);
  });

  it("finds variants only when asked, and says through which stem", () => {
    const plain = compileExact(exactQueryFrom({ terms: "enfermedad, curar" }));
    const withVariants = compileExact(exactQueryFrom({ terms: "enfermedad, curar", variants: true }));
    const text = "Las enfermedades se curan; la curación tarda.";
    expect(matchBlock(block(text), plain, "es", NOW)).toEqual([]);
    const found = matchBlock(block(text), withVariants, "es", NOW);
    expect(found.map((m) => [text.slice(m.start, m.end), m.via, m.stem])).toEqual([
      ["enfermedades", "variant", "enferm"],
      ["curan", "variant", "cur"],
    ]);
    // Documented limit: the stem does not join derivations (curar / curación)…
    expect(stemOf("curación", "es")).not.toBe(stemOf("curar", "es"));
    // …and can join unrelated words (casa / caso): variants are off by default.
    expect(stemOf("casa", "es")).toBe(stemOf("caso", "es"));
  });

  it("excludes blocks that contain an excluded word", () => {
    const ex = compileExact(exactQueryFrom({ terms: "medicina, -anuncio" }));
    expect(excludedBy(block("Anuncio: medicina natural."), ex)).toBe("anuncio");
    expect(excludedBy(block("La medicina de hoy."), ex)).toBeNull();
  });

  it("runs a regular expression with a time limit: a catastrophic pattern does not hang", () => {
    const re = compileExact(exactQueryFrom({ regex: "(a+)+$" }));
    const t0 = Date.now();
    matchBlock(block(`${"a".repeat(40)}b`), re, "es", NOW);
    expect(Date.now() - t0).toBeLessThan(2000);
    const ok = compileExact(exactQueryFrom({ regex: "cita\\s+\\d+" }));
    expect(matchBlock(block("Pide cita 12 hoy"), ok, "es", NOW).map((m) => m.via)).toEqual(["regex"]);
    expect(() => compileExact(exactQueryFrom({ regex: "(" }))).toThrow(/not valid/);
  });
});

describe("detectors (templates without a model)", () => {
  it("finds e-mails, phone numbers and past dates", () => {
    expect(detect("email", "Escríbenos a info@ejemplo.org o ven.", NOW).map((d) => d.text)).toEqual(["info@ejemplo.org"]);
    expect(detect("phone", "Llama al +34 612 345 678 o al 2024-05-01.", NOW).map((d) => d.text)).toEqual(["+34 612 345 678"]);
    expect(detect("past-date", "Retiro el 12 de marzo de 2024; congreso el 01/10/2026; 2026-09-26 y March 3, 2027.", NOW).map((d) => d.text)).toEqual(["12 de marzo de 2024", "2026-09-26"]);
  });
});

describe("costs", () => {
  it("prices tokens with the table and refuses a model without a price", () => {
    expect(costUsd("claude-sonnet-5", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(() => costUsd("gpt-x", 1, 1)).toThrow(/no price/);
    expect(estimateSuggestCost("claude-sonnet-5", ["curar"])).toBeGreaterThan(0);
  });
});

const PAGES: MeaningPage[] = [
  {
    page: "https://a.test/",
    runPath: "pages/run-1/x",
    lang: "es",
    blocks: [
      { id: "b1", kind: "paragraph", level: null, text: "Oramos por los enfermos y recomendamos ir siempre al doctor.", selector: "p", rect: null, visible: true, source: null },
      { id: "b2", kind: "paragraph", level: null, text: "Escríbenos a pastor@iglesia.test para pedir oración.", selector: "p", rect: null, visible: true, source: null },
    ],
  },
];

function answer(findings: { page: string; blockId: string; quote: string; reason: string; relevance: "high" | "medium" | "low" }[]): string {
  return JSON.stringify({ findings });
}

describe("search by meaning (mock model)", () => {
  it("keeps verified quotes, discards an invented one and a deformed one, and counts them", async () => {
    const client = new MockSearchClient(() =>
      answer([
        { page: "https://a.test/", blockId: "b1", quote: "recomendamos ir siempre al doctor", reason: "habla de ir al médico", relevance: "high" },
        { page: "https://a.test/", blockId: "b1", quote: "la oración cura el cáncer sin medicinas", reason: "inventada", relevance: "high" },
        { page: "https://a.test/", blockId: "b1", quote: "recomendamos no ir nunca al doctor", reason: "deformada", relevance: "high" },
        { page: "https://a.test/", blockId: "b9", quote: "Oramos por los enfermos y recomendamos", reason: "otro bloque", relevance: "low" },
      ]),
    );
    const r = await runMeaning({ client, description: "menciones a la medicina", pages: PAGES, maxCostUsd: 1 });
    expect(r.candidates.map((c) => c.verified)).toEqual([true, false, false, false]);
    expect(r.usage).toMatchObject({ calls: 1, error: null, model: "claude-sonnet-5" });
    expect(r.usage.estimateUsd).toBeGreaterThan(0);
    const hits = deriveSearchHits([], r.candidates, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ verdict: "SUGGESTED_QUOTE_VERIFIED", matchedText: "recomendamos ir siempre al doctor" });
  });

  it("redacts personal data before sending, and verifies against what was sent", async () => {
    let sent = "";
    const client = new MockSearchClient((_s, user) => {
      sent = user;
      return answer([]);
    });
    const r = await runMeaning({ client, description: "contacto", pages: PAGES, maxCostUsd: 1 });
    expect(sent).not.toContain("pastor@iglesia.test");
    expect(r.usage.redactions).toBe(1);
  });

  it("an answer cut at the output limit is not lost: the batch is split in two and asked again", async () => {
    const users: string[] = [];
    const client = {
      provider: "test",
      model: "claude-sonnet-5",
      count: () => Promise.resolve(null),
      complete: (_s: string, user: string) => {
        users.push(user);
        // The first (whole) request is cut; the halves answer normally.
        if (users.length === 1) return Promise.resolve({ text: '{"findings":[{"page":"https://a.test/","blockId":"b1","quo', inputTokens: 100, outputTokens: 8000, stopReason: "max_tokens" as const });
        const found = user.includes("[b1]") ? [{ page: "https://a.test/", blockId: "b1", quote: "recomendamos ir siempre al doctor", reason: "médico", relevance: "high" }] : [];
        return Promise.resolve({ text: JSON.stringify({ findings: found }), inputTokens: 50, outputTokens: 50, stopReason: "end" as const });
      },
    };
    const r = await runMeaning({ client, description: "medicina", pages: PAGES, maxCostUsd: 1 });
    expect(users).toHaveLength(3);
    expect(users[1]).toContain("[b1]");
    expect(users[1]).not.toContain("[b2]");
    expect(r.usage.error).toBeNull();
    expect(r.candidates.filter((c) => c.verified)).toHaveLength(1);
  });

  it("a block repeated on several pages (header, footer) is sent once", async () => {
    let sent = "";
    const client = new MockSearchClient((_s, user) => {
      sent = user;
      return answer([]);
    });
    const footer = { id: "b9", kind: "text" as const, level: null, text: "La oración no sustituye la atención médica.", selector: "footer", rect: null, visible: true, source: null };
    const pages: MeaningPage[] = [
      { page: "https://a.test/", runPath: null, lang: "es", blocks: [footer] },
      { page: "https://a.test/b", runPath: null, lang: "es", blocks: [{ ...footer, id: "b3" }] },
    ];
    const r = await runMeaning({ client, description: "medicina", pages, maxCostUsd: 1 });
    expect(sent.match(/no sustituye/g)).toHaveLength(1);
    expect(r.usage.repeatedBlocks).toBe(1);
  });

  it("shows the estimate and respects the limit: nothing is sent above it", async () => {
    const client = new MockSearchClient(() => answer([]));
    const r = await runMeaning({ client, description: "medicina", pages: PAGES, maxCostUsd: 0.001 });
    expect(client.calls).toBe(0);
    expect(r.usage.error).toMatch(/^cost limit: the estimate is \d+\.\d\d USD and the limit is 0\.00 USD/);
    expect(r.usage.estimateUsd).toBeGreaterThan(0.001);
  });

  it("suggests related terms; the search stays exact", async () => {
    const client = new MockSearchClient(() =>
      JSON.stringify({ suggestions: [{ term: "curación", from: "curar", relation: "misma familia" }, { term: "curar", from: "curar", relation: "igual" }, { term: "una frase demasiado larga aquí", from: "curar", relation: "x" }] }),
    );
    const r = await suggestTerms(client, ["curar"], 1);
    expect(r.suggestions.map((s) => s.term)).toEqual(["curación"]);
    const q = exactQueryFrom({ terms: "curar", suggested: r.suggestions });
    expect(q.suggested.map((s) => s.term)).toEqual(["curación"]);
    expect(matchBlock(block("La curación llega."), compileExact(q), "es", NOW).map((m) => m.via)).toEqual(["exact"]);
    await expect(suggestTerms(client, ["curar"], 0.00001)).rejects.toThrow(/cost limit/);
  });
});

describe("templates, settings, saved searches and review", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "exegezis-search-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads the repository templates, including health claims, and the person's own", async () => {
    const repo = await listTemplates(dir);
    expect(repo.map((t) => t.id)).toEqual(expect.arrayContaining(["salud-afirmaciones", "datos-personales", "fechas-pasadas", "texto-relleno", "contacto-redes"]));
    const salud = repo.find((t) => t.id === "salud-afirmaciones")!;
    expect(templateQuery(salud, { withMeaning: false }).meaning).toBeNull();
    expect(templateQuery(salud, { withMeaning: true }).meaning?.description).toMatch(/salud/);
    await saveUserTemplate({ id: "mis-horarios", version: 1, name: "Horarios", description: "", exact: { terms: ["horario", "misa"] } }, dir);
    expect((await listTemplates(dir)).find((t) => t.id === "mis-horarios")?.origin).toBe("user");
    await expect(saveUserTemplate({ id: "salud-afirmaciones", version: 1, name: "x", description: "", exact: { terms: ["x"] } }, dir)).rejects.toThrow(/repository template/);
  });

  it("keeps the cost limit and model in settings (1 USD by default)", async () => {
    expect(await readSearchSettings(dir)).toEqual({ maxCostUsd: 1, model: "claude-sonnet-5" });
    expect(await writeSearchSettings({ maxCostUsd: 2.5 }, dir)).toEqual({ maxCostUsd: 2.5, model: "claude-sonnet-5" });
    await expect(writeSearchSettings({ model: "no-such-model" }, dir)).rejects.toThrow();
  });

  it("saves searches outside runs/ and deletes them", async () => {
    const s = await saveSearch({ name: "Salud", url: "https://a.test/", query: exactQueryFrom({ terms: "medicina" }), options: { maxPages: 10, maxDepth: 1, runs: 3, includeHidden: true, noSession: false } }, dir);
    expect((await listSavedSearches(dir)).map((x) => x.id)).toEqual([s.id]);
    expect(await deleteSavedSearch(s.id, dir)).toBe(true);
    expect(await listSavedSearches(dir)).toEqual([]);
  });

  it("marks hits Relevante / No relevante / Pendiente without touching the report, and exports a CSV Excel opens", async () => {
    const report = SearchReport.parse(await import("./fixtures.js").then((m) => m.sampleReport()));
    const hit = report.hits[0]!;
    await setReviewMark(dir, report, hit.id, "relevant");
    const review = await readReview(dir);
    expect(review.marks[hit.id]).toBe("relevant");
    await expect(setReviewMark(dir, report, "H-000000000000", "relevant")).rejects.toThrow(/no hit/);
    const csv = toCsv(report, review, ";");
    expect(csv.startsWith("\uFEFFPágina;Tipo;Término;Cita")).toBe(true);
    expect(csv).toContain("Relevante");
    expect(csv).toContain("médico");
    expect(csv.includes("\r\n")).toBe(true);
    // A field with the separator or quotes is quoted.
    expect(toCsv(report, review, ",")).toMatch(/"[^"]*,[^"]*"/);
  });

  it("compares with the previous run: new, same and gone", async () => {
    const { sampleReport } = await import("./fixtures.js");
    const current = SearchReport.parse(sampleReport());
    const previous = SearchReport.parse(sampleReport({ onlyFirst: true }));
    const c = compareSearches(current, previous);
    expect([...c.novelty.values()].sort()).toEqual(["new", "same"]);
    expect(compareSearches(previous, current).gone).toHaveLength(1);
  });
});

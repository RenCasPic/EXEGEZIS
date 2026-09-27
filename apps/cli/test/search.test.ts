import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { SearchReport } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";
import { main } from "../src/main.js";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html lang="es"><head><title>Inicio</title></head><body><h1>Bienvenidos</h1><p>El médico atiende los martes.</p><a href="/otra">Otra</a></body></html>`,
  "/otra": `<!doctype html><html lang="es"><head><title>Otra</title></head><body><p>Oramos por las enfermedades. Tratamiento gratuito.</p></body></html>`,
};

let server: Server;
let base: string;
let workDir: string;
const previousSearchDir = process.env.EXEGEZIS_SEARCH_DIR;

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? "/"];
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    res.end(body ?? "no");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  workDir = await mkdtemp(join(tmpdir(), "exegezis-cli-search-"));
  process.env.EXEGEZIS_SEARCH_DIR = join(workDir, "search-data");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
  if (previousSearchDir === undefined) delete process.env.EXEGEZIS_SEARCH_DIR;
  else process.env.EXEGEZIS_SEARCH_DIR = previousSearchDir;
});

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  const stderr = new PassThrough();
  let stderrText = "";
  stderr.on("data", (chunk: Buffer) => (stderrText += chunk.toString("utf8")));
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr, cwd: workDir });
  return { code, stdout, stderr: stderrText };
}

const searches = (output: string) => (existsSync(join(workDir, output, "searches")) ? readdirSync(join(workDir, output, "searches")).sort() : []);

describe("exegezis search: arguments", () => {
  it("parses a run, its sub-actions, and refuses mixed or missing modes", () => {
    expect(parseCliArgs(["search", "--url", "https://a.test", "--terms", "a, b", "--variants", "--exclude-scope", "page", "--max-pages", "10"])).toMatchObject({
      kind: "search",
      action: "run",
      url: "https://a.test/",
      terms: "a, b",
      variants: true,
      excludeScope: "page",
      maxPages: 10,
      includeHidden: true,
    });
    expect(parseCliArgs(["search", "suggest", "--terms", "curar", "--json"])).toMatchObject({ action: "suggest", json: true });
    expect(parseCliArgs(["search", "export", "--search", "X", "--format", "csv", "--sep", ","])).toMatchObject({ action: "export", separator: "," });
    expect(() => parseCliArgs(["search", "--url", "https://a.test"])).toThrow(/Say what to search/);
    expect(() => parseCliArgs(["search", "--url", "https://a.test", "--terms", "a", "--meaning", "b"])).toThrow(/cannot be combined/);
    expect(() => parseCliArgs(["search", "--url", "https://a.test", "--terms", "a", "--max-cost", "-1"])).toThrow(/max-cost/);
    expect(() => parseCliArgs(["search", "templates", "--url", "https://a.test"])).toThrow(/not valid for "search templates"/);
  });
});

describe("exegezis search: runs", () => {
  it("runs an exact search, says what it covered, and exports a CSV Excel opens", async () => {
    const { code, stdout } = await cli(["search", "--url", base, "--terms", "médico, enfermedad, tratamiento", "--runs", "2", "--max-pages", "5", "--no-session", "--output", "runs-exact", "--delay", "0"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Coverage: searched 2 of 2 pages found");
    expect(stdout).toMatch(/Hits: {4}2 on 2 pages · VERIFIED 2/);
    const [id] = searches("runs-exact");
    const report = SearchReport.parse(JSON.parse(readFileSync(join(workDir, "runs-exact", "searches", id!, "search-report.json"), "utf8")));
    expect(report.hits.map((h) => h.matchedText).sort()).toEqual(["médico", "Tratamiento"].sort());

    const exported = await cli(["search", "export", "--search", id!, "--format", "csv", "--output", "runs-exact"]);
    expect(exported.code).toBe(0);
    const csv = readFileSync(join(workDir, "runs-exact", "searches", id!, "export.csv"), "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("médico");
  });

  it("saves a search and, run again, says what is new", async () => {
    const first = await cli(["search", "--url", base, "--terms", "médico", "--runs", "1", "--no-session", "--save", "Médicos", "--output", "runs-saved", "--delay", "0"]);
    expect(first.code).toBe(0);
    const savedId = /Saved search: (\S+)/.exec(first.stdout)?.[1];
    expect(savedId).toBeDefined();
    const again = await cli(["search", "--saved", savedId!, "--output", "runs-saved", "--delay", "0"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/Since \S+: 0 new · 0 no longer found/);
  });

  it("by meaning: estimates, stays under the limit (exit 8 above it), and discards quotes that are not in the page", async () => {
    const answer = join(workDir, "answer.json");
    await writeFile(
      answer,
      JSON.stringify({
        findings: [
          { page: `${base}otra`, blockId: "b1", quote: "Oramos por las enfermedades", reason: "enfermedad", relevance: "high" },
          { page: `${base}otra`, blockId: "b1", quote: "Curamos todas las enfermedades", reason: "inventada", relevance: "high" },
        ],
      }),
    );
    const limited = await cli(["search", "--url", base, "--meaning", "menciones a la medicina", "--mock-response", answer, "--max-cost", "0.001", "--no-session", "--output", "runs-meaning", "--delay", "0"]);
    expect(limited.code).toBe(8);
    expect(limited.stdout).toMatch(/Model part: cost limit: the estimate is/);
    const [limitedId] = searches("runs-meaning");

    const approved = await cli(["search", "--url", base, "--meaning", "menciones a la medicina", "--mock-response", answer, "--max-cost", "1", "--reuse", limitedId!, "--output", "runs-meaning"]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain("reusing the pages of");
    expect(approved.stdout).toMatch(/suggested \(quote verified\) 1/);
    expect(approved.stdout).toContain("Discarded: 1 model quote(s)");
  });

  it("suggests related terms (recorded answer) and lists templates", async () => {
    const answer = join(workDir, "suggest.json");
    await writeFile(answer, JSON.stringify({ suggestions: [{ term: "curación", from: "curar", relation: "misma familia" }] }));
    const r = await cli(["search", "suggest", "--terms", "curar", "--mock-response", answer, "--json"]);
    expect(r.code).toBe(0);
    expect((JSON.parse(r.stdout) as { suggestions: { term: string }[] }).suggestions.map((s) => s.term)).toEqual(["curación"]);
    const t = await cli(["search", "templates"]);
    expect(t.stdout).toContain("salud-afirmaciones");
  });
});

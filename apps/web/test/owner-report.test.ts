import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerReportHtml } from "../src/lib/owner-report";
import { buildAreasReport } from "./inspection-fixture";

/** The owner's report (lib/owner-report.ts): what it says, in both languages. */

let dir: string;
const report = buildAreasReport();
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "exegezis-owner-"));
  // The screenshot of the menu's accessibility problem, as an inspection keeps it.
  await mkdir(join(dir, "pages/run-1/P0/screenshots"), { recursive: true });
  await writeFile(join(dir, "pages/run-1/P0/screenshots/axe-highlight.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  const f = report.findings.find((x) => x.checkId === "a11y" && x.page === "https://shop.example/");
  if (f !== undefined) f.evidence = [{ kind: "screenshot", path: "pages/run-1/P0/screenshots/axe-highlight.png", description: "Violating elements outlined" }];
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the owner's report", () => {
  it("in Spanish: a plain summary, the problems by Frontend and Backend with their severity, evidence, N of N and how to fix them, and the passive-review note", async () => {
    const html = await ownerReportHtml({ report, dir, id: report.id, locale: "es" });
    const t = text(html);
    expect(html).toMatch(/^<!doctype html>\s*<html lang="es">/);
    expect(t).toContain("Informe de revisión del sitio web");
    expect(t).toContain("Revisamos 2 páginas públicas de https://shop.example/ en escritorio y móvil, 3 veces cada una");
    expect(t).toContain("Encontramos 6 problemas confirmados");
    expect(t).toContain("Frontend: lo que ven y usan los visitantes");
    expect(t).toContain("Backend: el servidor, visto desde fuera");
    expect(t).toContain("Sin Content-Security-Policy");
    expect(t).toContain("Añade una Content-Security-Policy");
    expect(t).toContain("3 de 3 repeticiones");
    expect(t).toContain("en todas las páginas revisadas");
    expect(t).toContain("Haz que las direcciones que no existen respondan con el código 404");
    expect(t).toContain("Fue una revisión pasiva");
    expect(t).toContain("Solo se visitaron páginas públicas");
    expect(t).toContain("Rendimiento (medidas de laboratorio)");
    // The evidence: the screenshot inside the document, with its text alternative.
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="Captura de \/ con el problema">/);
    // Self-contained and inert: no script, nothing fetched.
    expect(html).not.toMatch(/<script|src="http|href="http/i);
  });

  it("in English, with the same content", async () => {
    const t = text(await ownerReportHtml({ report, dir, id: report.id, locale: "en" }));
    expect(t).toContain("Website review report");
    expect(t).toContain("We found 6 confirmed problems");
    expect(t).toContain("No Content-Security-Policy");
    expect(t).toContain("3 of 3 runs");
    expect(t).toContain("It was a passive review");
    expect(t).not.toMatch(/Revisamos|repeticiones|Cómo arreglarlo/);
  });

  it("lists only VERIFIED problems: what was seen in only some runs stays out", async () => {
    const intermittent = structuredClone(report);
    const g = intermittent.groups.find((x) => x.checkId === "security-headers");
    expect(g).toBeDefined();
    for (const f of intermittent.findings) if (f.checkId === "security-headers") f.verdict = "INTERMITTENT";
    if (g !== undefined) {
      g.verified = 0;
      g.verdict = "INTERMITTENT";
    }
    const t = text(await ownerReportHtml({ report: intermittent, dir, id: report.id, locale: "en" }));
    expect(t).not.toContain("No Content-Security-Policy");
    expect(t).toContain("We found 5 confirmed problems");
  });
});

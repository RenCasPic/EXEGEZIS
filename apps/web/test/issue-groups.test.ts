import { deriveIssueGroups, type IssueGroup } from "@exegezis/core";
import { describe, expect, it } from "vitest";
import { filterGroups, parseFindingFilters } from "../src/lib/evidence/inspections";
import { createTranslator } from "next-intl";
import { CATALOGS } from "../src/i18n/messages";
import { colorName, findingTitle, groupTitle, type InspectionsT } from "../src/lib/issue-labels";
import { buildReport } from "./inspection-fixture";

describe("plain-language group titles", () => {
  const es = createTranslator({ locale: "es", messages: CATALOGS.es as never, namespace: "inspections" as never }) as unknown as InspectionsT;
  const en = createTranslator({ locale: "en", messages: CATALOGS.en as never, namespace: "inspections" as never }) as unknown as InspectionsT;

  it("names colours roughly and always keeps the hex", () => {
    expect(colorName(es, "#ffffff")).toBe("blanco");
    expect(colorName(es, "#000000")).toBe("negro");
    expect(colorName(es, "#9ca3af")).toMatch(/^gris/);
    expect(colorName(es, "#1b3157")).toBe("azul oscuro");
    expect(colorName(en, "#1b3157")).toBe("dark blue");
    const g = { contrast: { foreground: "#9ca3af", background: "#ffffff", ratio: 2.54, required: 4.5, textSize: "normal", suggestion: null }, checkId: "a11y", title: "" } as unknown as IssueGroup;
    expect(groupTitle(es, "es", g)).toMatch(/^Texto gris.*#9CA3AF sobre blanco #FFFFFF: contraste 2,54:1, mínimo 4,5:1$/);
    expect(groupTitle(en, "en", g)).toMatch(/^Text .*gray #9CA3AF on white #FFFFFF: contrast 2.54:1, minimum 4.5:1$/);
  });

  it("small touch targets: what, where and the size, in plain words", () => {
    const tap = (tapTarget: object) => ({ checkId: "mobile-tap-targets", title: "", contrast: null, tapTarget }) as unknown as IssueGroup;
    const menu = tap({ kind: "link", place: "menu", width: 18, height: 18, padding: { x: 3, y: 3 } });
    expect(groupTitle(es, "es", menu)).toBe("Enlaces del menú de 18×18 px: el mínimo es 24×24 px");
    expect(groupTitle(en, "en", menu)).toBe("Menu links of 18×18 px: the minimum is 24×24 px");
    const footer = tap({ kind: "link", place: "footer", width: null, height: 18, padding: { x: 0, y: 3 } });
    expect(groupTitle(es, "es", footer)).toBe("Enlaces del pie de página de 18 px de alto: el mínimo es 24×24 px");
    expect(groupTitle(en, "en", footer)).toBe("Footer links 18 px tall: the minimum is 24×24 px");
    expect(groupTitle(es, "es", tap({ kind: "button", place: "page", width: 20, height: null, padding: { x: 2, y: 0 } }))).toBe("Botones de 20 px de ancho: el mínimo es 24×24 px");
  });

  it("rewords the engine's English titles; the page's own text and axe rule ids stay as recorded", () => {
    expect(findingTitle(es, "es", "console-errors", "Console error: Failed to load")).toBe("Error de consola: Failed to load");
    expect(findingTitle(en, "en", "console-errors", "Console error: Failed to load")).toBe("Console error: Failed to load");
    expect(findingTitle(es, "es", "a11y", "Elements must meet minimum color contrast ratio thresholds (color-contrast): .btn")).toBe(
      "Los elementos deben tener un contraste de colores suficiente (color-contrast): .btn",
    );
    expect(findingTitle(es, "es", "seo-basics", "The page has 3 h1 elements")).toBe("La página tiene 3 elementos h1");
    expect(findingTitle(es, "es", "failed-requests", "GET /x → 500")).toBe("GET /x → 500");
  });
});

describe("groups in the UI", () => {
  const report = buildReport();

  it("a v1 report (the fixture) loads with derived groups", () => {
    expect(report.schemaVersion).toBe("exegezis.inspection-report/v1");
    expect(report.groups).toEqual(deriveIssueGroups(report.findings));
    expect(report.groups.map((g) => g.verdict).sort()).toEqual(["INTERMITTENT", "VERIFIED"]);
  });

  it("filters apply to groups", () => {
    const all = report.groups;
    expect(filterGroups(all, report.findings, parseFindingFilters({ q: "flaky" }))).toHaveLength(1);
    expect(filterGroups(all, report.findings, parseFindingFilters({ severity: "minor" }))).toHaveLength(0);
    expect(filterGroups(all, report.findings, parseFindingFilters({ page: "http://127.0.0.1:4300/" }))).toHaveLength(2);
  });
});

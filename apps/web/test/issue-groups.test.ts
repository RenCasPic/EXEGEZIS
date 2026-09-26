import { deriveIssueGroups, type IssueGroup } from "@exegezis/core";
import { describe, expect, it } from "vitest";
import { filterGroups, parseFindingFilters } from "../src/lib/evidence/inspections";
import { colorName, groupTitleEs } from "../src/lib/issue-labels";
import { buildReport } from "./inspection-fixture";

describe("plain-language group titles", () => {
  it("names colours roughly and always keeps the hex", () => {
    expect(colorName("#ffffff")).toBe("blanco");
    expect(colorName("#000000")).toBe("negro");
    expect(colorName("#9ca3af")).toMatch(/^gris/);
    expect(colorName("#1b3157")).toBe("azul oscuro");
    const g = { contrast: { foreground: "#9ca3af", background: "#ffffff", ratio: 2.54, required: 4.5, textSize: "normal", suggestion: null }, checkId: "a11y", title: "" } as unknown as IssueGroup;
    expect(groupTitleEs(g)).toMatch(/^Texto gris.*#9CA3AF sobre blanco #FFFFFF: contraste 2,54:1, mínimo 4,5:1$/);
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

import { describe, expect, it } from "vitest";
import {
  buildFindings,
  contrastRatio,
  deriveFindings,
  deriveIssueGroups,
  deriveSummary,
  InspectionReport,
  normalizeSelector,
  parseHex,
  suggestForeground,
  type CheckResult,
  type InspectionObservation,
  type PageVisit,
  type Rgb,
} from "../src/index.js";

const SITE = "http://fixture.test/";
const page = (p: string) => `${SITE}${p}`;

function contrastObs(selector: string, fg: string, bg: string, ratio: number, required = 4.5): InspectionObservation {
  return {
    fingerprint: `a11y:color-contrast ${selector}`,
    title: `Elements must meet minimum color contrast ratio thresholds (color-contrast): ${selector}`,
    detail: `Fix any of the following:\n  Element has insufficient color contrast of ${ratio} (foreground color: ${fg}, background color: ${bg}, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of ${required}:1`,
    severity: "serious",
    thirdParty: false,
    evidence: [],
    assertion: { kind: "a11y", rule: "color-contrast", selector, expected: "no_violation" },
  };
}

function consoleObs(normalized: string): InspectionObservation {
  return { fingerprint: `console-errors:${normalized}`, title: `Console error: ${normalized}`, detail: "", severity: "moderate", thirdParty: false, evidence: [], assertion: null };
}

/** A report with `runs` runs over `pages`; `observe(page, run)` says what each check saw. */
function report(pages: string[], runs: number, observe: (p: string, run: number) => InspectionObservation[]) {
  const visits: PageVisit[] = pages.flatMap((p, i) =>
    Array.from({ length: runs }, (_, r) => ({ url: page(p), depth: i === 0 ? 0 : 1, run: r + 1, status: "OK" as const, finalUrl: page(p), httpStatus: 200, settled: true, reason: null, runPath: `pages/run-${r + 1}/${i}`, blockedWrites: 0, block: null })),
  );
  const checks: CheckResult[] = visits.map((v) => ({ checkId: "a11y", checkVersion: "1.0.0", page: v.url, run: v.run, status: "ran", error: null, observations: observe(v.url.slice(SITE.length), v.run) }));
  const options = { maxPages: 20, maxDepth: 2, runs, pageTimeoutMs: 30000, totalTimeoutMs: 600000, delayMs: 0, checks: ["a11y"], strictReadonly: false, ignoreRobots: false, storageState: false };
  const { groups } = deriveFindings(checks, visits, runs, false);
  const findings = buildFindings(groups, () => ({ checkVersion: "1.0.0", reproduction: [], spec: null, settled: true }));
  return {
    schemaVersion: "exegezis.inspection-report/v2" as const,
    id: "x",
    target: { url: SITE, origin: "http://fixture.test" },
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: "2026-09-26T00:00:01.000Z",
    exegezisVersion: "0.1.0",
    options,
    tools: { userAgent: "EXEGEZIS-Inspector/0.1.0", playwright: "1.63.0", axe: "4.13.0", axeRules: ["color-contrast"], checks: [{ id: "a11y", version: "1.0.0" }], browser: null },
    robots: { respected: true, fetched: false, disallow: [] },
    totalTimeoutReached: false,
    engineError: null,
    status: "COMPLETED" as const,
    pages: visits,
    externalLinks: [],
    pageWrites: [],
    checks,
    findings,
    summary: deriveSummary(findings, visits, [], checks, options),
    groups: deriveIssueGroups(findings),
  };
}

describe("contrast arithmetic and the suggested colour", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#767676") as Rgb, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it("always suggests a colour that meets the required ratio (4.5:1 normal, 3:1 large), on a grid of pairs", () => {
    const shades = ["#000000", "#1b3157", "#6b7a99", "#9ca3af", "#c4862a", "#ff0000", "#00ff00", "#0000ff", "#fbf7f0", "#ffffff", "#0b1729", "#808080"];
    let checked = 0;
    for (const fg of shades)
      for (const bg of shades)
        for (const required of [4.5, 3]) {
          if (fg === bg) continue;
          const s = suggestForeground(fg, bg, required);
          expect(s, `${fg} on ${bg}`).not.toBeNull();
          expect(contrastRatio(parseHex((s as { color: string }).color) as Rgb, parseHex(bg) as Rgb)).toBeGreaterThanOrEqual(required);
          checked++;
        }
    expect(checked).toBeGreaterThan(200);
  });

  it("only moves the lightness, the smallest step first", () => {
    const s = suggestForeground("#9ca3af", "#ffffff", 4.5) as { color: string; ratio: number };
    const ratio = contrastRatio(parseHex(s.color) as Rgb, [255, 255, 255]);
    // Meets the minimum, but only just: the nearest passing lightness, not an arbitrary dark grey.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.7);
    // Grey stays grey (same hue and saturation: r, g, b keep their order), only darker.
    const [r, g, b] = parseHex(s.color) as Rgb;
    expect(r < g && g < b).toBe(true);
    expect(r).toBeLessThan(0x9c);
    expect(suggestForeground("#000000", "#ffffff", 4.5)).toEqual({ color: "#000000", ratio: 21 });
  });
});

describe("issue groups", () => {
  it("one low-contrast component repeated on 3 pages is 1 group with 3 pages", () => {
    const r = report(["", "a", "b"], 3, () => [contrastObs(".card:nth-child(2) > p", "#9ca3af", "#ffffff", 2.54)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ verdict: "VERIFIED", elements: 3, pages: [page(""), page("a"), page("b")], contrast: { foreground: "#9ca3af", background: "#ffffff", ratio: 2.54, required: 4.5, textSize: "normal" } });
    expect(r.groups[0]?.contrast?.suggestion?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("two colour pairs are 2 groups; the same pair on different elements is 1", () => {
    const r = report(["", "a"], 3, () => [contrastObs(".x", "#9ca3af", "#ffffff", 2.54), contrastObs(".y", "#9ca3af", "#ffffff", 2.54), contrastObs(".z", "#c4862a", "#ffffff", 3.09)]);
    expect(r.groups.map((g) => [g.contrast?.foreground, g.elements])).toEqual([
      ["#9ca3af", 4],
      ["#c4862a", 2],
    ]);
  });

  it("a console error with different numbers on each load is 1 group (the check normalizes the message)", () => {
    const r = report(["", "a"], 3, () => [consoleObs("Request <n> failed after <n> ms")]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.elements).toBe(2);
  });

  it("a group with an intermittent element is MIXED, never VERIFIED", () => {
    const r = report(["", "a"], 3, (p, run) => (p === "a" && run === 2 ? [] : [contrastObs(".x", "#9ca3af", "#ffffff", 2.54)]));
    expect(r.groups[0]).toMatchObject({ verdict: "MIXED", verified: 1, intermittent: 1 });
  });

  it("group ids are stable between identical inspections and ordered by impact", () => {
    const make = () => report(["", "a", "b"], 3, (p) => [contrastObs(".x", "#9ca3af", "#ffffff", 2.54), ...(p === "" ? [consoleObs("boom")] : [])]);
    const a = make().groups;
    expect(a.map((g) => g.id)).toEqual(make().groups.map((g) => g.id));
    expect(a[0]?.severity).toBe("serious");
    expect(a[0]?.elements).toBe(3);
    expect(a.every((g) => /^G-[0-9a-f]{12}$/.test(g.id))).toBe(true);
  });

  it("normalizes selectors: no positions, no generated ids", () => {
    expect(normalizeSelector('.story[lang="en"]:nth-child(10) > div:nth-child(2) > button[type="button"]')).toBe('.story[lang="en"] > div > button[type="button"]');
    expect(normalizeSelector("#radix-12ab > .menu")).toBe(".menu");
    expect(normalizeSelector("div > #item-3 > a")).toBe("div > a");
  });
});

describe("report v2: groups are re-derived when a report loads", () => {
  const good = report(["", "a"], 3, () => [contrastObs(".x", "#9ca3af", "#ffffff", 2.54)]);

  it("loads when the groups follow from the findings", () => {
    expect(InspectionReport.safeParse(good).success).toBe(true);
  });

  it("does not load when a group's counts or verdict were manipulated", () => {
    const g = good.groups[0] as (typeof good.groups)[number];
    expect(InspectionReport.safeParse({ ...good, groups: [{ ...g, elements: 1 }] }).success).toBe(false);
    expect(InspectionReport.safeParse({ ...good, groups: [{ ...g, pages: [page("")] }] }).success).toBe(false);
    expect(InspectionReport.safeParse({ ...good, groups: [{ ...g, verdict: "VERIFIED", intermittent: 0 }], findings: good.findings }).success).toBe(true);
    expect(InspectionReport.safeParse({ ...good, groups: [] }).success).toBe(false);
  });

  it("a v2 report must carry its groups", () => {
    expect(InspectionReport.safeParse({ ...good, groups: undefined }).success).toBe(false);
  });

  it("a v1 report loads and gets its groups derived", () => {
    const v1 = InspectionReport.parse({ ...good, groups: undefined, schemaVersion: "exegezis.inspection-report/v1" });
    expect(v1.groups).toEqual(good.groups);
  });
});

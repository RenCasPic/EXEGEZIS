import { tapFacts } from "./issue-groups.js";
import type { Finding, IssueGroup, Severity } from "./schemas/inspection.js";

/*
 * Where a problem lives: Frontend (what the page does in the browser) or
 * Backend (the server, seen from outside), and a subarea of each. One map
 * for every check, old and new: a report is organized when it is shown, so
 * reports written before this map get the same organization.
 */

export type Area = "frontend" | "backend";

export const FRONTEND_SUBAREAS = ["content", "design", "behaviour", "performance", "seo", "mobile", "external"] as const;
export const BACKEND_SUBAREAS = ["responses", "security", "config", "access"] as const;
export type Subarea = (typeof FRONTEND_SUBAREAS)[number] | (typeof BACKEND_SUBAREAS)[number];

export const SUBAREAS: Record<Area, readonly Subarea[]> = { frontend: FRONTEND_SUBAREAS, backend: BACKEND_SUBAREAS };

/** Every check's subarea. A check not listed here (a future one) shows under Frontend · Behaviour. */
export const CHECK_SUBAREA: Readonly<Record<string, Subarea>> = {
  "js-exceptions": "behaviour",
  "console-errors": "behaviour",
  "broken-links": "content",
  a11y: "design",
  "seo-basics": "seo",
  "mobile-scroll": "mobile",
  "mobile-tap-targets": "mobile",
  "mobile-text-size": "mobile",
  "mobile-viewport": "mobile",
  "mobile-fixed-overlap": "mobile",
  "perf-vitals": "performance",
  "heavy-resources": "performance",
  "failed-requests": "responses",
  "slow-response": "responses",
  "mixed-content": "security",
  "security-headers": "security",
  cookies: "security",
  https: "security",
  "site-config": "config",
};

export function areaOfSubarea(s: Subarea): Area {
  return (BACKEND_SUBAREAS as readonly string[]).includes(s) ? "backend" : "frontend";
}

/** A problem's place: its check's subarea, except that what comes from another site (ads, analytics, widgets) is Frontend · External services. */
export function placeOf(g: Pick<IssueGroup, "checkId">, thirdParty: boolean): { area: Area; subarea: Subarea } {
  const subarea: Subarea = thirdParty ? "external" : (CHECK_SUBAREA[g.checkId] ?? "behaviour");
  return { area: areaOfSubarea(subarea), subarea };
}

export type Zone = "header" | "menu" | "content" | "footer";

/** Where on the page an element is, from its CSS selector; null when the selector does not tell. */
export function zoneOfSelector(selector: string): Zone | null {
  const tags = selector
    .split(/\s*>\s*|\s+/)
    .map((part) => part.replace(/[.#[:].*$/, "").toLowerCase())
    .filter((t) => t !== "");
  if (tags.length === 0) return null;
  if (tags.includes("nav") || /menu|navbar|\bnav\b/i.test(selector)) return "menu";
  if (tags.includes("footer")) return "footer";
  if (tags.includes("header")) return "header";
  if (tags.includes("main") || tags.includes("article") || tags.includes("section")) return "content";
  return null;
}

/** The selector a finding is about, when it has one (accessibility rules and small touch targets). */
export function selectorOfFinding(f: Pick<Finding, "checkId" | "title" | "detail">): string | null {
  if (f.checkId === "mobile-tap-targets") return tapFacts(f.detail)?.selector ?? null;
  if (f.checkId === "a11y") {
    const i = f.title.indexOf("): ");
    return i < 0 ? null : f.title.slice(i + 3);
  }
  return null;
}

/** The zone of a group: the one all its findings share, if they do. */
export function zoneOfGroup(findings: readonly Pick<Finding, "checkId" | "title" | "detail">[]): Zone | null {
  const zones = new Set(findings.map((f) => {
    const s = selectorOfFinding(f);
    return s === null ? null : zoneOfSelector(s);
  }));
  if (zones.size !== 1) return null;
  return [...zones][0] ?? null;
}

const RANK: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3, info: 4 };

export interface AreaSummary {
  area: Area;
  /** Groups with at least one VERIFIED finding, info excluded (as groupStats counts problems). */
  problems: number;
  worst: Severity | null;
  subareas: { subarea: Subarea; groups: IssueGroup[]; problems: number; worst: Severity | null }[];
}

/** The report organized: area → subarea → issue groups (in their order of impact). */
export function organizeGroups(groups: readonly IssueGroup[], findings: readonly Finding[]): AreaSummary[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const place = (g: IssueGroup) => placeOf(g, g.findings.every((id) => byId.get(id)?.thirdParty === true));
  return (["frontend", "backend"] as const).map((area) => {
    const subareas = SUBAREAS[area].map((subarea) => {
      const own = groups.filter((g) => place(g).subarea === subarea);
      const problems = own.filter((g) => g.verified > 0 && g.severity !== "info");
      const worst = problems.reduce<Severity | null>((w, g) => (w === null || RANK[g.severity] < RANK[w] ? g.severity : w), null);
      return { subarea, groups: own, problems: problems.length, worst };
    });
    const problems = subareas.reduce((n, s) => n + s.problems, 0);
    const worst = subareas.reduce<Severity | null>((w, s) => (s.worst !== null && (w === null || RANK[s.worst] < RANK[w]) ? s.worst : w), null);
    return { area, problems, worst, subareas };
  });
}

/** Median and range of the values that were measured. */
export function medianRange(values: readonly (number | null)[]): { median: number; min: number; max: number; n: number } | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 === 1 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return { median, min: v[0] as number, max: v[v.length - 1] as number, n: v.length };
}

/** Google's thresholds (web.dev): good up to the first value, poor above the second. TBT as Lighthouse rates it. */
export const VITALS = {
  lcpMs: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  tbtMs: { good: 200, poor: 600 },
  fcpMs: { good: 1800, poor: 3000 },
  ttfbMs: { good: 800, poor: 1800 },
} as const;

export type Rating = "good" | "needs-improvement" | "poor";

export function rate(metric: keyof typeof VITALS, value: number): Rating {
  const t = VITALS[metric];
  return value <= t.good ? "good" : value <= t.poor ? "needs-improvement" : "poor";
}

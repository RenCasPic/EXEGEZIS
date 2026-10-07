import { contrastRatio, displayRatio, parseHex, suggestForeground } from "./color.js";
import { sha256 } from "./hash.js";
import type { Finding, IssueGroup, Severity } from "./schemas/inspection.js";

/*
 * Issue groups: "what do I have to fix?". A pure, deterministic view over
 * the findings (which stay the source of truth, one per element and page).
 * Reports store the groups and they are re-derived when a report loads: a
 * report whose groups do not follow from its findings does not load.
 */

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3, info: 4 };

/** axe's color-contrast summary (axe-core 4.x wording, pinned version). */
const CONTRAST = /foreground color: (#[0-9a-f]{3,6}), background color: (#[0-9a-f]{3,6}), font size: ([^,]+), font weight: (\w+)\)\. Expected contrast ratio of ([0-9.]+):1/i;
const MEASURED = /insufficient color contrast of ([0-9.]+)/i;

export interface ContrastFacts {
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  /** WCAG: large text (≥ 18 pt, or ≥ 14 pt bold) needs 3:1; axe tells which by the ratio it expects. */
  textSize: "normal" | "large";
}

export function contrastFacts(detail: string): ContrastFacts | null {
  const m = CONTRAST.exec(detail);
  if (m === null) return null;
  const fg = parseHex(m[1] as string);
  const bg = parseHex(m[2] as string);
  if (fg === null || bg === null) return null;
  const required = Number(m[5]);
  const measured = MEASURED.exec(detail);
  return {
    foreground: (m[1] as string).toLowerCase(),
    background: (m[2] as string).toLowerCase(),
    ratio: measured === null ? displayRatio(contrastRatio(fg, bg)) : Number(measured[1]),
    required,
    textSize: required <= 3 ? "large" : "normal",
  };
}

/** axe rule id from a finding title "… (rule-id): selector". */
export function axeRuleOf(title: string): string | null {
  return /\(([a-z0-9-]+)\):/.exec(title)?.[1] ?? null;
}

/** Selector without positions or generated ids: the same component anywhere on any page. */
export function normalizeSelector(selector: string): string {
  return selector
    .replace(/:nth-(?:child|of-type|last-child|last-of-type)\([^)]*\)/g, "")
    .replace(/#[A-Za-z_-]*\d[\w-]*/g, "") // ids containing digits are usually generated
    .replace(/\[(?:id|data-[\w-]*id)="[^"]*"\]/g, "")
    // Where a link goes or which picture it shows is content, not the component (a[href$="johndoe"] > img).
    .replace(/\[(?:href|src|alt|title|aria-label)[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*)\]/g, "")
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ")
    .replace(/(?:> )+>/g, ">") // a removed compound leaves "> >"
    .replace(/^\s*>\s*|\s*>\s*$/g, "")
    .trim();
}

function selectorOf(title: string): string {
  const i = title.indexOf("): ");
  return i < 0 ? "" : title.slice(i + 3);
}

/** WCAG 2.2, 2.5.8 (Target Size Minimum): 24×24 CSS px. */
export const TAP_MINIMUM = 24;

export interface TapFacts {
  kind: "link" | "button" | "field" | "element";
  place: "menu" | "header" | "footer" | "page";
  /** Measured size; null for a side that already reaches the minimum. */
  width: number | null;
  height: number | null;
  /** Padding to add on each side to reach the minimum. */
  padding: { x: number; y: number };
}

/** mobile-tap-targets detail: "<selector> is <w>×<h> px; …". */
const TAP = /^([\s\S]*?) is (\d+(?:\.\d+)?)×(\d+(?:\.\d+)?) px;/;

const tagOf = (compound: string) => compound.replace(/[.#[:].*$/, "");

export function tapFacts(detail: string): (TapFacts & { selector: string }) | null {
  const m = TAP.exec(detail);
  if (m === null) return null;
  const selector = normalizeSelector(m[1] as string);
  const w = Math.round(Number(m[2]));
  const h = Math.round(Number(m[3]));
  const tags = selector.split(" > ").map(tagOf);
  const last = tags[tags.length - 1] ?? "";
  const kind: TapFacts["kind"] =
    last === "a" || /role="?link/.test(selector) ? "link" : last === "button" || /role="?button/.test(selector) ? "button" : ["input", "select", "textarea"].includes(last) ? "field" : "element";
  const place: TapFacts["place"] = tags.includes("nav") || /menu|navbar|\bnav\b/i.test(selector) ? "menu" : tags.includes("footer") ? "footer" : tags.includes("header") ? "header" : "page";
  const short = (n: number) => (n < TAP_MINIMUM ? n : null);
  // Older reports may list a target a fraction under 24 px recorded as 24: its smaller side is the short one.
  const neither = short(w) === null && short(h) === null;
  return {
    selector,
    kind,
    place,
    width: neither && w < h ? w : short(w),
    height: neither && h <= w ? h : short(h),
    padding: { x: Math.max(0, Math.ceil((TAP_MINIMUM - w) / 2)), y: Math.max(0, Math.ceil((TAP_MINIMUM - h) / 2)) },
  };
}

const KIND_WORD: Record<TapFacts["kind"], string> = { link: "links", button: "buttons", field: "fields", element: "touch targets" };

function tapTitle(t: TapFacts): string {
  const what = t.place === "page" ? KIND_WORD[t.kind] : `${t.place} ${KIND_WORD[t.kind]}`;
  const size = t.width !== null && t.height !== null ? `of ${t.width}×${t.height} px` : t.height !== null ? `${t.height} px tall` : `${t.width ?? 0} px wide`;
  return `${what.replace(/^./, (c) => c.toUpperCase())} ${size}: the minimum is ${TAP_MINIMUM}×${TAP_MINIMUM} px`;
}

/** The grouping key of a finding, by check (see docs/07 §9). */
export function issueKey(f: Pick<Finding, "checkId" | "fingerprint" | "title" | "detail">): { key: string; rule: string | null; contrast: ContrastFacts | null; tap: TapFacts | null } {
  if (f.checkId === "mobile-tap-targets") {
    // The same component at the same size, on any page: one thing to fix.
    const t = tapFacts(f.detail);
    if (t !== null) {
      const { selector, ...tap } = t;
      return { key: `mobile-tap-targets|${selector}|${tap.width ?? "ok"}x${tap.height ?? "ok"}`, rule: null, contrast: null, tap };
    }
  }
  if (f.checkId === "a11y") {
    const rule = axeRuleOf(f.title);
    if (rule === "color-contrast") {
      const c = contrastFacts(f.detail);
      if (c !== null) return { key: `a11y|color-contrast|${c.foreground}|${c.background}|${c.textSize}`, rule, contrast: c, tap: null };
    }
    return { key: `a11y|${rule ?? "?"}|${normalizeSelector(selectorOf(f.title))}`, rule, contrast: null, tap: null };
  }
  // The other checks already fingerprint what identifies the problem
  // independently of the page: a normalized message (console, exceptions),
  // method + URL without query + status (requests), the target URL (links),
  // the resource or field (mixed content, SEO).
  return { key: `${f.checkId}|${f.fingerprint.slice(f.checkId.length + 1)}`, rule: null, contrast: null, tap: null };
}

function plainTitle(first: Finding, rule: string | null, contrast: ContrastFacts | null, tap: TapFacts | null): string {
  if (tap !== null) return tapTitle(tap);
  if (contrast !== null) {
    return `Text ${contrast.foreground} on ${contrast.background}: contrast ${contrast.ratio}:1, minimum ${contrast.required}:1${contrast.textSize === "large" ? " (large text)" : ""}`;
  }
  if (first.checkId === "a11y") return `${first.title.replace(/\s*\([a-z0-9-]+\):.*$/, "")} (${rule ?? "axe"}): ${normalizeSelector(selectorOf(first.title))}`;
  // The group spans messages that differ only in numbers or ids: show the normalized form.
  const normalized = first.fingerprint.slice(first.checkId.length + 1);
  if (first.checkId === "console-errors") return `Console error: ${normalized}`;
  if (first.checkId === "js-exceptions") return `Uncaught exception: ${normalized}`;
  return first.title;
}

/** Up to 5 examples: VERIFIED first, then one per page before repeating a page, then report order. */
function pickExamples(findings: readonly Finding[]): string[] {
  const ordered = [...findings].sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "VERIFIED" ? -1 : 1) || a.id.localeCompare(b.id));
  const picked: Finding[] = [];
  const pages = new Set<string>();
  for (const f of ordered) {
    if (picked.length < 5 && !pages.has(f.page)) {
      picked.push(f);
      pages.add(f.page);
    }
  }
  for (const f of ordered) if (picked.length < 5 && !picked.includes(f)) picked.push(f);
  return picked.map((f) => f.id);
}

export function deriveIssueGroups(findings: readonly Finding[]): IssueGroup[] {
  const buckets = new Map<string, { rule: string | null; contrast: ContrastFacts | null; tap: TapFacts | null; items: Finding[] }>();
  for (const f of findings) {
    const k = issueKey(f);
    const bucket = buckets.get(k.key);
    if (bucket === undefined) buckets.set(k.key, { rule: k.rule, contrast: k.contrast, tap: k.tap, items: [f] });
    else {
      bucket.items.push(f);
      // Worst measured ratio of the group.
      if (bucket.contrast !== null && k.contrast !== null && k.contrast.ratio < bucket.contrast.ratio) bucket.contrast = { ...bucket.contrast, ratio: k.contrast.ratio };
    }
  }
  const groups: IssueGroup[] = [...buckets.entries()].map(([key, b]) => {
    const items = [...b.items].sort((x, y) => x.id.localeCompare(y.id));
    const first = items[0] as Finding;
    const verified = items.filter((f) => f.verdict === "VERIFIED").length;
    const intermittent = items.length - verified;
    const severity = items.reduce<Severity>((s, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[s] ? f.severity : s), first.severity);
    const suggestion = b.contrast === null ? null : suggestForeground(b.contrast.foreground, b.contrast.background, b.contrast.required);
    return {
      id: `G-${sha256(key).slice(0, 12)}`,
      key,
      checkId: first.checkId,
      rule: b.rule,
      title: plainTitle(first, b.rule, b.contrast, b.tap),
      severity,
      // Never hide an intermittent observation inside a VERIFIED group.
      verdict: intermittent === 0 ? "VERIFIED" : verified === 0 ? "INTERMITTENT" : "MIXED",
      verified,
      intermittent,
      elements: items.length,
      pages: [...new Set(items.map((f) => f.page))].sort(),
      findings: items.map((f) => f.id),
      examples: pickExamples(items),
      contrast: b.contrast === null ? null : { ...b.contrast, suggestion },
      tapTarget: b.tap,
    };
  });
  return groups.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.elements - a.elements || b.pages.length - a.pages.length || a.id.localeCompare(b.id),
  );
}

/**
 * Stored groups are an honest grouping of the findings: every finding in
 * exactly one group, and each group's counts, pages, verdict, severity and
 * examples follow from its own findings. How findings are grouped (keys and
 * titles) may improve between versions: the groups are re-derived when a
 * report loads.
 */
export function groupsConsistent(groups: readonly IssueGroup[], findings: readonly Finding[]): boolean {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (const g of groups) {
    const items: Finding[] = [];
    for (const id of g.findings) {
      const f = byId.get(id);
      if (f === undefined || seen.has(id) || f.checkId !== g.checkId) return false;
      seen.add(id);
      items.push(f);
    }
    const verified = items.filter((f) => f.verdict === "VERIFIED").length;
    const intermittent = items.length - verified;
    const severity = items.reduce<Severity | null>((s, f) => (s === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[s] ? f.severity : s), null);
    const pages = [...new Set(items.map((f) => f.page))].sort();
    if (
      g.elements !== items.length ||
      g.verified !== verified ||
      g.intermittent !== intermittent ||
      g.verdict !== (intermittent === 0 ? "VERIFIED" : verified === 0 ? "INTERMITTENT" : "MIXED") ||
      g.severity !== severity ||
      pages.join("\n") !== g.pages.join("\n") ||
      !g.examples.every((id) => g.findings.includes(id))
    ) {
      return false;
    }
  }
  return seen.size === findings.length;
}

export interface GroupStats {
  /** Groups with at least one VERIFIED finding, info excluded: the problems to fix. */
  problems: number;
  /** VERIFIED findings (elements) in those groups. */
  elements: number;
  /** Pages where those VERIFIED findings are. */
  pages: number;
  bySeverity: Record<Severity, number>;
  /** Groups with at least one INTERMITTENT finding, and how many such findings (reported apart). */
  intermittentProblems: number;
  intermittentElements: number;
  /** Groups of info findings (SEO basics): shown, not counted as problems. */
  info: number;
}

export function groupStats(groups: readonly IssueGroup[], findings: readonly Finding[]): GroupStats {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const problems = groups.filter((g) => g.verified > 0 && g.severity !== "info");
  const verifiedFindings = problems.flatMap((g) => g.findings.map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined && f.verdict === "VERIFIED"));
  const bySeverity: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
  for (const g of problems) bySeverity[g.severity] += 1;
  const intermittent = groups.filter((g) => g.intermittent > 0);
  return {
    problems: problems.length,
    elements: verifiedFindings.length,
    pages: new Set(verifiedFindings.map((f) => f.page)).size,
    bySeverity,
    intermittentProblems: intermittent.length,
    intermittentElements: intermittent.reduce((n, g) => n + g.intermittent, 0),
    info: groups.filter((g) => g.verified > 0 && g.severity === "info").length,
  };
}

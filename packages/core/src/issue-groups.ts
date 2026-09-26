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

/** The grouping key of a finding, by check (see docs/07 §9). */
export function issueKey(f: Pick<Finding, "checkId" | "fingerprint" | "title" | "detail">): { key: string; rule: string | null; contrast: ContrastFacts | null } {
  if (f.checkId === "a11y") {
    const rule = axeRuleOf(f.title);
    if (rule === "color-contrast") {
      const c = contrastFacts(f.detail);
      if (c !== null) return { key: `a11y|color-contrast|${c.foreground}|${c.background}|${c.textSize}`, rule, contrast: c };
    }
    return { key: `a11y|${rule ?? "?"}|${normalizeSelector(selectorOf(f.title))}`, rule, contrast: null };
  }
  // The other checks already fingerprint what identifies the problem
  // independently of the page: a normalized message (console, exceptions),
  // method + URL without query + status (requests), the target URL (links),
  // the resource or field (mixed content, SEO).
  return { key: `${f.checkId}|${f.fingerprint.slice(f.checkId.length + 1)}`, rule: null, contrast: null };
}

function plainTitle(first: Finding, rule: string | null, contrast: ContrastFacts | null): string {
  if (contrast !== null) {
    return `Text ${contrast.foreground} on ${contrast.background}: contrast ${contrast.ratio}:1, minimum ${contrast.required}:1${contrast.textSize === "large" ? " (large text)" : ""}`;
  }
  if (first.checkId === "a11y") return `${first.title.replace(/\s*\([a-z0-9-]+\):.*$/, "")} (${rule ?? "axe"}): ${normalizeSelector(selectorOf(first.title))}`;
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
  const buckets = new Map<string, { rule: string | null; contrast: ContrastFacts | null; items: Finding[] }>();
  for (const f of findings) {
    const k = issueKey(f);
    const bucket = buckets.get(k.key);
    if (bucket === undefined) buckets.set(k.key, { rule: k.rule, contrast: k.contrast, items: [f] });
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
      title: plainTitle(first, b.rule, b.contrast),
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
    };
  });
  return groups.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.elements - a.elements || b.pages.length - a.pages.length || a.id.localeCompare(b.id),
  );
}

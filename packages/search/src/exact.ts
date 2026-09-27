import { runInNewContext } from "node:vm";
import {
  findWhole,
  normalizeSearch,
  normalizeSearchText,
  observationKey,
  originalSpan,
  quoteAround,
  type ExactQuery,
  type MatchVia,
  type SearchObservation,
  type TextBlock,
} from "@exegezis/core";
import { detect } from "./detectors.js";
import { languagesFor, stemOf, type StemLanguage } from "./variants.js";

/*
 * Exact search (docs/10-search.md §3): deterministic, no model. Whole-word
 * matches of the normalized terms and phrases in the normalized block text;
 * optional variants (same Snowball stem), a regular expression and the
 * template detectors. Matches are located in the page's own words.
 */

interface Item {
  /** As the person typed it (the hit's "term"). */
  label: string;
  norm: string;
  /** Single-word terms can match through variants. */
  single: boolean;
}

export interface CompiledQuery {
  items: Item[];
  excluded: { label: string; norm: string }[];
  excludeScope: "block" | "page";
  variants: boolean;
  regex: { source: string; label: string } | null;
  detectors: ExactQuery["detectors"];
}

export function compileExact(q: ExactQuery): CompiledQuery {
  const items: Item[] = [];
  const add = (label: string, text: string) => {
    const norm = normalizeSearch(text);
    if (norm !== "" && !items.some((i) => i.norm === norm)) items.push({ label, norm, single: label === text && /^[\p{L}\p{N}]+$/u.test(norm) });
  };
  for (const t of q.terms) add(t, t);
  // Phrases keep their quotes in the hit's term, and never match through variants.
  for (const p of q.phrases) add(`"${p}"`, p);
  for (const s of q.suggested) add(s.term, s.term);
  if (q.regex !== null) {
    try {
      new RegExp(q.regex, "u");
    } catch (error) {
      throw new Error(`The regular expression is not valid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return {
    items,
    excluded: q.excluded.map((e) => ({ label: e, norm: normalizeSearch(e) })).filter((e) => e.norm !== ""),
    excludeScope: q.excludeScope,
    variants: q.variants,
    regex: q.regex === null ? null : { source: q.regex, label: `/${q.regex}/` },
    detectors: q.detectors,
  };
}

export interface BlockMatch {
  term: string;
  via: Exclude<MatchVia, "meaning">;
  start: number;
  end: number;
  stem: string | null;
}

const REGEX_TIMEOUT_MS = 250;

/** The regex runs in a separate context with a time limit: a catastrophic pattern cannot hang the search. */
function regexSpans(source: string, text: string): { start: number; end: number }[] {
  try {
    const spans = runInNewContext(
      `(() => { const re = new RegExp(source, "giu"); const out = []; let m; while ((m = re.exec(text)) !== null && out.length < 500) { if (m[0] === "") { re.lastIndex += 1; continue; } out.push([m.index, m.index + m[0].length]); } return out; })()`,
      { source, text },
      { timeout: REGEX_TIMEOUT_MS },
    ) as [number, number][];
    return spans.map(([start, end]) => ({ start, end }));
  } catch {
    // Timed out (or failed): no matches for this block; the search goes on.
    return [];
  }
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export function matchBlock(block: TextBlock, q: CompiledQuery, lang: string | null, now: Date): BlockMatch[] {
  const text = block.text;
  const n = normalizeSearchText(text);
  const found: BlockMatch[] = [];
  for (const item of q.items) {
    for (const at of findWhole(n.text, item.norm)) {
      const span = originalSpan(text, n, at, at + item.norm.length);
      found.push({ term: item.label, via: "exact", start: span.start, end: span.end, stem: null });
    }
  }
  if (q.variants) {
    const langs: StemLanguage[] = languagesFor(lang);
    const singles = q.items.filter((i) => i.single);
    if (singles.length > 0) {
      const stems = singles.map((i) => ({ item: i, stems: langs.map((l) => stemOf(i.label, l)) }));
      for (const m of text.matchAll(WORD)) {
        const word = m[0];
        const nw = normalizeSearch(word);
        for (const { item, stems: termStems } of stems) {
          if (nw === item.norm) continue; // an exact match, already found
          const shared = langs.findIndex((l, k) => termStems[k] !== undefined && termStems[k].length >= 3 && stemOf(word, l) === termStems[k]);
          if (shared === -1) continue;
          found.push({ term: item.label, via: "variant", start: m.index, end: m.index + word.length, stem: termStems[shared] ?? null });
        }
      }
    }
  }
  if (q.regex !== null) {
    for (const s of regexSpans(q.regex.source, n.text)) {
      const span = originalSpan(text, n, s.start, s.end);
      found.push({ term: q.regex.label, via: "regex", start: span.start, end: span.end, stem: null });
    }
  }
  for (const detector of q.detectors) {
    for (const d of detect(detector, text, now)) found.push({ term: `[${detector}]`, via: "detector", start: d.start, end: d.end, stem: null });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The excluded term a block contains, if any. */
export function excludedBy(block: TextBlock, q: CompiledQuery): string | null {
  if (q.excluded.length === 0) return null;
  const n = normalizeSearch(block.text);
  return q.excluded.find((e) => findWhole(n, e.norm).length > 0)?.label ?? null;
}

export interface VisitRef {
  page: string;
  run: number;
  runPath: string | null;
}

export function toObservation(visit: VisitRef, block: TextBlock, m: BlockMatch): SearchObservation {
  const q = quoteAround(block.text, m.start, m.end);
  const base = {
    run: visit.run,
    page: visit.page,
    runPath: visit.runPath,
    blockId: block.id,
    blockKind: block.kind,
    visible: block.visible,
    selector: block.selector,
    rect: block.rect,
    term: m.term,
    via: m.via,
    matchedText: block.text.slice(m.start, m.end).replace(/\s+/g, " "),
    stem: m.stem,
    quote: q.quote,
    contextBefore: q.contextBefore,
    contextAfter: q.contextAfter,
    match: q.match,
  };
  return { ...base, key: observationKey(base) };
}

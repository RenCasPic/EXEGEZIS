import { sha256 } from "./hash.js";

/*
 * Text normalization for searches (docs/10-search.md §3). The same function
 * normalizes the query, the page text and the quotes a model returns, so a
 * quote is verified exactly as a term is matched. It keeps a map from every
 * normalized character back to the original text, to show the page's own
 * words (with their accents and capitals) around a match.
 */

const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const MARKS = /\p{M}/gu;
const SPACE = /\s/u;

function fold(ch: string): string {
  // ñ stays ñ: «año» and «ano» are different words.
  if (ch === "ñ" || ch === "Ñ") return "ñ";
  return ch
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(MARKS, "")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-");
}

export interface NormalizedText {
  /** Lowercase, without accents (except ñ), with plain quotes and single spaces, trimmed. */
  text: string;
  /** For each UTF-16 unit of `text`, the index of the original character it came from. */
  map: number[];
}

export function normalizeSearchText(input: string): NormalizedText {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) ?? 0;
    let ch = String.fromCodePoint(cp);
    let width = ch.length;
    // A decomposed ñ (n + combining tilde) is still ñ.
    if ((ch === "n" || ch === "N") && input.charCodeAt(i + 1) === 0x0303) {
      ch = "ñ";
      width = 2;
    }
    for (const c of fold(ch)) {
      if (SPACE.test(c)) {
        if (!lastWasSpace) {
          text += " ";
          map.push(i);
          lastWasSpace = true;
        }
        continue;
      }
      text += c;
      for (let k = 0; k < c.length; k++) map.push(i);
      lastWasSpace = false;
    }
    i += width;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

export function normalizeSearch(input: string): string {
  return normalizeSearchText(input).text;
}

/** The original span [start, end) of a normalized span [start, end). */
export function originalSpan(original: string, n: NormalizedText, start: number, end: number): { start: number; end: number } {
  const s = n.map[start] ?? 0;
  const lastIndex = n.map[Math.max(start, end - 1)] ?? s;
  const last = original.codePointAt(lastIndex);
  const width = last === undefined ? 0 : String.fromCodePoint(last).length;
  // Include a trailing combining mark of the last character (e.g. a decomposed accent).
  let e = lastIndex + width;
  while (e < original.length && /\p{M}/u.test(original[e] ?? "")) e += 1;
  return { start: s, end: e };
}

const WORD = /[\p{L}\p{N}]/u;
export const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD.test(c);

/** Whole-word occurrences of a normalized needle in a normalized haystack. */
export function findWhole(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === "") return found;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + needle.length];
    const edgeStart = !isWordChar(needle[0]) || !isWordChar(before);
    const edgeEnd = !isWordChar(needle[needle.length - 1]) || !isWordChar(after);
    if (edgeStart && edgeEnd) found.push(at);
  }
  return found;
}

export interface QuoteInContext {
  /** The page's own words: the sentence around the match (capped). */
  quote: string;
  contextBefore: string;
  contextAfter: string;
  /** The match inside `quote`. */
  match: { start: number; end: number };
}

const SENTENCE_END = /[.!?\u2026\n]/;
const MAX_QUOTE = 240;
const CONTEXT = 80;

/** The sentence around an original span [start, end), with some context on each side. */
export function quoteAround(original: string, start: number, end: number): QuoteInContext {
  let qs = start;
  while (qs > 0 && start - qs < MAX_QUOTE / 2 && !SENTENCE_END.test(original[qs - 1] ?? "")) qs -= 1;
  let qe = end;
  while (qe < original.length && qe - end < MAX_QUOTE / 2 && !SENTENCE_END.test(original[qe] ?? "")) qe += 1;
  if (qe < original.length && SENTENCE_END.test(original[qe] ?? "") && original[qe] !== "\n") qe += 1;
  // Do not cut words at the caps.
  while (qs > 0 && qs < start && isWordChar(original[qs - 1]) && isWordChar(original[qs])) qs += 1;
  while (qe < original.length && qe > end && isWordChar(original[qe - 1]) && isWordChar(original[qe])) qe -= 1;
  const raw = original.slice(qs, qe);
  const lead = raw.length - raw.trimStart().length;
  const quote = raw.trim();
  const contextBefore = original.slice(Math.max(0, qs - CONTEXT), qs + lead).replace(/\s+/g, " ").trimStart();
  const contextAfter = original.slice(qe, qe + CONTEXT).replace(/\s+/g, " ").trimEnd();
  return {
    quote: quote.replace(/\s+/g, " "),
    contextBefore,
    contextAfter,
    match: remapMatch(raw, lead, start - qs, end - qs),
  };
}

/** The match offsets inside the trimmed, space-collapsed quote. */
function remapMatch(raw: string, lead: number, start: number, end: number): { start: number; end: number } {
  const collapse = (s: string) => s.replace(/\s+/g, " ");
  const s = collapse(raw.slice(lead, start)).length;
  const e = s + collapse(raw.slice(start, end)).length;
  return { start: s, end: e };
}

/** Why a quote is accepted as literally present in a block, or not. */
export function verifyQuote(quote: string, blockText: string): { verified: boolean; rejection: string | null; start: number; end: number } {
  const cleaned = quote.trim().replace(/^["'«“]+|["'»”]+$/g, "").replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "");
  const q = normalizeSearch(cleaned);
  const words = q.split(" ").filter((w) => isWordChar(w[0]) || isWordChar(w[w.length - 1]));
  if (q.length < 10 || words.length < 2) return { verified: false, rejection: "the quote is too short to prove anything", start: -1, end: -1 };
  const block = normalizeSearchText(blockText);
  const at = block.text.indexOf(q);
  if (at === -1) return { verified: false, rejection: "the quote is not in the text of that block", start: -1, end: -1 };
  const span = originalSpan(blockText, block, at, at + q.length);
  return { verified: true, rejection: null, start: span.start, end: span.end };
}

/** The identity of a hit across runs: the page, what matched and the normalized quote. */
export function searchKey(page: string, term: string, quote: string): string {
  return sha256(`${page}\n${normalizeSearch(term)}\n${normalizeSearch(quote)}`).slice(0, 24);
}

/** A link that opens the page and scrolls to the quote (text fragments). */
export function textFragmentUrl(page: string, quote: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  const words = quote.replace(/\s+/g, " ").trim().split(" ");
  const base = page.replace(/#.*$/, "");
  if (words.length <= 10) return `${base}#:~:text=${enc(words.join(" "))}`;
  return `${base}#:~:text=${enc(words.slice(0, 5).join(" "))},${enc(words.slice(-5).join(" "))}`;
}

import { ExactQuery, normalizeSearch, type SearchDetector, type SuggestedTerm } from "@exegezis/core";

/**
 * The terms box: items separated by commas. `"quoted"` is a phrase, `-word`
 * (or `-"a phrase"`) is excluded, anything else is a term (one word, or
 * several words matched together). Commas inside quotes do not split.
 */
export function parseTermsInput(input: string): { terms: string[]; phrases: string[]; excluded: string[] } {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of input) {
    if (quote !== null) {
      current += ch;
      if ((quote === '"' && ch === '"') || (quote === "“" && ch === "”") || (quote === "«" && ch === "»")) quote = null;
      continue;
    }
    if (ch === '"' || ch === "“" || ch === "«") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "," || ch === ";" || ch === "\n") {
      items.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current);

  const terms: string[] = [];
  const phrases: string[] = [];
  const excluded: string[] = [];
  const unquote = (s: string) => s.replace(/^["“«]/, "").replace(/["”»]$/, "").trim();
  const add = (list: string[], value: string) => {
    if (value !== "" && !list.some((v) => normalizeSearch(v) === normalizeSearch(value))) list.push(value);
  };
  for (const raw of items) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (item === "" || item === "-") continue;
    if (item.startsWith("-")) add(excluded, unquote(item.slice(1).trim()));
    else if (/^["“«]/.test(item)) add(phrases, unquote(item));
    else add(terms, item);
  }
  return { terms, phrases, excluded };
}

export interface ExactQueryInput {
  terms?: string;
  variants?: boolean;
  excludeScope?: "block" | "page";
  regex?: string | null;
  detectors?: SearchDetector[];
  suggested?: SuggestedTerm[];
}

/** An exact query from the terms box and options, validated. */
export function exactQueryFrom(input: ExactQueryInput): ExactQuery {
  const parsed = parseTermsInput(input.terms ?? "");
  const suggested = (input.suggested ?? []).filter((s) => ![...parsed.terms, ...parsed.phrases].some((t) => normalizeSearch(t) === normalizeSearch(s.term)));
  const query = ExactQuery.parse({
    kind: "exact",
    terms: parsed.terms,
    phrases: parsed.phrases,
    excluded: parsed.excluded,
    excludeScope: input.excludeScope ?? "block",
    variants: input.variants ?? false,
    regex: input.regex === undefined || input.regex === null || input.regex.trim() === "" ? null : input.regex,
    detectors: input.detectors ?? [],
    suggested,
  });
  if (query.terms.length + query.phrases.length + query.suggested.length === 0 && query.regex === null && query.detectors.length === 0) {
    throw new Error("Nothing to search for: give at least one term, a phrase, a regular expression or a detector.");
  }
  return query;
}

/** The query as the person would type it again (for lists and exports). */
export function describeExact(q: ExactQuery): string {
  return [
    ...q.terms,
    ...q.phrases.map((p) => `"${p}"`),
    ...q.suggested.map((s) => s.term),
    ...q.excluded.map((e) => `-${e}`),
    ...(q.regex === null ? [] : [`/${q.regex}/`]),
    ...q.detectors.map((d) => `[${d}]`),
  ].join(", ");
}

import { createRequire } from "node:module";
import { normalizeSearch } from "@exegezis/core";

// snowball-stemmers ships no types: its one function, typed here.
const { newStemmer } = createRequire(import.meta.url)("snowball-stemmers") as { newStemmer: (language: string) => { stem(word: string): string } };

/*
 * Word variants (docs/10-search.md §3): the Snowball stem, applied until it
 * stops changing. It joins plurals and verb forms (enfermedad/enfermedades,
 * curar/curó), not derivations (curar/curación, médico/medicina), and it can
 * join unrelated words (casa/caso, mesa/mes): variants are off by default and
 * every hit found through one says which stem joined it.
 */

export const STEMMER = "snowball-stemmers@0.6.0 (spanish, english; fixpoint)";

export type StemLanguage = "es" | "en";

const STEMMERS: Record<StemLanguage, { stem(word: string): string }> = {
  es: newStemmer("spanish"),
  en: newStemmer("english"),
};

const cache = new Map<string, string>();

/** The stem of a word, lowercased with its accents (Snowball needs them), then normalized. */
export function stemOf(word: string, language: StemLanguage): string {
  const key = `${language}:${word}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let w = word.toLowerCase();
  for (let i = 0; i < 6; i++) {
    const next = STEMMERS[language].stem(w);
    if (next === w) break;
    w = next;
  }
  const stem = normalizeSearch(w);
  if (cache.size > 50_000) cache.clear();
  cache.set(key, stem);
  return stem;
}

/** The stemmers to use for a page: its html lang, or both when it does not say. */
export function languagesFor(lang: string | null): StemLanguage[] {
  const l = (lang ?? "").toLowerCase();
  if (l.startsWith("es")) return ["es"];
  if (l.startsWith("en")) return ["en"];
  return ["es", "en"];
}

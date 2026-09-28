import { ceilCents, costUsd, roughTokens } from "./cost.js";

/* «Sugerir términos relacionados»: the prompt and its cost estimate (no SDK here, so the UI can estimate). */

export const SUGGEST_PROMPT_VERSION = "search-suggest-v2";

export const SUGGEST_SYSTEM = `You help a person write an exact text search. For each of their terms, propose other words a web page could use for the same idea: words of the same family (curar → curación, curativo), synonyms and very close terms (médico → doctor, medicina), in the same language as the term. No explanations beyond a 2-4 word relation label (written in the language the request names; if it names none, the language of the term), no phrases longer than three words, no duplicates of the given terms. At most 8 suggestions per term.`;

export const SUGGEST_MAX_TOKENS = 1500;

const LANGUAGE_NAME = { en: "English", es: "Spanish" } as const;

/** The terms, and the language of the relation labels (the reader's); the suggested words stay in the language of each term. */
export function suggestUser(terms: readonly string[], language: "en" | "es" | null = null): string {
  return `Terms:\n${terms.map((t) => `- ${t}`).join("\n")}${language === null ? "" : `\n\nWrite the relation labels in ${LANGUAGE_NAME[language]}.`}`;
}

export function estimateSuggestCost(model: string, terms: readonly string[], language: "en" | "es" | null = null): number {
  return ceilCents(costUsd(model, roughTokens(SUGGEST_SYSTEM) + roughTokens(suggestUser(terms, language)) + 50, SUGGEST_MAX_TOKENS));
}


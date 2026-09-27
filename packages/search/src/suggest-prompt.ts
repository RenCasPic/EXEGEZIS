import { ceilCents, costUsd, roughTokens } from "./cost.js";

/* «Sugerir términos relacionados»: the prompt and its cost estimate (no SDK here, so the UI can estimate). */

export const SUGGEST_PROMPT_VERSION = "search-suggest-v1";

export const SUGGEST_SYSTEM = `You help a person write an exact text search. For each of their terms, propose other words a web page could use for the same idea: words of the same family (curar → curación, curativo), synonyms and very close terms (médico → doctor, medicina), in the same language as the term. No explanations beyond a 2-4 word relation label, no phrases longer than three words, no duplicates of the given terms. At most 8 suggestions per term.`;

export const SUGGEST_MAX_TOKENS = 1500;

export function suggestUser(terms: readonly string[]): string {
  return `Terms:\n${terms.map((t) => `- ${t}`).join("\n")}`;
}

export function estimateSuggestCost(model: string, terms: readonly string[]): number {
  return ceilCents(costUsd(model, roughTokens(SUGGEST_SYSTEM) + roughTokens(suggestUser(terms)) + 50, SUGGEST_MAX_TOKENS));
}


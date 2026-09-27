/*
 * Model prices for the cost estimate and limit (docs/10-search.md §4), in USD
 * per million tokens (base input / output, no caching, no batch).
 * Source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-09-27.
 * A model without a price here cannot be used: the limit could not be enforced.
 */

export const PRICES_AS_OF = "2026-09-27";
export const PRICES_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

export const PRICES: Record<string, { input: number; output: number; label: string }> = {
  "claude-sonnet-5": { input: 2, output: 10, label: "Claude Sonnet 5" },
  "claude-haiku-4-5": { input: 1, output: 5, label: "Claude Haiku 4.5" },
  "claude-opus-5": { input: 5, output: 25, label: "Claude Opus 5" },
  "claude-opus-5-5": { input: 4, output: 20, label: "Claude Opus 5.5" },
  "claude-fable-5-1": { input: 10, output: 50, label: "Claude Fable 5.1" },
};

/** Good quotes at a moderate price; configurable in Settings and with --model. */
export const DEFAULT_SEARCH_MODEL = "claude-sonnet-5";
/** docs/10-search.md §7, decision 3: 1 USD per search by meaning, configurable. */
export const DEFAULT_MAX_COST_USD = 1;

export function priceOf(model: string): { input: number; output: number } {
  const price = PRICES[model];
  if (price === undefined) throw new Error(`There is no price for the model "${model}" (known: ${Object.keys(PRICES).join(", ")}): the cost limit could not be enforced.`);
  return price;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Tokens of a text when the counting endpoint is not available: new tokenizers give ~1 token per 3 characters of Spanish or English prose (conservative). */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Rounded up to the cent, for display and for approving an estimate. */
export function ceilCents(usd: number): number {
  return Math.ceil(usd * 100 - 1e-9) / 100;
}

/** Before crawling, with no text yet: pages × a typical page. Only an order of magnitude. */
export function roughEstimateByPages(model: string, pages: number): number {
  const perPageInput = 4000;
  const perCallOutput = 6000;
  const calls = Math.max(1, Math.ceil((pages * perPageInput) / 40_000));
  return costUsd(model, pages * perPageInput + calls * 1200, calls * perCallOutput);
}

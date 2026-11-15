/**
 * List prices of the models, used to estimate what the product's model calls have
 * cost. US dollars per million tokens; reasoning tokens are billed as output and
 * are part of the providers' output counts.
 *
 * Sources, checked 2026-11-15: Anthropic's price list for the Claude models.
 * Google's price list has no entry for gemini-3.5-flash, so Gemini models are
 * priced at the highest Flash rate on that list, and a model missing from this
 * table gets the highest rate in it. Both choices make the estimate err high,
 * which is the safe direction for a number that guards a budget.
 */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PRICES: ReadonlyArray<readonly [prefix: string, price: TokenPrice]> = [
  ["claude-haiku-5-5", { inputPerMTok: 0.1, outputPerMTok: 0.5 }],
  ["claude-sonnet-5-5", { inputPerMTok: 2, outputPerMTok: 10 }],
  ["claude-opus-5-5", { inputPerMTok: 4, outputPerMTok: 20 }],
  ["gemini-", { inputPerMTok: 1.5, outputPerMTok: 7.5 }],
];

const HIGHEST: TokenPrice = { inputPerMTok: 8, outputPerMTok: 40 };

export function priceOf(model: string): TokenPrice {
  return PRICES.find(([prefix]) => model.startsWith(prefix))?.[1] ?? HIGHEST;
}

/** Estimated cost of a call (or of a sum of calls to one model), in US dollars. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceOf(model);
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

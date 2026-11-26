/**
 * D-092: a cost estimate for the policy assistant's model calls, shown before a run. List prices in USD per million
 * tokens by model family (an estimate, deliberately on the high side). POLICY_AI_PRICE_USD_PER_MTOK ("input,output")
 * overrides them for the deployment's model. Nothing here calls a model.
 */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const FAMILIES: [RegExp, TokenPrice][] = [
  [/gemini.*flash-lite/i, { inputPerMTok: 0.1, outputPerMTok: 0.4 }],
  [/gemini.*flash/i, { inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  [/gemini.*pro/i, { inputPerMTok: 2.5, outputPerMTok: 15 }],
  [/haiku/i, { inputPerMTok: 1, outputPerMTok: 5 }],
  [/sonnet/i, { inputPerMTok: 3, outputPerMTok: 15 }],
  [/opus/i, { inputPerMTok: 5, outputPerMTok: 25 }],
];
/** For a model this table doesn't know: a high price, so the estimate never understates. */
const UNKNOWN: TokenPrice = { inputPerMTok: 5, outputPerMTok: 25 };

export function modelPrice(model: string, override = ''): TokenPrice & { source: 'override' | 'list' | 'unknown_model' } {
  const parts = override.split(',').map((x) => Number(x.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n >= 0)) return { inputPerMTok: parts[0]!, outputPerMTok: parts[1]!, source: 'override' };
  const hit = FAMILIES.find(([re]) => re.test(model));
  return hit ? { ...hit[1], source: 'list' } : { ...UNKNOWN, source: 'unknown_model' };
}

/** The estimated cost of a set of calls, rounded up to the cent's hundredth. */
export function estimateUsd(calls: { inputTokens: number; outputTokens: number }[], price: TokenPrice) {
  const inputTokens = calls.reduce((s, c) => s + c.inputTokens, 0);
  const outputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
  const usd = (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
  return { inputTokens, outputTokens, estimatedUsd: Math.ceil(usd * 10_000) / 10_000 };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}
export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cachedInputUsdPerMTok?: number;
  cacheWriteUsdPerMTok?: number;
  verified: boolean;
}
const HIGH_UNVERIFIED_PRICE = { inputUsdPerMTok: 25, outputUsdPerMTok: 100, cachedInputUsdPerMTok: 25, cacheWriteUsdPerMTok: 100, verified: false } as const;
export const MODEL_PRICING: Record<string, ModelPrice> = {
  qwen: { inputUsdPerMTok: 0, outputUsdPerMTok: 0, cachedInputUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, verified: true },
  llama: { inputUsdPerMTok: 0, outputUsdPerMTok: 0, cachedInputUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, verified: true },
  nemotron: { inputUsdPerMTok: 0, outputUsdPerMTok: 0, cachedInputUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, verified: true },
  deepseek: { inputUsdPerMTok: 0, outputUsdPerMTok: 0, cachedInputUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, verified: true },
  gemma: { inputUsdPerMTok: 0, outputUsdPerMTok: 0, cachedInputUsdPerMTok: 0, cacheWriteUsdPerMTok: 0, verified: true },

  // Official Google Gemini API pricing, checked 2026-10-13: https://ai.google.dev/gemini-api/docs/pricing
  // Standard paid-tier rates through 2026-12-31; Google's page lists increases beginning 2027-01-01.
  flash: { inputUsdPerMTok: 0.75, outputUsdPerMTok: 3.75, cachedInputUsdPerMTok: 0.075, verified: true },
  flash37: { inputUsdPerMTok: 0.75, outputUsdPerMTok: 3.75, cachedInputUsdPerMTok: 0.075, verified: true },
  flashlite: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5, cachedInputUsdPerMTok: 0.03, verified: true },
  pro: { inputUsdPerMTok: 4, outputUsdPerMTok: 18, cachedInputUsdPerMTok: 0.4, verified: true },

  // Official Anthropic Claude API pricing, checked 2026-10-13: https://platform.claude.com/docs/en/about-claude/pricing
  // Cache-write rates use the requested standard 5-minute cache-write prices (1.25x input except where noted by Anthropic).
  fable: { inputUsdPerMTok: 10, outputUsdPerMTok: 50, cachedInputUsdPerMTok: 0.25, cacheWriteUsdPerMTok: 12.5, verified: true },
  opus: { inputUsdPerMTok: 4, outputUsdPerMTok: 20, cachedInputUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 5, verified: true },
  opus5: { inputUsdPerMTok: 5, outputUsdPerMTok: 25, cachedInputUsdPerMTok: 0.5, cacheWriteUsdPerMTok: 6.25, verified: true },
  sonnet: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 2.5, verified: true },
  sonnet5: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 2.5, verified: true },
  haiku: { inputUsdPerMTok: 1, outputUsdPerMTok: 5, cachedInputUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 1.25, verified: true },

  // Official OpenAI API pricing, checked 2026-10-13: https://openai.com/api/pricing/
  sol: { inputUsdPerMTok: 5, outputUsdPerMTok: 30, cachedInputUsdPerMTok: 0.5, verified: true },
  terra: { inputUsdPerMTok: 2, outputUsdPerMTok: 12, cachedInputUsdPerMTok: 0.2, verified: true },
  luna: { inputUsdPerMTok: 0.2, outputUsdPerMTok: 1.2, cachedInputUsdPerMTok: 0.02, verified: true },

  // No confirmed official published price for these configured model IDs as of 2026-10-13.
  gpt6sol: { ...HIGH_UNVERIFIED_PRICE },
  gpt6luna: { ...HIGH_UNVERIFIED_PRICE },
  gpt55: { ...HIGH_UNVERIFIED_PRICE },
  gpt54: { ...HIGH_UNVERIFIED_PRICE },
  gpt54mini: { ...HIGH_UNVERIFIED_PRICE },
  gpt53codex: { ...HIGH_UNVERIFIED_PRICE },
};
export function computeCostUsd(modelCode: string, usage: TokenUsage): number {
  const p = MODEL_PRICING[modelCode] ?? HIGH_UNVERIFIED_PRICE;
  const input = Math.max(0, usage.inputTokens || 0);
  const output = Math.max(0, usage.outputTokens || 0);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens || 0));
  const cacheWrite = Math.min(Math.max(0, input - cached), Math.max(0, usage.cacheCreationInputTokens || 0));
  const normalInput = Math.max(0, input - cached - cacheWrite);
  // Missing cache-write pricing is treated conservatively as 2x normal input pricing.
  const cacheWriteRate = p.cacheWriteUsdPerMTok ?? p.inputUsdPerMTok * 2;
  const value = (
    normalInput * p.inputUsdPerMTok +
    cached * (p.cachedInputUsdPerMTok ?? p.inputUsdPerMTok) +
    cacheWrite * cacheWriteRate +
    output * p.outputUsdPerMTok
  ) / 1_000_000;
  return Math.round(value * 1_000_000) / 1_000_000;
}

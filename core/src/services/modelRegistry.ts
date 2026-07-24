import { env } from '../config/env';

export type Provider = 'gemini' | 'anthropic' | 'openai' | 'openweights' | 'gemma-google';

export interface ModelOption {
  code: string;
  provider: Provider;
  modelId: string;
  tier: 'free' | 'limited' | 'premium';
  /** Credits deducted from the monthly pool per message, until real billing exists. */
  creditCost: number;
  /** Hard cap on requests/month for this specific model, independent of the credit pool. */
  requestCap?: number;
  /** Free-plan users can only use models where this is false. */
  requiresPaidPlan: boolean;
  label: string;
}

// NOTE: model IDs drift as providers deprecate old versions (we already hit
// this with gemini-1.5-flash, and OpenRouter's ":free" catalog rotates even
// faster). If a model here starts 404ing, check the provider's current
// model list and update just the `modelId` field — the user-facing `code`
// never needs to change.
export const REGISTRY: ModelOption[] = [
  // True free tier: open-weight models via OpenRouter's $0 ":free" catalog —
  // these cost KingxTech nothing per request, unlike everything below. Free
  // (unpaid) users can ONLY use these. Still costs a few credits per
  // message so a single user can't monopolize the shared OpenRouter quota.
  { code: 'qwen', provider: 'openweights', modelId: env.QWEN_MODEL_ID, tier: 'free', creditCost: 3, requiresPaidPlan: false, label: 'Qwen3 Coder (free)' },
  { code: 'llama', provider: 'openweights', modelId: env.LLAMA_MODEL_ID, tier: 'free', creditCost: 3, requiresPaidPlan: false, label: 'Llama 3.3 (free)' },
  { code: 'nemotron', provider: 'openweights', modelId: env.NEMOTRON_MODEL_ID, tier: 'free', creditCost: 3, requiresPaidPlan: false, label: 'Nemotron 3 Nano (free)' },
  // Routed through Google's own Gemini API (not OpenRouter) using a
  // separate free-tier key — see providers/gemmaGoogle.ts.
  { code: 'gemma', provider: 'gemma-google', modelId: env.GEMMA_MODEL_ID, tier: 'free', creditCost: 3, requiresPaidPlan: false, label: 'Gemma 4 31B (free, Google)' },

  // Everything below requires a paid plan — either it costs KingxTech real
  // money per call (Gemini), or it's a premium third-party model.
  { code: 'flash', provider: 'gemini', modelId: 'gemini-3.5-flash', tier: 'limited', creditCost: 1, requestCap: 5, requiresPaidPlan: true, label: 'Gemini 3.5 Flash' },
  { code: 'pro', provider: 'gemini', modelId: 'gemini-3.1-pro-preview', tier: 'premium', creditCost: 6, requiresPaidPlan: true, label: 'Gemini 3.1 Pro' },
  { code: 'sonnet', provider: 'anthropic', modelId: 'claude-sonnet-5', tier: 'premium', creditCost: 8, requiresPaidPlan: true, label: 'Claude Sonnet 5' },
  { code: 'opus', provider: 'anthropic', modelId: 'claude-opus-4-8', tier: 'premium', creditCost: 15, requiresPaidPlan: true, label: 'Claude Opus 4.8' },
  { code: 'haiku', provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001', tier: 'premium', creditCost: 3, requiresPaidPlan: true, label: 'Claude Haiku 4.5' },
  { code: 'fable', provider: 'anthropic', modelId: 'claude-fable-5', tier: 'premium', creditCost: 10, requiresPaidPlan: true, label: 'Claude Fable 5' },
  { code: 'sol', provider: 'openai', modelId: 'gpt-5.6-sol', tier: 'premium', creditCost: 10, requiresPaidPlan: true, label: 'GPT-5.6 Sol' },
  { code: 'terra', provider: 'openai', modelId: 'gpt-5.6-terra', tier: 'premium', creditCost: 6, requiresPaidPlan: true, label: 'GPT-5.6 Terra' },
  { code: 'luna', provider: 'openai', modelId: 'gpt-5.6-luna', tier: 'premium', creditCost: 2, requiresPaidPlan: true, label: 'GPT-5.6 Luna' },
];

const PREFIXES: Record<string, Provider> = { g: 'gemini', c: 'anthropic', o: 'openai', q: 'openweights', d: 'gemma-google' };
const PREFIX_BY_PROVIDER: Record<Provider, string> = { gemini: 'G', anthropic: 'C', openai: 'O', openweights: 'Q', 'gemma-google': 'D' };

export const FREE_MODEL = REGISTRY.find((m) => m.tier === 'free')!;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ParsedModelRequest {
  model: ModelOption;
  cleanPrompt: string;
  unknownTag?: string;
}

/**
 * Parses an optional leading model tag like ":G-flash/" or ":C-fable/" off
 * the front of a prompt. Falls back to the free model if no tag is present,
 * or if the tag doesn't match anything (with unknownTag set so the caller
 * can let the user know).
 */
export function parseModelTag(prompt: string): ParsedModelRequest {
  const match = prompt.match(/^:([A-Za-z]+)-([^/]+)\/\s*/);
  if (!match) return { model: FREE_MODEL, cleanPrompt: prompt };

  const [full, prefixRaw, codeRaw] = match;
  const provider = PREFIXES[prefixRaw.toLowerCase()];
  const code = normalize(codeRaw);
  const cleanPrompt = prompt.slice(full.length);

  let found = provider ? REGISTRY.find((m) => m.provider === provider && normalize(m.code) === code) : undefined;
  if (!found) found = REGISTRY.find((m) => normalize(m.code) === code || normalize(m.modelId) === code);

  if (!found) return { model: FREE_MODEL, cleanPrompt, unknownTag: full.trim() };
  return { model: found, cleanPrompt };
}

export function tagForModel(m: ModelOption): string {
  return `:${PREFIX_BY_PROVIDER[m.provider]}-${m.code}/`;
}

export function listModelsForClient() {
  return REGISTRY.map((m) => ({
    tag: tagForModel(m),
    label: m.label,
    tier: m.tier,
    creditCost: m.creditCost,
    requestCap: m.requestCap ?? null,
    requiresPaidPlan: m.requiresPaidPlan,
  }));
}

// Decides which model K-XpertAI uses when the person did not pick one with a :tag/.
//
// Money safety rules (do not loosen without checking the numbers):
//  1. Free plan always gets the free model.
//  2. Paid plans only get a paid model automatically when usage limits are being
//     ENFORCED (AI_USAGE_MODE=enforce). Otherwise nothing caps the spend, so we
//     stay on the free model.
//  3. Only models with a verified price may appear in a ladder (see the test).
//  4. As the session/week allowance fills up, Auto steps down to cheaper models and
//     ends on a free one, so people slow down gracefully instead of hitting a wall.
import { modelTierAllowed } from './usagePolicy';
import type { UsageTier, MinimumTier } from './usagePolicy';

export type RouterPreference = 'auto' | 'best' | 'free';

export interface RoutableModel { code: string; minTier: MinimumTier }
export interface LadderStep { code: string; /** use this step while usage is below this fraction (0-1) */ below: number }

export const FREE_CODE = 'qwen';
export const PAID_FALLBACK_CODE = 'gemma';

export const ROUTING_LADDERS: Record<'pro' | 'pro_plus', Record<'auto' | 'best', LadderStep[]>> = {
  pro: {
    auto: [{ code: 'sonnet5', below: 0.7 }, { code: PAID_FALLBACK_CODE, below: Infinity }],
    best: [{ code: 'sonnet5', below: 0.9 }, { code: PAID_FALLBACK_CODE, below: Infinity }],
  },
  pro_plus: {
    auto: [{ code: 'opus5', below: 0.6 }, { code: 'sonnet5', below: 0.85 }, { code: PAID_FALLBACK_CODE, below: Infinity }],
    best: [{ code: 'opus5', below: 0.9 }, { code: PAID_FALLBACK_CODE, below: Infinity }],
  },
};

/** Saved values from the old screen ('neurocore', 'opensource') keep working. */
export function normalizePreference(raw: unknown): RouterPreference {
  if (raw === 'best' || raw === 'neurocore') return 'best';
  if (raw === 'free' || raw === 'opensource') return 'free';
  return 'auto';
}

/** Highest fraction (0-1+) of the current session or week allowance already used. */
export function usageFraction(
  state: { sessionStart: string | null; sessionSpentUsd: number; weekStart: string | null; weekSpentUsd: number },
  limits: { sessionHours: number; sessionBudgetUsd: number; weekDays: number; weekBudgetUsd: number },
  now: number
): number {
  const sessionActive = state.sessionStart && new Date(state.sessionStart).getTime() + limits.sessionHours * 3600000 > now;
  const weekActive = state.weekStart && new Date(state.weekStart).getTime() + limits.weekDays * 86400000 > now;
  const s = sessionActive && limits.sessionBudgetUsd > 0 ? state.sessionSpentUsd / limits.sessionBudgetUsd : 0;
  const w = weekActive && limits.weekBudgetUsd > 0 ? state.weekSpentUsd / limits.weekBudgetUsd : 0;
  return Math.max(0, s, w);
}

export function resolveRoutedModel<T extends RoutableModel>(input: {
  tier: UsageTier;
  preference: RouterPreference;
  usageFraction: number;
  enforced: boolean;
  models: readonly T[];
}): T {
  const find = (code: string) => input.models.find((m) => m.code === code);
  const free = find(FREE_CODE);
  if (!free) throw new Error(`Default model ${FREE_CODE} is missing from the registry.`);
  if (input.tier === 'free' || input.preference === 'free') return free;

  const paidFallback = find(PAID_FALLBACK_CODE) ?? free;
  if (!input.enforced) return paidFallback;

  const ladder = ROUTING_LADDERS[input.tier][input.preference];
  for (const step of ladder) {
    if (input.usageFraction >= step.below) continue;
    const model = find(step.code);
    if (model && modelTierAllowed(input.tier, model.minTier)) return model;
  }
  return paidFallback;
}

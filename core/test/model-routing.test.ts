import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRoutedModel, normalizePreference, usageFraction, ROUTING_LADDERS, FREE_CODE } from '../src/services/modelRouting';
import { MODEL_PRICING } from '../src/config/modelPricing';

const models = [
  { code: 'qwen', minTier: 'free' as const }, { code: 'gemma', minTier: 'free' as const },
  { code: 'sonnet5', minTier: 'pro' as const }, { code: 'opus5', minTier: 'pro' as const },
];
const pick = (tier: any, preference: any, f: number, enforced = true) =>
  resolveRoutedModel({ tier, preference, usageFraction: f, enforced, models }).code;

test('free plan and the free preference always use the free model', () => {
  assert.equal(pick('free', 'auto', 0), 'qwen');
  assert.equal(pick('free', 'best', 0), 'qwen');
  assert.equal(pick('pro', 'free', 0), 'qwen');
  assert.equal(pick('pro_plus', 'free', 0), 'qwen');
});

test('paid models are only used automatically when limits are enforced', () => {
  assert.equal(pick('pro', 'auto', 0, false), 'gemma');
  assert.equal(pick('pro_plus', 'best', 0, false), 'gemma');
});

test('Auto steps down as the allowance fills up', () => {
  assert.equal(pick('pro', 'auto', 0.1), 'sonnet5');
  assert.equal(pick('pro', 'auto', 0.7), 'gemma');
  assert.equal(pick('pro_plus', 'auto', 0.1), 'opus5');
  assert.equal(pick('pro_plus', 'auto', 0.6), 'sonnet5');
  assert.equal(pick('pro_plus', 'auto', 0.85), 'gemma');
  assert.equal(pick('pro_plus', 'auto', 5), 'gemma');
});

test('Best quality holds the strong model longer, then falls back to free', () => {
  assert.equal(pick('pro', 'best', 0.85), 'sonnet5');
  assert.equal(pick('pro', 'best', 0.95), 'gemma');
});

test('a ladder model missing from the registry falls back safely', () => {
  const r = resolveRoutedModel({ tier: 'pro', preference: 'auto', usageFraction: 0, enforced: true, models: models.filter((m) => m.code !== 'sonnet5') });
  assert.equal(r.code, 'gemma');
});

test('old saved preference names still work', () => {
  assert.equal(normalizePreference('neurocore'), 'best');
  assert.equal(normalizePreference('opensource'), 'free');
  assert.equal(normalizePreference(undefined), 'auto');
  assert.equal(normalizePreference('weird'), 'auto');
});

test('usageFraction uses the busier window and ignores expired ones', () => {
  const limits = { sessionHours: 5, sessionBudgetUsd: 1, weekDays: 7, weekBudgetUsd: 2 };
  const now = Date.parse('2026-10-24T12:00:00Z');
  const recent = '2026-10-24T10:00:00Z';
  assert.equal(usageFraction({ sessionStart: recent, sessionSpentUsd: 0.5, weekStart: recent, weekSpentUsd: 1.5 }, limits, now), 0.75);
  assert.equal(usageFraction({ sessionStart: '2026-10-20T00:00:00Z', sessionSpentUsd: 9, weekStart: recent, weekSpentUsd: 0.2 }, limits, now), 0.1);
  assert.equal(usageFraction({ sessionStart: null, sessionSpentUsd: 0, weekStart: null, weekSpentUsd: 0 }, limits, now), 0);
});

// Money guard: anything Auto can pick must have a price KingxTech has verified.
// If this fails, someone added a model whose real cost is unknown (it is billed at a
// very high worst-case rate), which can quickly eat a Pro plan's margin.
test('every model in a routing ladder has a verified, non-zero-risk price', () => {
  for (const tier of Object.values(ROUTING_LADDERS)) {
    for (const ladder of Object.values(tier)) {
      for (const step of ladder) {
        const price = MODEL_PRICING[step.code];
        assert.ok(price, `${step.code} has no price`);
        assert.equal(price.verified, true, `${step.code} price is not verified`);
      }
      assert.ok(ladder[ladder.length - 1].below === Infinity, 'ladder must end on a catch-all step');
      const last = MODEL_PRICING[ladder[ladder.length - 1].code];
      assert.equal(last.inputUsdPerMTok + last.outputUsdPerMTok, 0, 'ladder must end on a free model');
    }
  }
  assert.equal(MODEL_PRICING[FREE_CODE].outputUsdPerMTok, 0);
});

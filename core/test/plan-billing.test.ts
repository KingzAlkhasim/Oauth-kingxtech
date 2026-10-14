import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRO_PLAN_PRICE_USD,
  addPlanDays,
  canPayFromWallet,
  effectivePlan,
  extendPlanExpiry,
  shouldAcceptPaystackPayment,
} from '../src/services/planBilling';

test('30 days are added from now when there is no active plan', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(extendPlanExpiry(now, null).toISOString(), '2026-11-13T12:00:00.000Z');
});

test('early renewal extends from the current expiry', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const expiry = new Date('2026-10-24T12:00:00.000Z');
  assert.equal(extendPlanExpiry(now, expiry).toISOString(), '2026-11-23T12:00:00.000Z');
});

test('expired plan reads as free', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(effectivePlan({ plan: 'pro', isProMember: true, planExpiresAt: '2026-10-13T12:00:00.000Z' }, now), 'free');
});

test('active pro plus remains pro plus', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(effectivePlan({ plan: 'pro_plus', isProMember: true, planExpiresAt: '2026-11-13T12:00:00.000Z' }, now), 'pro_plus');
});

test('underpaid amount and wrong currency are rejected', () => {
  assert.equal(shouldAcceptPaystackPayment(2_999_999, 'NGN', 3_000_000, 'NGN', 'success'), false);
  assert.equal(shouldAcceptPaystackPayment(3_000_000, 'USD', 3_000_000, 'NGN', 'success'), false);
  assert.equal(shouldAcceptPaystackPayment(3_000_000, 'NGN', 3_000_000, 'NGN', 'failed'), false);
});

test('exact or overpaid amount in the expected currency is accepted', () => {
  assert.equal(shouldAcceptPaystackPayment(3_000_000, 'NGN', 3_000_000, 'NGN', 'success'), true);
  assert.equal(shouldAcceptPaystackPayment(3_000_100, 'NGN', 3_000_000, 'NGN', 'success'), true);
});

test('wallet renewal requires the full Pro price', () => {
  assert.equal(PRO_PLAN_PRICE_USD, 20);
  assert.equal(canPayFromWallet(19.99), false);
  assert.equal(canPayFromWallet(20), true);
});

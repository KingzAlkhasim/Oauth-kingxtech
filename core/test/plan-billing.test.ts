import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRO_PLAN_PRICE_USD,
  addPlanDays,
  applyCreditTopup,
  applyPlanPayment,
  applyWalletPayment,
  canPayFromWallet,
  effectivePlan,
  extendPlanExpiry,
  revokePlan,
  shouldAcceptPaystackPayment,
} from '../src/services/planBilling';

const baseState = {
  plan: 'free' as const,
  isProMember: false,
  planExpiresAt: null,
  walletBalance: 25,
  lastPaymentReference: null,
};

test('30 days are added from now when there is no active plan', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(extendPlanExpiry(now, null).toISOString(), '2026-11-13T12:00:00.000Z');
});

test('early renewal extends from the current expiry', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const expiry = new Date('2026-10-24T12:00:00.000Z');
  assert.equal(extendPlanExpiry(now, expiry).toISOString(), '2026-11-23T12:00:00.000Z');
});

test('plan payment converts the state expiry string to a Date before extending', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const paid = applyPlanPayment({
    ...baseState,
    planExpiresAt: '2026-10-24T12:00:00.000Z',
  }, now, 'ref-date');
  assert.equal(paid.planExpiresAt, '2026-11-23T12:00:00.000Z');
});

test('repeated payment reference is a no-op', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const paid = applyPlanPayment(baseState, now, 'ref-1');
  assert.deepEqual(applyPlanPayment(paid, now, 'ref-1'), paid);
});

test('expired plan reads as free', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(effectivePlan({ ...baseState, plan: 'pro', isProMember: true, planExpiresAt: '2026-10-13T12:00:00.000Z' }, now), 'free');
});

test('active pro plus remains pro plus', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  assert.equal(effectivePlan({ ...baseState, plan: 'pro_plus', isProMember: true, planExpiresAt: '2026-11-13T12:00:00.000Z' }, now), 'pro_plus');
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

test('Pro payment never credits the wallet', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const paid = applyPlanPayment(baseState, now, 'pro-ref');
  assert.equal(paid.walletBalance, 25);
  assert.equal(paid.plan, 'pro');
});

test('top-up credits the wallet once', () => {
  const toppedUp = applyCreditTopup(baseState, 'topup-ref', 10);
  assert.equal(toppedUp.walletBalance, 35);
  assert.deepEqual(applyCreditTopup(toppedUp, 'topup-ref', 10), toppedUp);
});

test('refund revokes Pro', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const paid = applyPlanPayment(baseState, now, 'pro-ref');
  const revoked = revokePlan(paid);
  assert.equal(revoked.plan, 'free');
  assert.equal(revoked.isProMember, false);
});

test('wallet payment with insufficient balance changes nothing', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const result = applyWalletPayment({ ...baseState, walletBalance: 19.99 }, now, 'wallet-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, { ...baseState, walletBalance: 19.99 });
});

test('same wallet idempotency key debits once', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const first = applyWalletPayment(baseState, now, 'wallet-1');
  assert.equal(first.ok, true);
  assert.equal(first.state.walletBalance, 5);
  const second = applyWalletPayment(first.state, now, 'wallet-1');
  assert.deepEqual(second.state, first.state);
  assert.equal(second.state.walletBalance, 5);
});

test('wallet payment uses the fixed $20 Pro price by default', () => {
  assert.equal(PRO_PLAN_PRICE_USD, 20);
  assert.equal(addPlanDays(new Date('2026-10-14T00:00:00.000Z')).toISOString(), '2026-11-13T00:00:00.000Z');
  assert.equal(canPayFromWallet(19.99), false);
  assert.equal(canPayFromWallet(20), true);
});

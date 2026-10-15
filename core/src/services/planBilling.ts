import { PRO_PLAN_PRICE_USD } from '../config/billing';

export { PRO_PLAN_PRICE_USD };
export const PRO_PLAN_DAYS = 30;

export type BillingPlan = 'free' | 'paid' | 'pro' | 'pro_plus';

export interface PlanState {
  plan: BillingPlan;
  isProMember: boolean;
  planExpiresAt: string | null;
  walletBalance: number;
  lastPaymentReference: string | null;
}

export function addPlanDays(base: Date, days = PRO_PLAN_DAYS): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function extendPlanExpiry(now: Date, existingExpiry: Date | null): Date {
  const base = existingExpiry && existingExpiry.getTime() > now.getTime() ? existingExpiry : now;
  return addPlanDays(base);
}

export function isPlanExpired(planExpiresAt: string | null, now: Date): boolean {
  return Boolean(planExpiresAt && new Date(planExpiresAt).getTime() < now.getTime());
}

export function effectivePlan(state: PlanState, now: Date): 'free' | 'pro' | 'pro_plus' {
  if (isPlanExpired(state.planExpiresAt, now)) return 'free';
  if (state.plan === 'pro_plus') return 'pro_plus';
  if (state.plan === 'pro' || state.plan === 'paid' || state.isProMember) return 'pro';
  return 'free';
}

export function shouldAcceptPaystackPayment(
  actualAmountMinor: number,
  actualCurrency: string,
  expectedAmountMinor: number,
  expectedCurrency: string,
  status: string,
): boolean {
  return status === 'success'
    && actualCurrency === expectedCurrency
    && actualAmountMinor >= expectedAmountMinor;
}

export function canPayFromWallet(balance: number, price = PRO_PLAN_PRICE_USD): boolean {
  return balance >= price;
}

export function applyPlanPayment(
  state: PlanState,
  now: Date,
  reference: string,
  plan: 'pro' | 'pro_plus' = 'pro',
): PlanState {
  if (state.lastPaymentReference === reference) return state;
  return {
    ...state,
    plan,
    isProMember: true,
    planExpiresAt: extendPlanExpiry(now, state.planExpiresAt ? new Date(state.planExpiresAt) : null).toISOString(),
    lastPaymentReference: reference,
  };
}

export function applyWalletPayment(
  state: PlanState,
  now: Date,
  idempotencyKey: string,
  price = PRO_PLAN_PRICE_USD,
): { ok: boolean; state: PlanState } {
  if (state.lastPaymentReference === idempotencyKey) return { ok: true, state };
  if (!canPayFromWallet(state.walletBalance, price)) return { ok: false, state };

  const paid = applyPlanPayment(
    { ...state, walletBalance: state.walletBalance - price },
    now,
    idempotencyKey,
  );
  return { ok: true, state: paid };
}

export function revokePlan(state: PlanState, now = new Date()): PlanState {
  return {
    ...state,
    plan: 'free',
    isProMember: false,
    planExpiresAt: now.toISOString(),
  };
}

export function applyCreditTopup(
  state: PlanState,
  reference: string,
  usdAmount: number,
): PlanState {
  if (state.lastPaymentReference === reference) return state;
  return {
    ...state,
    walletBalance: state.walletBalance + usdAmount,
    lastPaymentReference: reference,
  };
}

import { supabase } from './supabase';
import { apiUrl } from './apiBase';

export async function getBillingProfile() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { data: null, error: new Error('Not signed in') };
  return supabase.from('billing_profile').select('*').eq('user_id', userData.user.id).single();
}

export async function initializePaystackCheckout() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');

  const res = await fetch(apiUrl('/api/billing/paystack/initialize'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to start checkout');
  return data.authorization_url;
}

export async function initializePaystackTopup(amountUsd) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');

  const res = await fetch(apiUrl('/api/billing/paystack/topup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ amountUsd }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to start checkout');
  return data.authorization_url;
}

async function callBillingRoute(path, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');

  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Billing operation failed');
  return data;
}

export function cancelProPlan() {
  return callBillingRoute('/api/billing/cancel');
}

export function resumeProPlan() {
  return callBillingRoute('/api/billing/resume');
}

export function payProFromWallet(idempotencyKey) {
  return callBillingRoute('/api/billing/pay-pro-with-wallet', { idempotencyKey });
}

export async function chargeUser(cost) {
  return supabase.rpc('charge_user', { cost });
}

export const CHECKOUT_LINKS = {
  paystack: import.meta.env.VITE_PAYSTACK_CHECKOUT_URL || null,
};

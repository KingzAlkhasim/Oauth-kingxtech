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

export async function convertToCredits(usdAmount) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');

  const res = await fetch(apiUrl('/api/billing/convert-to-credits'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ usdAmount }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to convert to credits');
  return data;
}

export async function chargeUser(cost) {
  return supabase.rpc('charge_user', { cost });
}

export const CHECKOUT_LINKS = {
  lemonsqueezy: import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL || null,
  paystack: import.meta.env.VITE_PAYSTACK_CHECKOUT_URL || null,
};

export function checkoutUrlWithUser(baseUrl, userId, email) {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  url.searchParams.set('checkout[custom][user_id]', userId);
  if (email) url.searchParams.set('checkout[email]', email);
  return url.toString();
}

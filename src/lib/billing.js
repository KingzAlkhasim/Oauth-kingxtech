import { supabase } from './supabase';

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';

export async function getBillingProfile() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { data: null, error: new Error('Not signed in') };
  return supabase.from('billing_profile').select('*').eq('user_id', userData.user.id).single();
}

/**
 * Starts a real Paystack transaction (server-side, with your account's
 * user_id attached as metadata) and returns the URL to redirect the browser
 * to. Crediting happens separately, via the billing-webhook Edge Function,
 * once Paystack confirms the payment.
 */
export async function initializePaystackCheckout() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');

  const res = await fetch(`${API_BASE}/api/billing/paystack/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to start checkout');
  return data.authorization_url;
}

/**
 * The real credit-gate call — atomically deducts `cost` if there's enough
 * balance. Use this before any "premium" action. Mirrors an HTTP 402 gate
 * since this project has no Express server to put that middleware on.
 */
export async function chargeUser(cost) {
  return supabase.rpc('charge_user', { cost });
}

/**
 * Hosted checkout links. These are genuinely functional IF you configure
 * real product URLs from your payment gateway dashboards — set them as
 * Vite env vars. Left blank, the Billing page shows "not configured"
 * instead of a dead or fake button.
 */
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

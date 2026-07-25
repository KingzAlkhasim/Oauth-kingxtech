// Supabase Edge Function: billing-webhook
// Deploy with:  supabase functions deploy billing-webhook --no-verify-jwt
// (--no-verify-jwt because payment gateways call this anonymously — the
// security boundary here is the per-gateway signature check below, not
// Supabase's own JWT auth.)
//
// Required secrets (supabase secrets set KEY=value):
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (NEVER the anon key)
//   LEMONSQUEEZY_WEBHOOK_SECRET — from LemonSqueezy → Settings → Webhooks
//   PADDLE_WEBHOOK_SECRET       — from Paddle → Developer Tools → Notifications
//   PAYSTACK_SECRET_KEY         — from Paystack dashboard (sk_live_… / sk_test_…)
//   FLUTTERWAVE_SECRET_HASH     — the secret hash you set in Flutterwave's webhook settings
//
// Nothing here fabricates a successful payment — if a signature doesn't
// verify, the request is rejected with 401 and nothing is credited.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const PRO_PLAN_USD = 20.0;
const PRO_PLAN_USD_TOLERANCE = 2.0; // allow FX slippage before treating a local payment as "the Pro Plan"

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string, hash: 'SHA-256' | 'SHA-512' = 'SHA-256') {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyLemonSqueezy(rawBody: string, signatureHeader: string | null) {
  const secret = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET');
  if (!secret || !signatureHeader) return false;
  const expected = await hmacHex(secret, rawBody, 'SHA-256');
  return timingSafeEqual(expected, signatureHeader);
}

async function verifyPaddle(rawBody: string, signatureHeader: string | null) {
  const secret = Deno.env.get('PADDLE_WEBHOOK_SECRET');
  if (!secret || !signatureHeader) return false;
  // Paddle's header looks like: "ts=1730000000;h1=<hex hmac>"
  const parts = Object.fromEntries(signatureHeader.split(';').map((p) => p.split('=') as [string, string]));
  if (!parts.ts || !parts.h1) return false;
  const expected = await hmacHex(secret, `${parts.ts}:${rawBody}`, 'SHA-256');
  return timingSafeEqual(expected, parts.h1);
}

async function verifyPaystack(rawBody: string, signatureHeader: string | null) {
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret || !signatureHeader) return false;
  const expected = await hmacHex(secret, rawBody, 'SHA-512');
  return timingSafeEqual(expected, signatureHeader);
}

function verifyFlutterwave(signatureHeader: string | null) {
  const secret = Deno.env.get('FLUTTERWAVE_SECRET_HASH');
  if (!secret || !signatureHeader) return false;
  return timingSafeEqual(secret, signatureHeader);
}

/** Live FX conversion. Falls back to a fixed rate table if the API call fails. */
async function toUsd(amount: number, currency: string): Promise<number> {
  if (currency === 'USD') return amount;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
    const json = await res.json();
    const rate = json?.rates?.USD;
    if (typeof rate === 'number') return amount * rate;
  } catch (_e) {
    // fall through to fallback table below
  }
  const FALLBACK_RATES: Record<string, number> = { NGN: 1 / 1600, GHS: 1 / 15, KES: 1 / 145, ZAR: 1 / 18 };
  const rate = FALLBACK_RATES[currency];
  if (!rate) throw new Error(`No FX rate available for ${currency} — payment recorded but not converted`);
  return amount * rate;
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('billing_events').select('id').eq('id', eventId).maybeSingle();
  return !!data;
}

async function recordEvent(eventId: string, gateway: string, userId: string | null, amountUsd: number, rawType: string) {
  await supabaseAdmin.from('billing_events').insert({ id: eventId, gateway, user_id: userId, amount_usd: amountUsd, raw_type: rawType });
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

async function creditWallet(userId: string, usdAmount: number, gateway: string, gatewayRef?: string, treatAsPro?: boolean) {
  const { data: profile } = await supabaseAdmin.from('billing_profile').select('credit_balance').eq('user_id', userId).single();
  const newBalance = (profile?.credit_balance ?? 0) + usdAmount;

  await supabaseAdmin
    .from('billing_profile')
    .update({
      credit_balance: newBalance,
      is_pro_member: treatAsPro ? true : undefined,
      payment_gateway_used: gateway,
      gateway_customer_reference: gatewayRef,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();

  // ---- Global vector: LemonSqueezy ----
  if (req.headers.get('x-signature')) {
    console.log('[billing-webhook] Detected LemonSqueezy request (x-signature header present)');
    const valid = await verifyLemonSqueezy(rawBody, req.headers.get('x-signature'));
    console.log('[billing-webhook] LemonSqueezy signature valid:', valid);
    if (!valid) return new Response('Invalid signature', { status: 401 });

    const payload = JSON.parse(rawBody);
    const eventId = String(payload.data?.id ?? crypto.randomUUID());
    if (await alreadyProcessed(eventId)) {
      console.log('[billing-webhook] Duplicate event, skipping:', eventId);
      return new Response('OK (duplicate)', { status: 200 });
    }

    const eventName = payload.meta?.event_name;
    console.log('[billing-webhook] LemonSqueezy event:', eventName);
    if (eventName === 'order_created' || eventName === 'subscription_payment_success') {
      const userId = payload.meta?.custom_data?.user_id
        ?? (payload.data?.attributes?.user_email ? await findUserIdByEmail(payload.data.attributes.user_email) : null);
      console.log('[billing-webhook] Resolved userId:', userId);
      if (userId) {
        await creditWallet(userId, PRO_PLAN_USD, 'lemonsqueezy', String(payload.data?.attributes?.customer_id ?? ''), true);
        await recordEvent(eventId, 'lemonsqueezy', userId, PRO_PLAN_USD, eventName);
        console.log('[billing-webhook] Credited wallet for user:', userId);
      } else {
        console.error('[billing-webhook] Could not resolve a userId — nothing credited.');
      }
    }
    return new Response('OK', { status: 200 });
  }

  // ---- Global vector: Paddle ----
  if (req.headers.get('paddle-signature')) {
    console.log('[billing-webhook] Detected Paddle request (paddle-signature header present)');
    const valid = await verifyPaddle(rawBody, req.headers.get('paddle-signature'));
    console.log('[billing-webhook] Paddle signature valid:', valid);
    if (!valid) return new Response('Invalid signature', { status: 401 });

    const payload = JSON.parse(rawBody);
    const eventId = String(payload.event_id ?? crypto.randomUUID());
    if (await alreadyProcessed(eventId)) {
      console.log('[billing-webhook] Duplicate event, skipping:', eventId);
      return new Response('OK (duplicate)', { status: 200 });
    }

    console.log('[billing-webhook] Paddle event:', payload.event_type);
    if (payload.event_type === 'transaction.completed') {
      const userId = payload.data?.custom_data?.user_id ?? null;
      console.log('[billing-webhook] Resolved userId:', userId);
      if (userId) {
        await creditWallet(userId, PRO_PLAN_USD, 'paddle', String(payload.data?.customer_id ?? ''), true);
        await recordEvent(eventId, 'paddle', userId, PRO_PLAN_USD, payload.event_type);
        console.log('[billing-webhook] Credited wallet for user:', userId);
      } else {
        console.error('[billing-webhook] Could not resolve a userId — nothing credited.');
      }
    }
    return new Response('OK', { status: 200 });
  }

  // ---- Local vector: Paystack ----
  if (req.headers.get('x-paystack-signature')) {
    console.log('[billing-webhook] Detected Paystack request (x-paystack-signature header present)');
    const valid = await verifyPaystack(rawBody, req.headers.get('x-paystack-signature'));
    console.log('[billing-webhook] Paystack signature valid:', valid);
    if (!valid) {
      console.error('[billing-webhook] Paystack signature mismatch — check PAYSTACK_SECRET_KEY matches the key used to initialize the transaction (test vs live).');
      return new Response('Invalid signature', { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventId = String(payload.data?.id ?? crypto.randomUUID());
    if (await alreadyProcessed(eventId)) {
      console.log('[billing-webhook] Duplicate event, skipping:', eventId);
      return new Response('OK (duplicate)', { status: 200 });
    }

    console.log('[billing-webhook] Paystack event:', payload.event);
    if (payload.event === 'charge.success') {
      const amountLocal = (payload.data?.amount ?? 0) / 100; // kobo → naira (or equivalent minor unit)
      const currency = payload.data?.currency ?? 'NGN';
      const userId = payload.data?.metadata?.user_id
        ?? (payload.data?.customer?.email ? await findUserIdByEmail(payload.data.customer.email) : null);
      console.log('[billing-webhook] amountLocal:', amountLocal, currency, '| resolved userId:', userId);

      if (userId) {
        const usd = await toUsd(amountLocal, currency);
        const treatAsPro = usd >= PRO_PLAN_USD - PRO_PLAN_USD_TOLERANCE;
        await creditWallet(userId, usd, 'paystack', String(payload.data?.customer?.customer_code ?? ''), treatAsPro);
        await recordEvent(eventId, 'paystack', userId, usd, payload.event);
        console.log('[billing-webhook] Credited', usd, 'USD to user:', userId, '| is_pro_member:', treatAsPro);
      } else {
        console.error('[billing-webhook] Could not resolve a userId from metadata.user_id or customer email — nothing credited. Full metadata:', JSON.stringify(payload.data?.metadata));
      }
    }
    return new Response('OK', { status: 200 });
  }

  // ---- Local vector: Flutterwave ----
  if (req.headers.get('verif-hash')) {
    console.log('[billing-webhook] Detected Flutterwave request (verif-hash header present)');
    const valid = verifyFlutterwave(req.headers.get('verif-hash'));
    console.log('[billing-webhook] Flutterwave signature valid:', valid);
    if (!valid) return new Response('Invalid signature', { status: 401 });

    const payload = JSON.parse(rawBody);
    const eventId = String(payload.data?.id ?? crypto.randomUUID());
    if (await alreadyProcessed(eventId)) {
      console.log('[billing-webhook] Duplicate event, skipping:', eventId);
      return new Response('OK (duplicate)', { status: 200 });
    }

    console.log('[billing-webhook] Flutterwave event:', payload.event, '| status:', payload.data?.status);
    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      const amountLocal = payload.data?.amount ?? 0;
      const currency = payload.data?.currency ?? 'NGN';
      const userId = payload.data?.meta?.user_id
        ?? (payload.data?.customer?.email ? await findUserIdByEmail(payload.data.customer.email) : null);
      console.log('[billing-webhook] Resolved userId:', userId);

      if (userId) {
        const usd = await toUsd(amountLocal, currency);
        const treatAsPro = usd >= PRO_PLAN_USD - PRO_PLAN_USD_TOLERANCE;
        await creditWallet(userId, usd, 'flutterwave', String(payload.data?.customer?.id ?? ''), treatAsPro);
        await recordEvent(eventId, 'flutterwave', userId, usd, payload.event);
        console.log('[billing-webhook] Credited', usd, 'USD to user:', userId);
      } else {
        console.error('[billing-webhook] Could not resolve a userId — nothing credited.');
      }
    }
    return new Response('OK', { status: 200 });
  }

  console.error('[billing-webhook] Unrecognized webhook source — headers received:', JSON.stringify([...req.headers.keys()]));
  return new Response('Unrecognized webhook source', { status: 400 });
});

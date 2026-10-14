// Supabase Edge Function: billing-webhook
// Deploy with:  supabase functions deploy billing-webhook --no-verify-jwt
// (--no-verify-jwt because payment gateways call this anonymously — the
// security boundary here is the per-gateway signature check below, not
// Supabase's own JWT auth.)
//
// Required secrets (supabase secrets set KEY=value):
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (NEVER the anon key)
//   PADDLE_WEBHOOK_SECRET       — from Paddle → Developer Tools → Notifications
//   PAYSTACK_SECRET_KEY         — from Paystack dashboard (sk_live_… / sk_test_…)
//   FLUTTERWAVE_SECRET_HASH     — the secret hash you set in Flutterwave's webhook settings
//
// Nothing here fabricates a successful payment — if a signature doesn't
// verify, the request is rejected with 401 and nothing is credited.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Keep this synchronized with core/src/config/billing.ts.
const PRO_PLAN_USD = 20.0;
const PRO_PLAN_USD_TOLERANCE = 2.0; // retained for the non-Paystack gateway branches

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

type RecordOutcome = { status: 'recorded' } | { status: 'duplicate' } | { status: 'error'; error: unknown };

async function tryRecordEvent(
  eventId: string,
  gateway: string,
  userId: string,
  amountUsd: number,
  rawType: string
): Promise<RecordOutcome> {
  const { error } = await supabaseAdmin
    .from('billing_events')
    .insert({ id: eventId, gateway, user_id: userId, amount_usd: amountUsd, raw_type: rawType });
  if (!error) return { status: 'recorded' };
  if ((error as { code?: string }).code === '23505') return { status: 'duplicate' };
  return { status: 'error', error };
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

async function markIntentFailed(reference: string, reason: string) {
  const { error } = await supabaseAdmin
    .from('payment_intents')
    .update({ status: 'failed' })
    .eq('reference', reference)
    .eq('status', 'pending');
  if (error) console.error('[billing-webhook] Failed to mark payment intent failed:', reason, error);
}

async function verifyPaystackTransaction(reference: string) {
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY is missing');

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Paystack verification HTTP ${res.status}`);

  const payload = await res.json();
  if (payload?.data?.status !== 'success' || payload?.data?.reference !== reference) {
    throw new Error(`Paystack verification did not confirm success for ${reference}`);
  }
  return payload.data;
}

async function revokeProForReference(reference: string, rawType: string) {
  const { data: intent, error: intentError } = await supabaseAdmin
    .from('payment_intents')
    .select('id, user_id, purpose, currency, expected_amount_minor')
    .eq('reference', reference)
    .maybeSingle();

  if (intentError) throw intentError;
  if (!intent) {
    console.error('[billing-webhook] Refund/dispute references unknown payment intent:', reference);
    return;
  }
  if (intent.purpose !== 'pro_plan') {
    console.log('[billing-webhook] Refund/dispute is not a Pro payment; no plan revocation:', reference);
    return;
  }

  const { error: revokeError } = await supabaseAdmin
    .from('billing_profile')
    .update({
      plan: 'free',
      is_pro_member: false,
      plan_expires_at: new Date().toISOString(),
      plan_cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', intent.user_id);
  if (revokeError) throw revokeError;

  const { error: intentUpdateError } = await supabaseAdmin
    .from('payment_intents')
    .update({ status: 'refunded' })
    .eq('id', intent.id);
  if (intentUpdateError) throw intentUpdateError;

  const { error: eventError } = await supabaseAdmin
    .from('billing_events')
    .upsert({
      id: `paystack:${rawType}:${reference}`,
      gateway: 'paystack',
      user_id: intent.user_id,
      raw_type: rawType,
      reference,
      currency: intent.currency,
      amount_minor: intent.expected_amount_minor,
      processed_at: new Date().toISOString(),
    }, { onConflict: 'gateway,reference' });
  if (eventError) throw eventError;

  console.log('[billing-webhook] Revoked Pro for refunded/disputed reference:', reference);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const rawBody = await req.text();

    // ---- Global vector: Paddle ----
    if (req.headers.get('paddle-signature')) {
      console.log('[billing-webhook] Detected Paddle request (paddle-signature header present)');
      const valid = await verifyPaddle(rawBody, req.headers.get('paddle-signature'));
      console.log('[billing-webhook] Paddle signature valid:', valid);
      if (!valid) return new Response('Invalid signature', { status: 401 });

      const payload = JSON.parse(rawBody);
      const eventId = String(payload.event_id ?? crypto.randomUUID());

      console.log('[billing-webhook] Paddle event:', payload.event_type);
      if (payload.event_type === 'transaction.completed') {
        const userId = payload.data?.custom_data?.user_id ?? null;
        console.log('[billing-webhook] Resolved userId:', userId);
        if (userId) {
          const record = await tryRecordEvent(eventId, 'paddle', userId, PRO_PLAN_USD, payload.event_type);
          if (record.status === 'duplicate') {
            console.log('[billing-webhook] Duplicate event, skipping:', eventId);
          } else if (record.status === 'error') {
            console.error('[billing-webhook] Failed to record billing event — not crediting to avoid an unrecorded transaction:', record.error);
            return new Response('Internal error', { status: 500 });
          } else {
            await creditWallet(userId, PRO_PLAN_USD, 'paddle', String(payload.data?.customer_id ?? ''), true);
            console.log('[billing-webhook] Credited wallet for user:', userId);
          }
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
      console.log('[billing-webhook] Paystack event:', payload.event);

      if (payload.event === 'charge.success') {
        const reference = String(payload.data?.reference ?? '');
        if (!reference) {
          console.error('[billing-webhook] charge.success has no transaction reference — nothing granted.');
          return new Response('OK', { status: 200 });
        }

        const { data: intent, error: intentError } = await supabaseAdmin
          .from('payment_intents')
          .select('id, user_id, purpose, expected_amount_minor, currency, status')
          .eq('reference', reference)
          .maybeSingle();

        if (intentError) {
          console.error('[billing-webhook] Payment-intent lookup failed:', intentError);
          return new Response('Internal error', { status: 500 });
        }
        if (!intent) {
          console.error('[billing-webhook] Unknown Paystack transaction reference — nothing granted:', reference);
          return new Response('OK', { status: 200 });
        }
        if (intent.status === 'paid') {
          console.log('[billing-webhook] Payment intent already paid — skipping:', reference);
          return new Response('OK', { status: 200 });
        }

        const actualAmountMinor = Number(payload.data?.amount ?? 0);
        const actualCurrency = String(payload.data?.currency ?? '');
        const actualStatus = String(payload.data?.status ?? '');

        if (
          actualStatus !== 'success'
          || actualCurrency !== intent.currency
          || actualAmountMinor < Number(intent.expected_amount_minor)
        ) {
          const reason = `status=${actualStatus}, amount=${actualAmountMinor}, expected=${intent.expected_amount_minor}, currency=${actualCurrency}, expectedCurrency=${intent.currency}`;
          await markIntentFailed(reference, reason);
          console.error('[billing-webhook] Invalid Paystack payment intent:', reference, reason);
          return new Response('OK', { status: 200 });
        }

        // Paystack documents webhook verification as the preferred delivery path,
        // but the Verify API is also checked here before any value is granted.
        // A verification transport failure returns 500 so Paystack can retry.
        let verifiedTransaction;
        try {
          verifiedTransaction = await verifyPaystackTransaction(reference);
        } catch (verificationError) {
          console.error('[billing-webhook] Paystack transaction verification failed:', verificationError);
          return new Response('Internal error', { status: 500 });
        }

        if (
          Number(verifiedTransaction.amount) < Number(intent.expected_amount_minor)
          || String(verifiedTransaction.currency) !== intent.currency
          || verifiedTransaction.status !== 'success'
        ) {
          const reason = `verify status=${verifiedTransaction.status}, amount=${verifiedTransaction.amount}, currency=${verifiedTransaction.currency}`;
          await markIntentFailed(reference, reason);
          console.error('[billing-webhook] Verified Paystack transaction does not match payment intent:', reference, reason);
          return new Response('OK', { status: 200 });
        }

        if (intent.purpose === 'pro_plan') {
          const { data: expiry, error: applyError } = await supabaseAdmin.rpc('apply_plan_payment', {
            p_user_id: intent.user_id,
            p_reference: reference,
            p_plan: 'pro',
          });
          if (applyError) {
            console.error('[billing-webhook] Failed to apply Pro plan payment:', applyError);
            return new Response('Internal error', { status: 500 });
          }

          const { error: eventUpdateError } = await supabaseAdmin
            .from('billing_events')
            .update({
              amount_usd: PRO_PLAN_USD,
              amount_minor: actualAmountMinor,
              currency: actualCurrency,
              raw_type: payload.event,
              processed_at: new Date().toISOString(),
            })
            .eq('gateway', 'paystack')
            .eq('reference', reference);
          if (eventUpdateError) {
            console.error('[billing-webhook] Failed to finalize Pro billing event:', eventUpdateError);
            return new Response('Internal error', { status: 500 });
          }

          const { error: intentPaidError } = await supabaseAdmin
            .from('payment_intents')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', intent.id)
            .eq('status', 'pending');
          if (intentPaidError) {
            console.error('[billing-webhook] Failed to mark Pro payment intent paid:', intentPaidError);
            return new Response('Internal error', { status: 500 });
          }

          console.log('[billing-webhook] Applied Pro plan payment:', reference, '| expiry:', expiry);
          return new Response('OK', { status: 200 });
        }

        if (intent.purpose === 'credit_topup') {
          const amountLocal = actualAmountMinor / 100;
          const usd = await toUsd(amountLocal, actualCurrency);
          const record = await tryRecordEvent(reference, 'paystack', intent.user_id, usd, payload.event);
          if (record.status === 'duplicate') {
            console.log('[billing-webhook] Duplicate top-up reference, skipping:', reference);
          } else if (record.status === 'error') {
            console.error('[billing-webhook] Failed to record top-up billing event — not crediting:', record.error);
            return new Response('Internal error', { status: 500 });
          } else {
            await creditWallet(intent.user_id, usd, 'paystack', String(payload.data?.customer?.customer_code ?? ''));
            console.log('[billing-webhook] Credited', usd, 'USD wallet top-up for user:', intent.user_id);
          }

          const { error: intentPaidError } = await supabaseAdmin
            .from('payment_intents')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', intent.id)
            .eq('status', 'pending');
          if (intentPaidError) {
            console.error('[billing-webhook] Failed to mark top-up payment intent paid:', intentPaidError);
            return new Response('Internal error', { status: 500 });
          }
          return new Response('OK', { status: 200 });
        }

        console.error('[billing-webhook] Unknown payment intent purpose — nothing granted:', intent.purpose, reference);
        return new Response('OK', { status: 200 });
      }

      if (payload.event === 'refund.processed' || payload.event === 'charge.dispute.create') {
        const reference = String(
          payload.data?.transaction_reference
          ?? payload.data?.transaction?.reference
          ?? payload.data?.reference
          ?? ''
        );
        if (!reference) {
          console.error('[billing-webhook] Refund/dispute event has no transaction reference.');
          return new Response('OK', { status: 200 });
        }

        try {
          await revokeProForReference(reference, payload.event);
        } catch (error) {
          console.error('[billing-webhook] Failed to process refund/dispute:', error);
          return new Response('Internal error', { status: 500 });
        }
        return new Response('OK', { status: 200 });
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
          const record = await tryRecordEvent(eventId, 'flutterwave', userId, usd, payload.event);
          if (record.status === 'duplicate') {
            console.log('[billing-webhook] Duplicate event, skipping:', eventId);
          } else if (record.status === 'error') {
            console.error('[billing-webhook] Failed to record billing event — not crediting to avoid an unrecorded transaction:', record.error);
            return new Response('Internal error', { status: 500 });
          } else {
            await creditWallet(userId, usd, 'flutterwave', String(payload.data?.customer?.id ?? ''), treatAsPro);
            console.log('[billing-webhook] Credited', usd, 'USD to user:', userId);
          }
        } else {
          console.error('[billing-webhook] Could not resolve a userId — nothing credited.');
        }
      }
      return new Response('OK', { status: 200 });
    }

    console.error('[billing-webhook] Unrecognized webhook source — headers received:', JSON.stringify([...req.headers.keys()]));
    return new Response('Unrecognized webhook source', { status: 400 });
  } catch (error) {
    console.error('[billing-webhook] Unhandled webhook error:', error);
    return new Response('Internal error', { status: 500 });
  }
});

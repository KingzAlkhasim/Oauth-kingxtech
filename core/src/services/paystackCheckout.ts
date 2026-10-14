import { env } from '../config/env';
import { PRO_PLAN_PRICE_USD } from '../config/billing';
import { usdToLocal } from '../lib/fx';
import { supabaseAdmin } from '../lib/supabaseAdmin';

const PAYSTACK_API = 'https://api.paystack.co';

export interface PaystackInit {
  authorization_url: string;
  reference: string;
}

export interface PaystackInitOpts {
  /** 'pro_plan' (default) charges the fixed monthly amount; 'credit_topup' charges amountUsd instead. */
  purpose?: 'pro_plan' | 'credit_topup';
  /** Required when purpose is 'credit_topup'. Ignored for 'pro_plan'. */
  amountUsd?: number;
}

/**
 * Starts a Paystack transaction with real user_id metadata attached, so the
 * billing-webhook Edge Function can reliably credit the right account —
 * unlike a static hosted Payment Page link, which has no standard way to
 * carry arbitrary custom metadata through to the webhook payload.
 *
 * `purpose` is also attached to metadata so the webhook can tell a Pro-plan
 * payment apart from a one-off Store credit top-up without guessing from the
 * charged amount.
 */
export async function initializePaystackTransaction(
  userId: string,
  email: string,
  opts: PaystackInitOpts = {}
): Promise<PaystackInit> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack is not configured on the server yet (PAYSTACK_SECRET_KEY is missing).');
  }

  const purpose = opts.purpose ?? 'pro_plan';
  const amountKobo =
    purpose === 'credit_topup'
      ? Math.round((await usdToLocal(opts.amountUsd!, 'NGN')) * 100)
      : env.PAYSTACK_PLAN_AMOUNT_KOBO;

  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      // Matches exactly what supabase/functions/billing-webhook/index.ts
      // reads: payload.data?.metadata?.user_id / .purpose — keep in sync.
      metadata: { user_id: userId, purpose },
      callback_url: env.PAYSTACK_CALLBACK_URL,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Failed to initialize Paystack transaction');
  }

  const reference = String(data.data.reference);
  // Every Paystack checkout gets an intent because the webhook deliberately
  // grants nothing for unknown references. For Pro, the expected amount is
  // the exact NGN minor-unit amount sent to Paystack. Top-ups retain their
  // existing amount calculation and wallet-credit math.
  const { error: intentError } = await supabaseAdmin.from('payment_intents').insert({
    user_id: userId,
    provider: 'paystack',
    reference,
    purpose,
    expected_amount_minor: amountKobo,
    currency: 'NGN',
    status: 'pending',
  });
  if (intentError) {
    throw new Error(`Failed to record payment intent: ${intentError.message}`);
  }

  if (purpose === 'pro_plan') {
    // Pro price is PRO_PLAN_PRICE_USD ($20); PAYSTACK_PLAN_AMOUNT_KOBO is the
    // exact NGN minor-unit amount sent to Paystack and is stored verbatim here.
    // Keep the USD price constant synchronized with the webhook's Edge copy.
  }

  return { authorization_url: data.data.authorization_url, reference };
}

export { PRO_PLAN_PRICE_USD };

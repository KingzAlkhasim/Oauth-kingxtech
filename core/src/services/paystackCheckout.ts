import { env } from '../config/env';

const PAYSTACK_API = 'https://api.paystack.co';

export interface PaystackInit {
  authorization_url: string;
  reference: string;
}

/**
 * Starts a Paystack transaction with real user_id metadata attached, so the
 * billing-webhook Edge Function can reliably credit the right account —
 * unlike a static hosted Payment Page link, which has no standard way to
 * carry arbitrary custom metadata through to the webhook payload.
 */
export async function initializePaystackTransaction(userId: string, email: string): Promise<PaystackInit> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack is not configured on the server yet (PAYSTACK_SECRET_KEY is missing).');
  }

  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: env.PAYSTACK_PLAN_AMOUNT_KOBO,
      // Matches exactly what supabase/functions/billing-webhook/index.ts
      // reads: payload.data?.metadata?.user_id — keep these in sync.
      metadata: { user_id: userId },
      callback_url: env.PAYSTACK_CALLBACK_URL,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Failed to initialize Paystack transaction');
  }
  return { authorization_url: data.data.authorization_url, reference: data.data.reference };
}

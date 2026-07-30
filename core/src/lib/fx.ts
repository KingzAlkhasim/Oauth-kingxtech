// Mirrors the toUsd() conversion in supabase/functions/billing-webhook —
// same live rate source, same fallback table, just inverted, so a top-up
// initialized here and the USD amount credited by the webhook stay consistent
// even if the live rate drifts slightly between initialize and confirm.
const FALLBACK_USD_RATE: Record<string, number> = { NGN: 1 / 1600, GHS: 1 / 15, KES: 1 / 145, ZAR: 1 / 18 };

export async function usdToLocal(usdAmount: number, currency: string): Promise<number> {
  if (currency === 'USD') return usdAmount;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/USD`);
    const json = await res.json();
    const rate = json?.rates?.[currency];
    if (typeof rate === 'number') return usdAmount * rate;
  } catch (_e) {
    // fall through to fallback table below
  }
  const inverseRate = FALLBACK_USD_RATE[currency];
  if (!inverseRate) throw new Error(`No FX rate available for ${currency}`);
  return usdAmount / inverseRate;
}
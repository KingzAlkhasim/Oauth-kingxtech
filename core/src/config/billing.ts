// Single backend source of truth for the Pro price in USD.
// The Paystack webhook keeps its own copy because it runs in Supabase Edge,
// outside the core Node runtime. Keep the two constants synchronized.
export const PRO_PLAN_PRICE_USD = 20;

-- Run this once in Supabase Dashboard → SQL Editor.
--
-- This is the actual enforcement point for "premium" actions (K-XpertAI
-- chat, SynthCode generations, GCP node operations) in an architecture with
-- no Express server. Call it BEFORE performing the paid action:
--
--   const { data, error } = await supabase.rpc('charge_user', { cost: 0.02 });
--   if (error || !data.allowed) {
--     // show a 402-equivalent: "insufficient credit, top up your wallet"
--     return;
--   }
--   // proceed with the paid action — the deduction already happened atomically
--
-- SECURITY DEFINER + the explicit auth.uid() check inside means this can't
-- be called on someone else's behalf, and the balance check + deduction
-- happen in one atomic statement so concurrent requests can't race past a
-- zero balance.

create or replace function public.charge_user(cost numeric)
returns json
language plpgsql
security definer
as $$
declare
  uid uuid := auth.uid();
  current_balance numeric(10,2);
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if cost <= 0 then
    raise exception 'Cost must be positive';
  end if;

  update public.billing_profile
  set credit_balance = credit_balance - cost, updated_at = now()
  where user_id = uid and credit_balance >= cost
  returning credit_balance into current_balance;

  if current_balance is null then
    -- Either no row matched the balance check, or the profile is missing.
    select credit_balance into current_balance from public.billing_profile where user_id = uid;
    return json_build_object(
      'allowed', false,
      'reason', 'insufficient_credit',
      'balance', coalesce(current_balance, 0.00)
    );
  end if;

  return json_build_object('allowed', true, 'balance', current_balance);
end;
$$;

comment on function public.charge_user is
  'Atomically deducts `cost` from the caller''s credit_balance if sufficient funds exist. Returns {allowed, balance}. Deliberately mirrors an HTTP 402 gate in a single RPC call since this project has no Express server.';

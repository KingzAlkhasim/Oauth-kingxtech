-- Run this once in Supabase Dashboard → SQL Editor.
-- Bumps the monthly free-credit allowance from 200 to 300, now that a
-- genuinely free open-weights model (via OpenRouter) is available alongside
-- Gemini Flash (which is capped separately at 5 requests/month since it
-- costs KingxTech real money per call — see kxpert_usage_log for enforcement).

-- Update the function's default so direct calls without an explicit amount
-- also use 300. The Node backend always passes this explicitly, so this is
-- mostly a safety-net for anyone calling the RPC directly.
create or replace function public.consume_free_credit(
  p_user_id uuid,
  p_cost integer default 1,
  p_monthly_amount integer default 300
)
returns table(ok boolean, remaining integer)
language plpgsql
security definer
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_remaining integer;
  v_current_month date;
begin
  insert into public.billing_profile (user_id, free_credits_remaining, free_credits_month)
  select p_user_id, p_monthly_amount, v_month
  where not exists (select 1 from public.billing_profile where user_id = p_user_id);

  select free_credits_remaining, free_credits_month
    into v_remaining, v_current_month
    from public.billing_profile
    where user_id = p_user_id
    for update;

  if v_current_month is distinct from v_month then
    v_remaining := p_monthly_amount;
  end if;

  if v_remaining < p_cost then
    update public.billing_profile
      set free_credits_remaining = v_remaining, free_credits_month = v_month
      where user_id = p_user_id;
    return query select false, v_remaining;
  end if;

  v_remaining := v_remaining - p_cost;
  update public.billing_profile
    set free_credits_remaining = v_remaining, free_credits_month = v_month
    where user_id = p_user_id;

  return query select true, v_remaining;
end;
$$;

-- One-time top-up: give existing users this month's extra 100 credits
-- immediately, instead of making them wait for next month's reset.
update public.billing_profile
set free_credits_remaining = free_credits_remaining + 100
where free_credits_month = date_trunc('month', now())::date;

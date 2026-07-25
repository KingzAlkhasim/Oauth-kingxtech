-- Run this once in Supabase Dashboard → SQL Editor.
-- Adds a monthly free-credit pool to the existing billing_profile table,
-- and an atomic function to check+deduct credits (avoids race conditions
-- between concurrent requests, unlike a naive read-then-write from Node).

alter table public.billing_profile
  add column if not exists free_credits_remaining integer not null default 200,
  add column if not exists free_credits_month date not null default date_trunc('month', now())::date;

create or replace function public.consume_free_credit(
  p_user_id uuid,
  p_cost integer default 1,
  p_monthly_amount integer default 200
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
  -- Ensure a row exists for this user (first-ever call for them).
  insert into public.billing_profile (user_id, free_credits_remaining, free_credits_month)
  select p_user_id, p_monthly_amount, v_month
  where not exists (select 1 from public.billing_profile where user_id = p_user_id);

  -- Lock the row so two concurrent requests can't both pass the same check.
  select free_credits_remaining, free_credits_month
    into v_remaining, v_current_month
    from public.billing_profile
    where user_id = p_user_id
    for update;

  if v_current_month is distinct from v_month then
    v_remaining := p_monthly_amount; -- new month, reset
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

grant execute on function public.consume_free_credit(uuid, integer, integer) to authenticated, service_role;

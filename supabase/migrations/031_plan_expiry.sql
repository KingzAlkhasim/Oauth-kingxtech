-- Pro plan lifecycle, payment intents, and wallet renewal.
-- This migration is additive and idempotent. Do NOT apply it automatically to
-- the production database from this PR; review/run it in Supabase SQL Editor.

alter table public.billing_profile
  add column if not exists plan_expires_at timestamptz,
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_cancel_at_period_end boolean not null default false,
  add column if not exists last_payment_reference text,
  add column if not exists last_payment_at timestamptz;

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  reference text not null unique,
  purpose text not null check (purpose in ('pro_plan', 'credit_topup')),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from public, anon, authenticated;
grant all on public.payment_intents to service_role;
-- Intentionally no anon/authenticated policies: payment intents are service-role only.

alter table public.billing_events
  add column if not exists reference text,
  add column if not exists currency text,
  add column if not exists amount_minor bigint;

create unique index if not exists billing_events_gateway_reference_uidx
  on public.billing_events (gateway, reference)
  where reference is not null;

-- Existing paid/pro users receive a 30-day grace period so this migration
-- never cuts an existing customer off when the new expiry fields are introduced.
update public.billing_profile
set
  plan_expires_at = now() + interval '30 days',
  plan = 'pro',
  plan_cancel_at_period_end = false
where plan_expires_at is null
  and (is_pro_member = true or plan in ('paid', 'pro', 'pro_plus'));

create or replace function public.expire_lapsed_plans()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_profile
  set
    plan = 'free',
    is_pro_member = false,
    plan_cancel_at_period_end = false,
    updated_at = now()
  where plan_expires_at < now()
    and plan in ('pro', 'pro_plus');
end;
$$;

revoke all on function public.expire_lapsed_plans() from public, anon, authenticated;
grant execute on function public.expire_lapsed_plans() to service_role;

create or replace function public.apply_plan_payment(
  p_user_id uuid,
  p_reference text,
  p_plan text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry timestamptz;
begin
  if p_plan not in ('pro', 'pro_plus') then
    raise exception 'Unsupported paid plan: %', p_plan;
  end if;

  -- The billing-event reference is the idempotency key for plan payments.
  if exists (
    select 1
    from public.billing_events
    where gateway = 'paystack'
      and reference = p_reference
  ) then
    select plan_expires_at
      into v_expiry
      from public.billing_profile
     where user_id = p_user_id;
    return v_expiry;
  end if;

  update public.billing_profile
  set
    plan = p_plan,
    is_pro_member = true,
    plan_started_at = case
      when is_pro_member = true
        and plan in ('pro', 'pro_plus')
        and plan_expires_at is not null
        and plan_expires_at >= now()
      then plan_started_at
      else now()
    end,
    plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '30 days',
    plan_cancel_at_period_end = false,
    last_payment_reference = p_reference,
    last_payment_at = now(),
    updated_at = now()
  where user_id = p_user_id
  returning plan_expires_at into v_expiry;

  if not found then
    raise exception 'Billing profile not found for user %', p_user_id;
  end if;

  insert into public.billing_events (
    id, gateway, user_id, raw_type, reference, currency, processed_at
  ) values (
    'paystack:plan:' || p_reference,
    'paystack',
    p_user_id,
    'pro_plan',
    p_reference,
    'NGN',
    now()
  );

  return v_expiry;
end;
$$;

revoke all on function public.apply_plan_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_plan_payment(uuid, text, text) to service_role;

create or replace function public.pay_pro_from_wallet(
  p_user_id uuid,
  p_idempotency_key text,
  p_price numeric
)
returns table (plan_expires_at timestamptz, credit_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry timestamptz;
  v_balance numeric(10,2);
begin
  if p_price <= 0 then
    raise exception 'Price must be positive';
  end if;

  select bp.credit_balance
    into v_balance
    from public.billing_profile bp
   where bp.user_id = p_user_id
   for update;

  if not found then
    raise exception 'Billing profile not found for user %', p_user_id;
  end if;

  -- The unique (gateway, reference) index makes this atomic with the event insert.
  if exists (
    select 1
      from public.billing_events
     where gateway = 'wallet'
       and reference = p_idempotency_key
  ) then
    select bp.plan_expires_at, bp.credit_balance
      into v_expiry, v_balance
      from public.billing_profile bp
     where bp.user_id = p_user_id;
    return query select v_expiry, v_balance;
    return;
  end if;

  if v_balance < p_price then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.billing_profile
  set
    credit_balance = credit_balance - p_price,
    plan = 'pro',
    is_pro_member = true,
    plan_started_at = case
      when is_pro_member = true
        and plan in ('pro', 'pro_plus')
        and plan_expires_at is not null
        and plan_expires_at >= now()
      then plan_started_at
      else now()
    end,
    plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '30 days',
    plan_cancel_at_period_end = false,
    last_payment_reference = p_idempotency_key,
    last_payment_at = now(),
    updated_at = now()
  where user_id = p_user_id
  returning plan_expires_at, credit_balance into v_expiry, v_balance;

  insert into public.billing_events (
    id, gateway, user_id, amount_usd, raw_type, reference, currency, amount_minor, processed_at
  ) values (
    'wallet:pro:' || p_idempotency_key,
    'wallet',
    p_user_id,
    p_price,
    'wallet_pro_renewal',
    p_idempotency_key,
    'USD',
    round(p_price * 100),
    now()
  );

  return query select v_expiry, v_balance;
end;
$$;

revoke all on function public.pay_pro_from_wallet(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.pay_pro_from_wallet(uuid, text, numeric) to service_role;

-- Cancellation is intentionally only a flag in this PR: there are no automatic
-- recurring Paystack charges. Paystack subscription plans need separate research
-- because USD support is unconfirmed for the intended checkout flow.

-- Expiry is scheduled by Vercel Cron in core/vercel.json rather than pg_cron.
-- This avoids assuming the production database has pg_cron enabled and keeps
-- the migration safe to review without installing an extension.

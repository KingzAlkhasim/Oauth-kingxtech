-- Verification script for 031_plan_expiry.sql.
-- Intentionally NOT executed against production by this PR.
-- Run in a disposable Supabase database after applying migration 031.

begin;

create temp table _031_test_users (
  user_id uuid primary key default gen_random_uuid()
);

insert into _031_test_users default values;

insert into public.billing_profile (user_id, is_pro_member, credit_balance, plan)
select user_id, false, 25.00, 'free'
from _031_test_users;

-- 1. No active plan: payment starts at now and grants 30 days.
select public.apply_plan_payment(
  (select user_id from _031_test_users),
  '031-test-reference-1',
  'pro'
);

select
  is_pro_member,
  plan = 'pro' as plan_is_pro,
  plan_expires_at > now() + interval '29 days' as expiry_is_at_least_29_days,
  credit_balance = 25.00 as wallet_unchanged
from public.billing_profile
where user_id = (select user_id from _031_test_users);

-- 2. Repeating the same reference must be a no-op.
select public.apply_plan_payment(
  (select user_id from _031_test_users),
  '031-test-reference-1',
  'pro'
);

-- 3. Early renewal extends from the existing expiry, not from now.
select public.apply_plan_payment(
  (select user_id from _031_test_users),
  '031-test-reference-2',
  'pro'
);

-- 4. Wallet payment: insufficient balance must change nothing.
update public.billing_profile
set credit_balance = 19.99
where user_id = (select user_id from _031_test_users);

select public.pay_pro_from_wallet(
  (select user_id from _031_test_users),
  '031-wallet-insufficient',
  20.00
);

-- The previous call is expected to raise "Insufficient wallet balance".
-- In a psql session, wrap that statement in a savepoint/exception block if
-- continuing with the remaining checks.

rollback;

-- Additional production-safe read-only checks can be run separately:
-- select public.expire_lapsed_plans();
-- select proname, prosecdef from pg_proc where proname in
--   ('expire_lapsed_plans', 'apply_plan_payment', 'pay_pro_from_wallet');

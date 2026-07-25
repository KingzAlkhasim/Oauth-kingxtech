-- Run this once in Supabase Dashboard → SQL Editor.
-- Real usage tracking: every time charge_user() actually deducts credit for
-- a paid action, it's logged here. A fresh account shows zero usage —
-- there's nothing to fabricate because nothing's happened yet.

create table if not exists public.usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cost numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists usage_log_user_id_idx on public.usage_log (user_id, created_at desc);

alter table public.usage_log enable row level security;

drop policy if exists "Users can view own usage" on public.usage_log;
create policy "Users can view own usage" on public.usage_log
  for select using (auth.uid() = user_id);
-- No insert policy for regular roles — only charge_user() (SECURITY DEFINER) writes here.

-- Replace charge_user() so it also records the real usage entry atomically.
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
    select credit_balance into current_balance from public.billing_profile where user_id = uid;
    return json_build_object('allowed', false, 'reason', 'insufficient_credit', 'balance', coalesce(current_balance, 0.00));
  end if;

  insert into public.usage_log (user_id, cost) values (uid, cost);

  return json_build_object('allowed', true, 'balance', current_balance);
end;
$$;

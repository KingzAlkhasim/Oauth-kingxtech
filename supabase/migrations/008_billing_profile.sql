-- Run this once in Supabase Dashboard → SQL Editor.
--
-- SECURITY NOTE on gcp_service_account_token: this migration deliberately
-- does NOT add that column. A GCP service account token grants real
-- infrastructure access — storing it in any table an authenticated client
-- can read (even with RLS scoped to auth.uid()) means anyone who
-- compromises that one user's session compromises your GCP project too.
-- The correct place for it is a Supabase Edge Function secret
-- (`supabase secrets set GCP_SERVICE_ACCOUNT_JSON=...`), read only inside
-- server-side function code, never sent to the browser. This table only
-- tracks a `gcp_connected` boolean so the UI can show connection status.

create table if not exists public.billing_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_pro_member boolean not null default false,
  credit_balance numeric(10,2) not null default 0.00,
  payment_gateway_used text check (payment_gateway_used in ('lemonsqueezy', 'paddle', 'paystack', 'flutterwave')),
  gateway_customer_reference text,
  gcp_connected boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.billing_profile enable row level security;

-- Users can READ their own billing profile...
drop policy if exists "Users can view own billing profile" on public.billing_profile;
create policy "Users can view own billing profile" on public.billing_profile
  for select using (auth.uid() = user_id);

-- ...but cannot write to it directly. Balance changes only happen via the
-- charge_user() RPC (SECURITY DEFINER, deducts atomically) or the
-- billing-webhook Edge Function (uses the service role key, bypasses RLS
-- entirely). If a client could UPDATE this table directly, any user could
-- just set their own is_pro_member = true.
-- (No insert/update/delete policy is intentionally created for anon/authenticated roles.)

create or replace function public.ensure_billing_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.billing_profile (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row execute function public.ensure_billing_profile();

-- Backfill existing users who signed up before this migration ran.
insert into public.billing_profile (user_id)
select id from auth.users
on conflict (user_id) do nothing;

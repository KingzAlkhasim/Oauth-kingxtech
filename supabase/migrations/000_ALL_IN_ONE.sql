-- ============================================================
-- KingxTech Auth — full database setup
-- Run this ENTIRE file once in Supabase Dashboard → SQL Editor.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS, so running it twice won't error or duplicate.
-- ============================================================

-- ============================================================
-- 001_projects.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Creates a projects table scoped to each user via Row Level Security,
-- so the dashboard can show "your projects across the ecosystem" for real.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  product text not null default 'Other'
    check (product in ('K-XpertAI', 'SynthCode IDE', 'KX Cloud', 'Other')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  description text,
  external_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

drop policy if exists "Users can view own projects" on public.projects;
create policy "Users can view own projects" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own projects" on public.projects;
create policy "Users can insert own projects" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects" on public.projects
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own projects" on public.projects;
create policy "Users can delete own projects" on public.projects
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on every edit.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============================================================
-- 002_avatars_bucket.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Creates the 'avatars' storage bucket (public read) with policies so each
-- user can only manage files inside their own folder (path prefix = their user id).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 003_api_keys.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the AI Lab tab's API Key Vault. Keys are generated and stored for
-- real, but note: no live KingxTech API validates them yet — this table is
-- ready for that day, and lets developers see/manage what they've issued.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  key_prefix text not null,   -- short, safe-to-display prefix e.g. kx_live_8f2a
  key_hash text not null,     -- sha-256 hash of the full key; the full key is shown once, never stored
  environment text not null default 'live' check (environment in ('live', 'test')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

drop policy if exists "Users can view own api keys" on public.api_keys;
create policy "Users can view own api keys" on public.api_keys
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own api keys" on public.api_keys;
create policy "Users can insert own api keys" on public.api_keys
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own api keys" on public.api_keys;
create policy "Users can update own api keys" on public.api_keys
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own api keys" on public.api_keys;
create policy "Users can delete own api keys" on public.api_keys
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 004_webhooks.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Integrations tab's Webhook Manager. Configuration (URL + event
-- triggers) is real and persisted. Delivery history is NOT — there's no
-- event dispatcher wired up yet to actually fire these, so the app is
-- honest about that rather than faking a delivery log.

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  url text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists webhooks_user_id_idx on public.webhooks (user_id);

alter table public.webhooks enable row level security;

drop policy if exists "Users can view own webhooks" on public.webhooks;
create policy "Users can view own webhooks" on public.webhooks
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own webhooks" on public.webhooks;
create policy "Users can insert own webhooks" on public.webhooks
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own webhooks" on public.webhooks;
create policy "Users can update own webhooks" on public.webhooks
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own webhooks" on public.webhooks;
create policy "Users can delete own webhooks" on public.webhooks
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 005_support_tickets.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Support & Tickets tab. Ticket creation and listing are real.
-- There's no live agent/chat system behind this yet, so tickets will sit as
-- "open" until there's a support backend — the app says so rather than
-- faking resolutions or transcripts.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  category text not null check (category in ('Auth', 'Billing', 'Bug', 'Feature')),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_id_idx on public.support_tickets (user_id);

alter table public.support_tickets enable row level security;

drop policy if exists "Users can view own tickets" on public.support_tickets;
create policy "Users can view own tickets" on public.support_tickets
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own tickets" on public.support_tickets;
create policy "Users can insert own tickets" on public.support_tickets
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own tickets" on public.support_tickets;
create policy "Users can update own tickets" on public.support_tickets
  for update using (auth.uid() = user_id);

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

-- ============================================================
-- 006_readonly_sql.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Console → KX Cloud → Database tab's SQL editor.
--
-- Security model (read this before enabling):
--   - Runs as SECURITY INVOKER (the default) — it executes as the calling
--     user, so Row Level Security on every table still applies. A user can
--     only ever see rows their own RLS policies already allow.
--   - Rejects anything that isn't a single SELECT statement: no INSERT,
--     UPDATE, DELETE, DROP, ALTER, GRANT, multiple statements via ';', or
--     comments used to smuggle a second statement.
--   - Still, letting users run arbitrary SELECTs against your schema is a
--     meaningful trust decision — only run this migration if you're
--     comfortable with authenticated users introspecting table structure
--     within what RLS already permits them to read.

create or replace function public.run_readonly_query(query text)
returns setof json
language plpgsql
security invoker
as $$
declare
  normalized text := trim(query);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if normalized = '' then
    raise exception 'Query cannot be empty';
  end if;

  if normalized !~* '^select\s' then
    raise exception 'Only SELECT statements are allowed';
  end if;

  if normalized ~ ';' then
    raise exception 'Only a single statement is allowed (no semicolons)';
  end if;

  if normalized ~* '\b(insert|update|delete|drop|alter|grant|revoke|truncate|create|execute|call|copy|vacuum)\b' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;

  return query execute format('select row_to_json(t) from (%s) t limit 200', normalized);
end;
$$;

comment on function public.run_readonly_query is
  'Executes a single validated read-only SELECT for the Console SQL editor. Runs as SECURITY INVOKER so RLS still applies.';

-- ============================================================
-- 007_activity_log.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Activity page and Settings → Security logs tab with real entries
-- — written by the app itself at the moment real actions happen (sign-in,
-- password change, 2FA toggle, project/key/webhook changes). Nothing here
-- is seeded or fabricated; a fresh account starts with zero rows.

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_user_id_idx on public.activity_log (user_id, created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "Users can view own activity" on public.activity_log;
create policy "Users can view own activity" on public.activity_log
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own activity" on public.activity_log;
create policy "Users can insert own activity" on public.activity_log
  for insert with check (auth.uid() = user_id);

-- Intentionally no update/delete policy — this is an append-only log.

-- ============================================================
-- 008_billing_profile.sql
-- ============================================================
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

-- ============================================================
-- 009_charge_user.sql
-- ============================================================
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

-- ============================================================
-- 010_billing_events.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Every payment gateway retries webhooks on timeout/non-200 responses.
-- Without recording which events were already processed, a retry would
-- credit the same payment twice. This table is written only by the
-- billing-webhook Edge Function using the service role key — no RLS
-- policies are defined for anon/authenticated, so ordinary clients can't
-- read or write it at all.

create table if not exists public.billing_events (
  id text primary key,             -- the gateway's own event/transaction id
  gateway text not null,
  user_id uuid references auth.users(id) on delete set null,
  amount_usd numeric(10,2),
  raw_type text,
  processed_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;
-- No policies added on purpose: only the service role (Edge Function) can
-- touch this table. Regular users, even authenticated ones, get nothing.

-- ============================================================
-- 011_custom_domains.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Domains page. Verification is genuinely real: the frontend
-- queries Google's public DNS-over-HTTPS resolver (dns.google/resolve)
-- directly from the browser to check the domain's actual A/CNAME records —
-- no backend needed for that part, and it isn't faked.

create table if not exists public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  domain text not null,
  target_cname text not null default 'proxy.kingxtech.name.ng',
  verified boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (domain)
);

create index if not exists custom_domains_user_id_idx on public.custom_domains (user_id);

alter table public.custom_domains enable row level security;

drop policy if exists "Users can view own domains" on public.custom_domains;
create policy "Users can view own domains" on public.custom_domains
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own domains" on public.custom_domains;
create policy "Users can insert own domains" on public.custom_domains
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own domains" on public.custom_domains;
create policy "Users can update own domains" on public.custom_domains
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own domains" on public.custom_domains;
create policy "Users can delete own domains" on public.custom_domains
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 012_usage_log.sql
-- ============================================================
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

-- ============================================================
-- 013_billing_events_read.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- billing_events previously had no read access for regular users (only the
-- service role, via the webhook function, could touch it at all). This adds
-- a SELECT-only policy so the Billing page can show a real transaction
-- history — insert/update/delete remain service-role-only.

drop policy if exists "Users can view own billing events" on public.billing_events;
create policy "Users can view own billing events" on public.billing_events
  for select using (auth.uid() = user_id);

-- ============================================================
-- 014_env_vars.sql
-- ============================================================
-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs Console → KX Cloud → Environment Variables. Real CRUD, scoped to
-- your own account via RLS — values are stored as-is (not encrypted at the
-- column level), so don't put anything here you wouldn't put in a .env
-- file that Postgres backups could contain in plaintext.

create table if not exists public.env_vars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create index if not exists env_vars_user_id_idx on public.env_vars (user_id);

alter table public.env_vars enable row level security;

drop policy if exists "Users can view own env vars" on public.env_vars;
create policy "Users can view own env vars" on public.env_vars
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own env vars" on public.env_vars;
create policy "Users can insert own env vars" on public.env_vars
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own env vars" on public.env_vars;
create policy "Users can update own env vars" on public.env_vars
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own env vars" on public.env_vars;
create policy "Users can delete own env vars" on public.env_vars
  for delete using (auth.uid() = user_id);


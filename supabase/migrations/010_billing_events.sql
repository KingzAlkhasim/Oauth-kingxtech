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

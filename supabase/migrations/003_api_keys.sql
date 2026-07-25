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

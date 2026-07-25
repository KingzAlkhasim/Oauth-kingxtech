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

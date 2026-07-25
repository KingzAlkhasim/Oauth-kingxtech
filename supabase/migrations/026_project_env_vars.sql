-- Run this once in Supabase Dashboard → SQL Editor.
-- Per-PROJECT config, distinct from the account-wide env_vars table in
-- Console → KX Cloud. Different projects can now have different variables
-- instead of sharing one global pool. Same public/private convention as
-- env_vars: is_public vars get injected into that project's published site
-- via /kx-env.js; everything else stays private to the owner.

create table if not exists public.project_env_vars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key)
);

create index if not exists project_env_vars_project_idx on public.project_env_vars (project_id);

alter table public.project_env_vars enable row level security;

drop policy if exists "Users can view own project env vars" on public.project_env_vars;
create policy "Users can view own project env vars" on public.project_env_vars
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own project env vars" on public.project_env_vars;
create policy "Users can insert own project env vars" on public.project_env_vars
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own project env vars" on public.project_env_vars;
create policy "Users can update own project env vars" on public.project_env_vars
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own project env vars" on public.project_env_vars;
create policy "Users can delete own project env vars" on public.project_env_vars
  for delete using (auth.uid() = user_id);

drop trigger if exists project_env_vars_set_updated_at on public.project_env_vars;
create trigger project_env_vars_set_updated_at
  before update on public.project_env_vars
  for each row execute function public.set_updated_at();

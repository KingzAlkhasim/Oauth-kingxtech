-- Run this once in Supabase Dashboard → SQL Editor.
-- kxpert_sessions: a browsable list of past conversations (title + recency),
-- separate from kxpert_messages which holds the actual turn-by-turn content.
-- kxpert_usage_log: one row per AI call, powering the Console usage view.

create table if not exists public.kxpert_sessions (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kxpert_sessions_user_idx
  on public.kxpert_sessions (user_id, updated_at desc);

alter table public.kxpert_sessions enable row level security;

drop policy if exists "Users can view own sessions" on public.kxpert_sessions;
create policy "Users can view own sessions" on public.kxpert_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own sessions" on public.kxpert_sessions;
create policy "Users can insert own sessions" on public.kxpert_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own sessions" on public.kxpert_sessions;
create policy "Users can update own sessions" on public.kxpert_sessions
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own sessions" on public.kxpert_sessions;
create policy "Users can delete own sessions" on public.kxpert_sessions
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------------------

create table if not exists public.kxpert_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete set null,
  provider text not null,
  model_code text not null,
  credit_cost integer not null,
  created_at timestamptz not null default now()
);

create index if not exists kxpert_usage_log_user_idx
  on public.kxpert_usage_log (user_id, created_at desc);

alter table public.kxpert_usage_log enable row level security;

drop policy if exists "Users can view own usage log" on public.kxpert_usage_log;
create policy "Users can view own usage log" on public.kxpert_usage_log
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own usage log" on public.kxpert_usage_log;
create policy "Users can insert own usage log" on public.kxpert_usage_log
  for insert with check (auth.uid() = user_id);

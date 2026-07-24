-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs K-XpertAI conversation history: each row is one turn (user or
-- model) in a session, scoped to the authenticated user who owns it.

create table if not exists public.kxpert_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id text not null,
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists kxpert_messages_session_idx
  on public.kxpert_messages (user_id, session_id, created_at asc);

alter table public.kxpert_messages enable row level security;

drop policy if exists "Users can view own kxpert messages" on public.kxpert_messages;
create policy "Users can view own kxpert messages" on public.kxpert_messages
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own kxpert messages" on public.kxpert_messages;
create policy "Users can insert own kxpert messages" on public.kxpert_messages
  for insert with check (auth.uid() = user_id);

-- Intentionally no update policy — messages are immutable once written.

drop policy if exists "Users can delete own kxpert messages" on public.kxpert_messages;
create policy "Users can delete own kxpert messages" on public.kxpert_messages
  for delete using (auth.uid() = user_id);

-- Optional: cap how much history piles up per user. Uncomment and schedule
-- via pg_cron if you want automatic pruning of old sessions.
-- delete from public.kxpert_messages where created_at < now() - interval '30 days';

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

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

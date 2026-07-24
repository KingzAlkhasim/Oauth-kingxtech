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

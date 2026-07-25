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

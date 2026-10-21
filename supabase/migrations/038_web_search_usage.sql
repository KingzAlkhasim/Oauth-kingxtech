-- Web search for the AI agent. Used only to enforce per-user and global limits so the free
-- search quota is not used up by one account. Server-written; nothing here is readable by users.

create table if not exists public.web_search_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);
create index if not exists web_search_usage_user_idx on public.web_search_usage (user_id, created_at desc);
create index if not exists web_search_usage_created_idx on public.web_search_usage (created_at desc);
alter table public.web_search_usage enable row level security;
-- No policies: only the server (service role) reads or writes this table.

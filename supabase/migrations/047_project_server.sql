-- Project servers: a Pro project can run its own Node server (an API) that sleeps when idle
-- and wakes on the first request. This table only records whether the owner turned it on.
create table if not exists public.project_server_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.project_server_settings enable row level security;
revoke all on public.project_server_settings from anon, authenticated;
-- No policies: only the backend (service role) reads and writes this table.

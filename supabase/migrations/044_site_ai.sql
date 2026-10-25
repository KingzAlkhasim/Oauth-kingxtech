-- "AI for your site": lets a published site's chatbot call KingxTech's AI through the
-- backend, so the owner's API key never reaches the visitor's browser.
create table if not exists public.project_ai (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  model_code text not null default 'qwen',
  system_prompt text not null default '' check (char_length(system_prompt) <= 2000),
  daily_limit integer not null default 100 check (daily_limit between 1 and 5000),
  updated_at timestamptz not null default now()
);
alter table public.project_ai enable row level security;
-- No policies: only the backend (service role) reads and writes this table.

create table if not exists public.project_ai_usage (
  project_id uuid not null references public.projects(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  primary key (project_id, day)
);
alter table public.project_ai_usage enable row level security;

-- Takes one request from today's allowance. Returns false when the daily limit is reached.
create or replace function public.take_project_ai_request(p_project uuid, p_limit integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    insert into public.project_ai_usage (project_id, day, requests)
    values (p_project, (now() at time zone 'utc')::date, 1)
    on conflict (project_id, day)
    do update set requests = public.project_ai_usage.requests + 1
      where public.project_ai_usage.requests < greatest(1, least(coalesce(p_limit, 1), 5000))
    returning 1
  )
  select exists (select 1 from taken)
$$;
revoke all on function public.take_project_ai_request(uuid, integer) from public, anon, authenticated;
grant execute on function public.take_project_ai_request(uuid, integer) to service_role;

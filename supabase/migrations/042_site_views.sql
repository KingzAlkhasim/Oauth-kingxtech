-- Daily page-view counts per published site. No IPs, cookies or visitor identifiers.
create table if not exists public.site_views (
  project_id uuid not null references public.projects(id) on delete cascade,
  day date not null,
  views integer not null default 0,
  primary key (project_id, day)
);
alter table public.site_views enable row level security;
-- No policies: only the backend (service role) reads and writes this table.

create or replace function public.record_site_views(p_project uuid, p_count integer default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.site_views (project_id, day, views)
  values (p_project, (now() at time zone 'utc')::date, greatest(1, least(coalesce(p_count, 1), 1000)))
  on conflict (project_id, day)
  do update set views = public.site_views.views + excluded.views
$$;
revoke all on function public.record_site_views(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_site_views(uuid, integer) to service_role;

-- Server usage card: a small request counter so an owner can see which endpoints are hit and whether it is bots.
-- One row per project, UTC day, normalised path, visitor type and status class. Counts only: no IPs, no query
-- strings, no bodies. Paths are capped at 60 distinct per project per day (the rest go to "(other)") and rows
-- older than 35 days are removed. Additive; touches no existing table. Service role only.

create table if not exists public.project_server_hits (
  project_id uuid not null,
  day date not null,
  path text not null,
  agent text not null check (agent in ('browser', 'bot', 'other')),
  status_class smallint not null check (status_class between 1 and 5),
  hits bigint not null default 0,
  primary key (project_id, day, path, agent, status_class)
);
alter table public.project_server_hits enable row level security;
revoke all on public.project_server_hits from public, anon, authenticated;

create or replace function public.ps_record_hit(p_project uuid, p_path text, p_agent text, p_status int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_path text := left(coalesce(nullif(p_path, ''), '/'), 120);
  v_agent text := case when p_agent in ('browser', 'bot') then p_agent else 'other' end;
  v_class smallint := greatest(1, least(5, p_status / 100));
begin
  if not exists (select 1 from public.project_server_hits where project_id = p_project and day = v_day and path = v_path) then
    if (select count(distinct path) from public.project_server_hits where project_id = p_project and day = v_day) >= 60 then
      v_path := '(other)';
    end if;
  end if;
  insert into public.project_server_hits (project_id, day, path, agent, status_class, hits)
  values (p_project, v_day, v_path, v_agent, v_class, 1)
  on conflict (project_id, day, path, agent, status_class) do update set hits = public.project_server_hits.hits + 1;
  if random() < 0.01 then
    delete from public.project_server_hits where day < v_day - 35;
  end if;
end $$;

-- Hits for one of the owner's projects in a UTC month (default: this one).
create or replace function public.ps_hits_summary(p_owner uuid, p_project uuid, p_month timestamptz default null, p_limit int default 5)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with m as (
    select (date_trunc('month', coalesce(p_month, now()) at time zone 'UTC'))::date as ms
  ), h as (
    select x.* from public.project_server_hits x, m
    where x.project_id = p_project and x.day >= m.ms and x.day < (m.ms + interval '1 month')::date
      and exists (select 1 from public.projects p where p.id = p_project and p.user_id = p_owner)
  ), top as (
    select path, sum(hits)::bigint as hits, sum(hits) filter (where status_class >= 4)::bigint as errors,
           sum(hits) filter (where agent = 'bot')::bigint as bot_hits
    from h group by path order by sum(hits) desc, path limit greatest(1, least(p_limit, 20))
  )
  select jsonb_build_object(
    'total', coalesce((select sum(hits) from h), 0),
    'browser', coalesce((select sum(hits) from h where agent = 'browser'), 0),
    'bot', coalesce((select sum(hits) from h where agent = 'bot'), 0),
    'other', coalesce((select sum(hits) from h where agent = 'other'), 0),
    'top', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'hits', hits, 'errors', coalesce(errors, 0), 'bot', coalesce(bot_hits, 0)) order by hits desc, path) from top), '[]'::jsonb)
  )
$$;

revoke all on function public.ps_record_hit(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.ps_hits_summary(uuid, uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.ps_record_hit(uuid, text, text, int) to service_role;
grant execute on function public.ps_hits_summary(uuid, uuid, timestamptz, int) to service_role;

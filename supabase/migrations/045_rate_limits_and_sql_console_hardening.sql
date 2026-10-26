-- 045: shared rate limiting + a safer SQL console
-- Safe to re-run. Apply in the Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────
-- 1. Shared rate limiter.
--    The in-memory limiter in core/src/middleware/rateLimit.ts resets on every
--    serverless cold start and is not shared between instances. This table gives
--    all instances one counter. Only the backend (service_role) can use it.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

alter table public.rate_limits enable row level security;   -- no policies: API access denied
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.take_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    count        = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1   else r.count + 1 end
  returning count into v_count;

  -- Housekeeping: now and then, drop counters nobody has touched for a day.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.take_rate_limit(text, integer, integer) from public, anon, authenticated;
grant  execute on function public.take_rate_limit(text, integer, integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. SQL console (Console → Database). It must stay a read-only viewer of the
--    caller's own rows. Row level security already limits which rows are visible;
--    this version additionally refuses:
--      - any function call that is not on a short list of harmless ones
--        (so it cannot call money, admin or sleep functions),
--      - system catalogs and other schemas (auth, storage, vault, pg_*, ...),
--      - quotes, comments, dollar-quoting, semicolons,
--      - anything over 2,000 characters, and queries running longer than 3 seconds.
-- ─────────────────────────────────────────────────────────────
create or replace function public.run_readonly_query(query text)
returns setof json
language plpgsql
set search_path = public
set statement_timeout = '3s'
as $$
declare
  normalized text := trim(query);
  fn text;
  allowed_fns constant text[] := array[
    -- aggregates / scalar helpers
    'count','sum','avg','min','max','coalesce','nullif','greatest','least','abs','round','floor','ceil','ceiling',
    'lower','upper','length','char_length','trim','ltrim','rtrim','substring','substr','left','right','replace','concat','position',
    -- dates
    'now','date_trunc','extract','date_part','to_char','age',
    -- SQL syntax words that happen to be followed by "("
    'in','and','or','not','exists','any','all','some','from','join','on','where','select','as','by','having','over','filter',
    'between','case','when','then','else','end','values','using','distinct','limit','offset','like','ilike','similar','is','union',
    'intersect','except','order','group','partition','cast','array','row','interval','with','lateral','inner','left','right','full','cross','natural','outer'
  ];
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if normalized is null or normalized = '' then
    raise exception 'Query cannot be empty';
  end if;
  if length(normalized) > 2000 then
    raise exception 'Query is too long (max 2000 characters)';
  end if;
  if normalized !~* '^select\s' then
    raise exception 'Only SELECT statements are allowed';
  end if;
  if normalized ~ '[;"$\\]' or normalized ~ '--' or normalized ~ '/\*' then
    raise exception 'Semicolons, quotes, comments and dollar-quoting are not allowed';
  end if;
  if normalized ~* '\m(insert|update|delete|drop|alter|grant|revoke|truncate|create|execute|call|copy|vacuum|into|set|reset|listen|notify|do|lock|comment|security|prepare|declare|fetch|refresh)\M' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;
  if normalized ~* '\m(pg_[a-z0-9_]*|information_schema|auth|storage|vault|extensions|supabase_[a-z0-9_]*|net|cron|realtime|graphql[a-z_]*|current_setting|set_config|current_user|session_user|current_database|version)\M' then
    raise exception 'System tables and schemas are not available here';
  end if;

  -- Every "name(" must be an allowed function or SQL keyword.
  for fn in
    select lower(m[1]) from regexp_matches(normalized, '([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', 'g') as m
  loop
    if not (fn = any (allowed_fns)) then
      raise exception 'Function "%" is not allowed in the SQL console', fn;
    end if;
  end loop;

  return query execute format('select row_to_json(t) from (%s) t limit 200', normalized);
end;
$$;

revoke execute on function public.run_readonly_query(text) from public, anon;
grant  execute on function public.run_readonly_query(text) to authenticated, service_role;

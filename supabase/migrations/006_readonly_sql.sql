-- Run this once in Supabase Dashboard → SQL Editor.
-- Backs the Console → KX Cloud → Database tab's SQL editor.
--
-- Security model (read this before enabling):
--   - Runs as SECURITY INVOKER (the default) — it executes as the calling
--     user, so Row Level Security on every table still applies. A user can
--     only ever see rows their own RLS policies already allow.
--   - Rejects anything that isn't a single SELECT statement: no INSERT,
--     UPDATE, DELETE, DROP, ALTER, GRANT, multiple statements via ';', or
--     comments used to smuggle a second statement.
--   - Still, letting users run arbitrary SELECTs against your schema is a
--     meaningful trust decision — only run this migration if you're
--     comfortable with authenticated users introspecting table structure
--     within what RLS already permits them to read.

create or replace function public.run_readonly_query(query text)
returns setof json
language plpgsql
security invoker
as $$
declare
  normalized text := trim(query);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if normalized = '' then
    raise exception 'Query cannot be empty';
  end if;

  if normalized !~* '^select\s' then
    raise exception 'Only SELECT statements are allowed';
  end if;

  if normalized ~ ';' then
    raise exception 'Only a single statement is allowed (no semicolons)';
  end if;

  if normalized ~* '\b(insert|update|delete|drop|alter|grant|revoke|truncate|create|execute|call|copy|vacuum)\b' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;

  return query execute format('select row_to_json(t) from (%s) t limit 200', normalized);
end;
$$;

comment on function public.run_readonly_query is
  'Executes a single validated read-only SELECT for the Console SQL editor. Runs as SECURITY INVOKER so RLS still applies.';

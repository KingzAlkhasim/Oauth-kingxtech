-- Phase 4: cap concurrent paid AI runs per user.
-- The spend cap is checked before a run and recorded after it, so N parallel runs
-- could each pass the check and overshoot the cap by N x maxRunCostUsd.
-- A run takes a short lease; a crashed or timed-out run frees its slot when the lease expires.

create table if not exists public.ai_run_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  expires_at timestamptz not null
);
create index if not exists ai_run_slots_user_idx on public.ai_run_slots (user_id, expires_at);

alter table public.ai_run_slots enable row level security;
-- No policies: only the service role (which bypasses RLS) touches this table.

create or replace function public.ai_run_acquire(p_user uuid, p_max int, p_lease_seconds int)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_active int;
begin
  if p_max < 1 or p_lease_seconds < 1 then
    raise exception 'invalid limits';
  end if;
  -- Serialise per user so two simultaneous calls cannot both see a free slot.
  perform pg_advisory_xact_lock(hashtextextended('ai_run:' || p_user::text, 0));
  delete from public.ai_run_slots where user_id = p_user and expires_at <= now();
  select count(*) into v_active from public.ai_run_slots where user_id = p_user;
  if v_active >= p_max then
    return null;
  end if;
  insert into public.ai_run_slots (user_id, expires_at)
  values (p_user, now() + make_interval(secs => p_lease_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_run_release(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.ai_run_slots where id = p_id;
$$;

revoke all on function public.ai_run_acquire(uuid, int, int) from public, anon, authenticated;
revoke all on function public.ai_run_release(uuid) from public, anon, authenticated;
grant execute on function public.ai_run_acquire(uuid, int, int) to service_role;
grant execute on function public.ai_run_release(uuid) to service_role;
revoke all on public.ai_run_slots from public, anon, authenticated;

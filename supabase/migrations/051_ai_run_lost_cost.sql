-- Phase 4: charge runs that died before recording their cost.
-- Spend is recorded when a run ends. If the platform kills the run (timeout, crash)
-- nothing is recorded, so the work was free. A slot now carries a reserved cost; when a
-- lease expires without being released, the next acquire bills that reserve.
-- Additive: ai_run_acquire (050) stays in place so a deploy of older code keeps working.

alter table public.ai_run_slots add column if not exists reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0);

create or replace function public.ai_run_acquire2(
  p_user uuid, p_max int, p_lease_seconds int,
  p_reserved_usd numeric, p_session_hours int, p_week_days int, p_tier text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_active int;
  v_lost numeric;
  v_lost_n int;
begin
  if p_max < 1 or p_lease_seconds < 1 or p_reserved_usd < 0 or p_session_hours < 1 or p_week_days < 1 then
    raise exception 'invalid limits';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_run:' || p_user::text, 0));

  -- Runs whose lease ran out without a release never recorded their cost: bill the reserve.
  select coalesce(sum(reserved_usd), 0), count(*) into v_lost, v_lost_n
    from public.ai_run_slots where user_id = p_user and expires_at <= now();
  if v_lost_n > 0 then
    delete from public.ai_run_slots where user_id = p_user and expires_at <= now();
    if v_lost > 0 then
      perform public.ai_usage_record(p_user, v_lost, p_session_hours, p_week_days);
      insert into public.ai_usage_ledger (user_id, source, provider, model_code, cost_usd, tier_at_time, usage_estimated)
      values (p_user, 'agent', 'system', 'run_lost', v_lost, p_tier, true);
    end if;
  end if;

  select count(*) into v_active from public.ai_run_slots where user_id = p_user;
  if v_active >= p_max then
    return null;
  end if;
  insert into public.ai_run_slots (user_id, expires_at, reserved_usd)
  values (p_user, now() + make_interval(secs => p_lease_seconds), p_reserved_usd)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_run_acquire2(uuid, int, int, numeric, int, int, text) from public, anon, authenticated;
grant execute on function public.ai_run_acquire2(uuid, int, int, numeric, int, int, text) to service_role;

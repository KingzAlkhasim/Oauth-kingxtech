-- Project servers (Pro): lifecycle, usage accounting and limits.
--
-- Design rules
--  * The database is the single source of truth for "is this server starting / running / stopping". Nothing
--    depends on process-local memory, so any number of serverless instances can coordinate.
--  * Every state change is a guarded, atomic function (generation + lease), so stale or duplicate workers cannot
--    overwrite newer state and an interrupted start/stop is recoverable by the reaper.
--  * Usage is recorded per Vercel Sandbox session (one sandbox per project). A session is idempotent by its
--    session id, so retries can never double count. Each row says whether its numbers are measured (reported by
--    the platform after the session stopped) or estimated (derived from our own clock while it is running).
--  * Allowances live in a table (not in code) and are enforced server-side. A missing plan row means no access.
--  * No dollar amounts are stored: the platform bills the whole account and does not attribute dollars per project.
--  * Everything here is service_role only (RLS on, no policies, all privileges revoked from anon/authenticated).

-- 1. Owner on/off switch (kept from the first version of this migration).
create table if not exists public.project_server_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 2. Platform-wide emergency stop (single row).
create table if not exists public.project_server_platform (
  id smallint primary key default 1 check (id = 1),
  kill_switch boolean not null default false,
  reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.project_server_platform (id) values (1) on conflict (id) do nothing;

-- 3. Per-owner admin controls (suspension and a bounded allowance multiplier).
create table if not exists public.project_server_owner_controls (
  owner_id uuid primary key,
  suspended boolean not null default false,
  reason text,
  allowance_multiplier numeric(4,2) not null default 1 check (allowance_multiplier >= 0 and allowance_multiplier <= 5),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- 4. Allowances per plan. Editable without a deploy. These are product allowances, NOT infrastructure costs.
create table if not exists public.project_server_plan_limits (
  tier text primary key,
  monthly_wall_seconds bigint not null check (monthly_wall_seconds >= 0),          -- all of an owner's servers together
  project_wall_seconds bigint not null check (project_wall_seconds >= 0),          -- any single project
  monthly_active_cpu_seconds bigint not null check (monthly_active_cpu_seconds >= 0),
  monthly_egress_bytes bigint not null check (monthly_egress_bytes >= 0),
  max_running_per_owner int not null check (max_running_per_owner >= 0),
  max_enabled_projects int not null check (max_enabled_projects >= 0),
  updated_at timestamptz not null default now()
);
-- Proposed starting allowances. Review before production; the free tier intentionally has no row (no access).
insert into public.project_server_plan_limits
  (tier, monthly_wall_seconds, project_wall_seconds, monthly_active_cpu_seconds, monthly_egress_bytes, max_running_per_owner, max_enabled_projects)
values
  ('pro',      180000,  90000,  36000, 21474836480, 2, 3),
  ('pro_plus', 540000, 270000, 108000, 64424509440, 5, 10)
on conflict (tier) do nothing;

-- 5. Lifecycle state, one row per project.
create table if not exists public.project_server_runtime (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null,
  tier text,                      -- plan at the time of the last start, so the reaper can enforce that plan's allowance
  state text not null default 'STOPPED' check (state in ('STOPPED','STARTING','READY','IDLE','STOPPING','FAILED')),
  generation bigint not null default 0,
  lease_holder text,
  lease_expires_at timestamptz,
  session_id text,
  last_request_at timestamptz,
  started_at timestamptz,
  fail_count int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists project_server_runtime_owner_idx on public.project_server_runtime(owner_id, state);
create index if not exists project_server_runtime_state_idx on public.project_server_runtime(state, last_request_at);

-- 6. Usage ledger: one row per sandbox session. The primary key makes recording idempotent.
create table if not exists public.project_server_sessions (
  session_id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  started_at timestamptz not null,
  stopped_at timestamptz,
  wall_ms bigint,                 -- measured when basis = 'measured'
  active_cpu_ms bigint,           -- measured only; null until the platform reports it
  egress_bytes bigint,            -- measured only
  ingress_bytes bigint,           -- measured only
  vcpus int,
  memory_mb int,                  -- ALLOCATED size, not use: memory use is not reported by the platform
  basis text not null default 'estimated' check (basis in ('estimated','measured')),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_server_sessions_owner_idx on public.project_server_sessions(owner_id, started_at);
create index if not exists project_server_sessions_project_idx on public.project_server_sessions(project_id, started_at);
create index if not exists project_server_sessions_open_idx on public.project_server_sessions(basis, stopped_at);

-- 7. Append-only audit trail of decisions and admin actions.
create table if not exists public.project_server_events (
  id bigint generated always as identity primary key,
  project_id uuid,
  owner_id uuid,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists project_server_events_project_idx on public.project_server_events(project_id, created_at desc);
create index if not exists project_server_events_kind_idx on public.project_server_events(kind, created_at desc);

alter table public.project_server_settings enable row level security;
alter table public.project_server_platform enable row level security;
alter table public.project_server_owner_controls enable row level security;
alter table public.project_server_plan_limits enable row level security;
alter table public.project_server_runtime enable row level security;
alter table public.project_server_sessions enable row level security;
alter table public.project_server_events enable row level security;
revoke all on public.project_server_settings, public.project_server_platform, public.project_server_owner_controls,
  public.project_server_plan_limits, public.project_server_runtime, public.project_server_sessions,
  public.project_server_events from anon, authenticated;

-- 8. Helpers ---------------------------------------------------------------------------------------------------

create or replace function public.ps_event(p_project uuid, p_owner uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.project_server_events (project_id, owner_id, kind, detail) values (p_project, p_owner, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

-- Is the owner blocked (account suspension, admin suspension)? Returns the reason or null.
create or replace function public.ps_block_reason(p_owner uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_susp boolean; v_acc boolean := false;
begin
  select suspended into v_susp from public.project_server_owner_controls where owner_id = p_owner;
  if coalesce(v_susp, false) then return 'owner_suspended'; end if;
  if to_regclass('public.account_status') is not null then
    execute 'select coalesce(suspended, false) from public.account_status where user_id = $1' into v_acc using p_owner;
    if coalesce(v_acc, false) then return 'account_suspended'; end if;
  end if;
  return null;
end $$;

-- Usage for the current UTC month. "Wall" counts measured sessions at their measured length, finished-but-unmeasured
-- sessions at our own stop time, and running sessions up to now. CPU and egress are measured only, so they lag until
-- the platform reports them after the session stops (that lag is deliberate: nothing is invented).
create or replace function public.ps_usage(p_owner uuid, p_project uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with m as (select (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as s),
  rows as (
    select s.*, m.s as month_start,
      -- time of this session that falls inside the current month, so a server that keeps running across midnight on the
      -- 1st is still counted against the new month and cannot escape its allowance
      greatest(0, (extract(epoch from (least(coalesce(s.stopped_at, now()), now()) - greatest(s.started_at, m.s))) * 1000)::bigint) as overlap_ms,
      greatest(1, (extract(epoch from (coalesce(s.stopped_at, now()) - s.started_at)) * 1000)::bigint) as span_ms
    from public.project_server_sessions s, m
    where s.owner_id = p_owner and (p_project is null or s.project_id = p_project)
      and (s.started_at >= m.s or s.stopped_at is null or s.stopped_at >= m.s)
  ),
  eff as (
    select rows.*,
      case
        when started_at >= month_start and basis = 'measured' and wall_ms is not null then wall_ms
        when started_at >= month_start and stopped_at is not null then greatest(0, (extract(epoch from (stopped_at - started_at)) * 1000)::bigint)
        when started_at >= month_start then greatest(0, (extract(epoch from (now() - started_at)) * 1000)::bigint)
        when basis = 'measured' and wall_ms is not null then (wall_ms::numeric * overlap_ms / span_ms)::bigint
        else overlap_ms
      end as eff_wall_ms,
      (started_at >= month_start) as in_month
    from rows
  )
  select jsonb_build_object(
    'period_start', (select s from m),
    'sessions', count(*),
    'wall_ms_measured', coalesce(sum(eff_wall_ms) filter (where basis = 'measured'), 0),
    'wall_ms_estimated', coalesce(sum(eff_wall_ms) filter (where basis = 'estimated'), 0),
    'wall_ms_total', coalesce(sum(eff_wall_ms), 0),
    'active_cpu_ms_measured', coalesce(sum(active_cpu_ms) filter (where basis = 'measured' and in_month), 0),
    'egress_bytes_measured', coalesce(sum(egress_bytes) filter (where basis = 'measured' and in_month), 0),
    'ingress_bytes_measured', coalesce(sum(ingress_bytes) filter (where basis = 'measured' and in_month), 0),
    'unmeasured_sessions', count(*) filter (where basis = 'estimated')
  ) from eff;
$$;

-- Allowance check for one project. Returns {ok, reason, usage, limits}. Reasons are stable codes the API maps to messages.
create or replace function public.ps_quota(p_owner uuid, p_project uuid, p_tier text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.project_server_plan_limits%rowtype;
  mult numeric := 1;
  u_owner jsonb; u_proj jsonb;
  lim_wall bigint; lim_proj bigint; lim_cpu bigint; lim_egress bigint;
begin
  select * into l from public.project_server_plan_limits where tier = p_tier;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_plan'); end if;
  select allowance_multiplier into mult from public.project_server_owner_controls where owner_id = p_owner;
  mult := coalesce(mult, 1);
  lim_wall := floor(l.monthly_wall_seconds * mult) * 1000;
  lim_proj := floor(l.project_wall_seconds * mult) * 1000;
  lim_cpu := floor(l.monthly_active_cpu_seconds * mult) * 1000;
  lim_egress := floor(l.monthly_egress_bytes * mult);
  u_owner := public.ps_usage(p_owner, null);
  u_proj := public.ps_usage(p_owner, p_project);
  return jsonb_build_object(
    'ok', not (
      (u_owner->>'wall_ms_total')::bigint >= lim_wall or (u_proj->>'wall_ms_total')::bigint >= lim_proj
      or (u_owner->>'active_cpu_ms_measured')::bigint >= lim_cpu or (u_owner->>'egress_bytes_measured')::bigint >= lim_egress),
    'reason', case
      when (u_owner->>'wall_ms_total')::bigint >= lim_wall then 'quota_owner_hours'
      when (u_proj->>'wall_ms_total')::bigint >= lim_proj then 'quota_project_hours'
      when (u_owner->>'active_cpu_ms_measured')::bigint >= lim_cpu then 'quota_cpu'
      when (u_owner->>'egress_bytes_measured')::bigint >= lim_egress then 'quota_egress'
      else null end,
    'usage_owner', u_owner, 'usage_project', u_proj,
    'limits', jsonb_build_object('owner_wall_ms', lim_wall, 'project_wall_ms', lim_proj, 'active_cpu_ms', lim_cpu,
      'egress_bytes', lim_egress, 'max_running', l.max_running_per_owner, 'max_enabled_projects', l.max_enabled_projects, 'multiplier', mult)
  );
end $$;

-- Turning a server on/off. Enabling is capped per plan, serialised per owner so parallel clicks cannot exceed the cap.
create or replace function public.ps_set_enabled(p_project uuid, p_owner uuid, p_tier text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.project_server_plan_limits%rowtype; v_block text; v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('ps_owner:' || p_owner::text, 0));
  if not exists (select 1 from public.projects where id = p_project and user_id = p_owner) then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if p_enabled then
    select * into l from public.project_server_plan_limits where tier = p_tier;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_plan'); end if;
    v_block := public.ps_block_reason(p_owner);
    if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
    select count(*) into v_count from public.project_server_settings s join public.projects p on p.id = s.project_id
      where p.user_id = p_owner and s.enabled and s.project_id <> p_project;
    if v_count >= l.max_enabled_projects then
      perform public.ps_event(p_project, p_owner, 'enable_denied', jsonb_build_object('reason', 'enabled_cap'));
      return jsonb_build_object('ok', false, 'reason', 'enabled_cap');
    end if;
  end if;
  insert into public.project_server_settings (project_id, enabled, updated_at) values (p_project, p_enabled, now())
    on conflict (project_id) do update set enabled = excluded.enabled, updated_at = now();
  perform public.ps_event(p_project, p_owner, case when p_enabled then 'enabled' else 'disabled' end);
  return jsonb_build_object('ok', true);
end $$;

-- 9. Lifecycle ----------------------------------------------------------------------------------------------------

-- Decide what the caller must do. Serialised per project (row lock) and per owner (advisory lock for the running cap).
-- action: 'ready' (already running), 'wait' (another worker is starting/stopping it), 'start' (caller owns the start,
-- must report with the returned generation) or 'denied' (reason says why).
create or replace function public.ps_begin_start(
  p_project uuid, p_owner uuid, p_tier text, p_holder text,
  p_lease_seconds int default 150, p_max_global_starts int default 6, p_idle_seconds int default 600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.project_server_runtime%rowtype;
  l public.project_server_plan_limits%rowtype;
  v_block text; v_kill boolean; v_q jsonb; v_running int; v_starting int;
begin
  select kill_switch into v_kill from public.project_server_platform where id = 1;
  if coalesce(v_kill, false) then return jsonb_build_object('action','denied','reason','platform_stopped'); end if;
  v_block := public.ps_block_reason(p_owner);
  if v_block is not null then
    perform public.ps_event(p_project, p_owner, 'start_denied', jsonb_build_object('reason', v_block));
    return jsonb_build_object('action','denied','reason', v_block);
  end if;
  select * into l from public.project_server_plan_limits where tier = p_tier;
  if not found then return jsonb_build_object('action','denied','reason','no_plan'); end if;
  if not exists (select 1 from public.project_server_settings where project_id = p_project and enabled) then
    return jsonb_build_object('action','denied','reason','disabled');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ps_owner:' || p_owner::text, 0));
  insert into public.project_server_runtime (project_id, owner_id) values (p_project, p_owner) on conflict (project_id) do nothing;
  select * into r from public.project_server_runtime where project_id = p_project for update;
  if r.owner_id <> p_owner then return jsonb_build_object('action','denied','reason','not_owner'); end if;

  v_q := public.ps_quota(p_owner, p_project, p_tier);
  if not (v_q->>'ok')::boolean then
    perform public.ps_event(p_project, p_owner, 'start_denied', jsonb_build_object('reason', v_q->>'reason'));
    return jsonb_build_object('action','denied','reason', v_q->>'reason');
  end if;

  if r.state in ('READY','IDLE') then
    -- A running row whose sandbox the reaper has not yet noticed as dead is handled by the caller's health check.
    update public.project_server_runtime set last_request_at = now(), state = 'READY', updated_at = now() where project_id = p_project;
    return jsonb_build_object('action','ready','generation', r.generation);
  end if;
  if r.state in ('STARTING','STOPPING') and r.lease_expires_at is not null and r.lease_expires_at > now() then
    return jsonb_build_object('action','wait','generation', r.generation, 'state', r.state);
  end if;
  if r.next_attempt_at is not null and r.next_attempt_at > now() then
    return jsonb_build_object('action','denied','reason','backoff','retry_after', ceil(extract(epoch from (r.next_attempt_at - now())))::int);
  end if;

  select count(*) into v_running from public.project_server_runtime
    where owner_id = p_owner and project_id <> p_project
      and (state in ('READY','IDLE') or (state = 'STARTING' and lease_expires_at > now()));
  if v_running >= l.max_running_per_owner then
    perform public.ps_event(p_project, p_owner, 'start_denied', jsonb_build_object('reason','owner_concurrency'));
    return jsonb_build_object('action','denied','reason','owner_concurrency');
  end if;
  select count(*) into v_starting from public.project_server_runtime where state = 'STARTING' and lease_expires_at > now();
  if v_starting >= p_max_global_starts then return jsonb_build_object('action','denied','reason','busy'); end if;

  update public.project_server_runtime
    set state = 'STARTING', tier = p_tier, generation = generation + 1, lease_holder = p_holder,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_error = null, updated_at = now()
    where project_id = p_project returning * into r;
  perform public.ps_event(p_project, p_owner, 'start_begin', jsonb_build_object('generation', r.generation, 'holder', p_holder));
  return jsonb_build_object('action','start','generation', r.generation);
end $$;

-- Starter reports success. Only the current generation may do this; a stale starter gets false and must stop its sandbox.
create or replace function public.ps_mark_ready(
  p_project uuid, p_generation bigint, p_session_id text, p_vcpus int, p_memory_mb int, p_started_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare r public.project_server_runtime%rowtype;
begin
  select * into r from public.project_server_runtime where project_id = p_project for update;
  if not found or r.state <> 'STARTING' or r.generation <> p_generation then return false; end if;
  update public.project_server_runtime
    set state = 'READY', session_id = p_session_id, started_at = coalesce(p_started_at, now()), last_request_at = now(),
        fail_count = 0, next_attempt_at = null, lease_holder = null, lease_expires_at = null, last_error = null, updated_at = now()
    where project_id = p_project;
  insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, vcpus, memory_mb, basis)
    values (p_session_id, p_project, r.owner_id, coalesce(p_started_at, now()), p_vcpus, p_memory_mb, 'estimated')
    on conflict (session_id) do nothing;
  perform public.ps_event(p_project, r.owner_id, 'ready', jsonb_build_object('generation', p_generation, 'session_id', p_session_id));
  return true;
end $$;

-- Starter reports failure: exponential backoff (10s, 20s, 40s ... capped at 10 min) so a crash-looping project cannot burn quota.
create or replace function public.ps_mark_failed(p_project uuid, p_generation bigint, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.project_server_runtime%rowtype;
begin
  select * into r from public.project_server_runtime where project_id = p_project for update;
  if not found or r.state <> 'STARTING' or r.generation <> p_generation then return false; end if;
  update public.project_server_runtime
    set state = 'FAILED', fail_count = fail_count + 1,
        next_attempt_at = now() + make_interval(secs => least(600, 10 * power(2, least(fail_count, 6))::int)),
        lease_holder = null, lease_expires_at = null, last_error = left(coalesce(p_error, 'unknown'), 500), updated_at = now()
    where project_id = p_project;
  perform public.ps_event(p_project, r.owner_id, 'start_failed', jsonb_build_object('generation', p_generation, 'error', left(coalesce(p_error,''), 200)));
  return true;
end $$;

-- Cheap "this server just served a request" signal.
create or replace function public.ps_touch(p_project uuid)
returns void language sql security definer set search_path = public as $$
  update public.project_server_runtime set last_request_at = now(), state = 'READY', updated_at = now()
  where project_id = p_project and state in ('READY','IDLE') and (last_request_at is null or last_request_at < now() - interval '20 seconds');
$$;

-- Claim servers that must be stopped, without two workers ever claiming the same one (FOR UPDATE SKIP LOCKED).
-- Reasons: idle, owner/account suspended, platform kill switch, over allowance, interrupted start or stop (expired lease), failed start debris.
-- p_project (optional) targets one project; p_owner (optional) all of an owner's; p_force stops regardless of idleness.
create or replace function public.ps_claim_stops(
  p_holder text, p_idle_seconds int default 600, p_limit int default 20, p_lease_seconds int default 120,
  p_project uuid default null, p_owner uuid default null, p_force boolean default false
) returns table (project_id uuid, owner_id uuid, session_id text, generation bigint, reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r public.project_server_runtime%rowtype; v_kill boolean; v_reason text; v_q jsonb; c int := 0;
begin
  select kill_switch into v_kill from public.project_server_platform where id = 1;
  for r in
    select * from public.project_server_runtime t
    where (p_project is null or t.project_id = p_project) and (p_owner is null or t.owner_id = p_owner)
      and t.state in ('READY','IDLE','STARTING','STOPPING','FAILED')
    order by t.updated_at
    for update skip locked
  loop
    exit when c >= p_limit;
    v_reason := null;
    if p_force then v_reason := 'forced';
    elsif coalesce(v_kill, false) then v_reason := 'platform_stopped';
    elsif public.ps_block_reason(r.owner_id) is not null then v_reason := public.ps_block_reason(r.owner_id);
    elsif r.state in ('STARTING','STOPPING') and r.lease_expires_at is not null and r.lease_expires_at < now() then v_reason := 'interrupted_' || lower(r.state);
    elsif r.state = 'FAILED' and r.session_id is not null then v_reason := 'failed_debris';
    elsif r.state in ('READY','IDLE') and coalesce(r.last_request_at, r.started_at, r.updated_at) < now() - make_interval(secs => p_idle_seconds) then v_reason := 'idle';
    end if;
    if v_reason is null and r.state in ('READY','IDLE') and r.tier is not null then
      v_q := public.ps_quota(r.owner_id, r.project_id, r.tier);
      if not (v_q->>'ok')::boolean then v_reason := coalesce(v_q->>'reason', 'quota'); end if;
    end if;
    continue when v_reason is null;
    -- A live lease means someone is working on it right now (unless forced or the lease is expired).
    continue when not p_force and r.state in ('STARTING','STOPPING') and r.lease_expires_at > now();

    update public.project_server_runtime t
      set state = 'STOPPING', generation = t.generation + 1, lease_holder = p_holder,
          lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
      where t.project_id = r.project_id;
    perform public.ps_event(r.project_id, r.owner_id, 'stop_claimed', jsonb_build_object('reason', v_reason, 'holder', p_holder));
    project_id := r.project_id; owner_id := r.owner_id; session_id := r.session_id; generation := r.generation + 1; reason := v_reason;
    c := c + 1;
    return next;
  end loop;
end $$;

-- Stop finished. Only the claiming generation may mark it, so a start that happened meanwhile is never clobbered.
create or replace function public.ps_mark_stopped(p_project uuid, p_generation bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.project_server_runtime%rowtype;
begin
  select * into r from public.project_server_runtime where project_id = p_project for update;
  if not found or r.state <> 'STOPPING' or r.generation <> p_generation then return false; end if;
  update public.project_server_runtime
    set state = 'STOPPED', lease_holder = null, lease_expires_at = null, updated_at = now()
    where project_id = p_project;
  -- Close our own estimate for the session that just ended. Measured numbers replace it later and only once.
  update public.project_server_sessions set stopped_at = coalesce(stopped_at, now())
    where session_id = r.session_id and basis = 'estimated';
  perform public.ps_event(p_project, r.owner_id, 'stopped', jsonb_build_object('generation', p_generation, 'session_id', r.session_id));
  return true;
end $$;

-- A stop that failed (sandbox API error): release the lease soon so the reaper retries. State stays STOPPING.
create or replace function public.ps_stop_failed(p_project uuid, p_generation bigint, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.project_server_runtime
    set lease_expires_at = now() + interval '30 seconds', last_error = left(coalesce(p_error,'stop failed'), 500), updated_at = now()
    where project_id = p_project and state = 'STOPPING' and generation = p_generation;
end $$;

-- 10. Usage accounting --------------------------------------------------------------------------------------------

-- Record the platform's measured numbers for a finished session. Idempotent: the first measured write wins, repeats
-- change nothing and are not logged again, so retries and overlapping reconcilers cannot double count.
create or replace function public.ps_record_session_usage(
  p_session_id text, p_project uuid, p_owner uuid, p_started_at timestamptz, p_stopped_at timestamptz,
  p_wall_ms bigint, p_active_cpu_ms bigint, p_egress bigint, p_ingress bigint, p_vcpus int, p_memory_mb int
) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_wall_ms is null or p_wall_ms < 0 or p_active_cpu_ms is null or p_active_cpu_ms < 0 then return false; end if;
  insert into public.project_server_sessions
    (session_id, project_id, owner_id, started_at, stopped_at, wall_ms, active_cpu_ms, egress_bytes, ingress_bytes, vcpus, memory_mb, basis, finalized_at)
  values (p_session_id, p_project, p_owner, p_started_at, p_stopped_at, p_wall_ms, p_active_cpu_ms,
          greatest(0, coalesce(p_egress, 0)), greatest(0, coalesce(p_ingress, 0)), p_vcpus, p_memory_mb, 'measured', now())
  on conflict (session_id) do update
    set stopped_at = excluded.stopped_at, wall_ms = excluded.wall_ms, active_cpu_ms = excluded.active_cpu_ms,
        egress_bytes = excluded.egress_bytes, ingress_bytes = excluded.ingress_bytes,
        vcpus = coalesce(excluded.vcpus, project_server_sessions.vcpus), memory_mb = coalesce(excluded.memory_mb, project_server_sessions.memory_mb),
        basis = 'measured', finalized_at = now()
    where project_server_sessions.basis = 'estimated' and project_server_sessions.project_id = excluded.project_id
      and project_server_sessions.owner_id = excluded.owner_id;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.ps_event(p_project, p_owner, 'usage_measured', jsonb_build_object('session_id', p_session_id, 'wall_ms', p_wall_ms, 'active_cpu_ms', p_active_cpu_ms));
  end if;
  return n > 0;
end $$;

-- Sessions that stopped but still carry only our estimate: the reconciler asks the platform for their measured numbers.
create or replace function public.ps_unmeasured_sessions(p_limit int default 50)
returns table (project_id uuid, owner_id uuid, session_id text)
language sql stable security definer set search_path = public as $$
  select s.project_id, s.owner_id, s.session_id from public.project_server_sessions s
  where s.basis = 'estimated' and s.stopped_at is not null and s.stopped_at < now() - interval '1 minute'
  order by s.stopped_at limit p_limit;
$$;

-- 11. Admin ---------------------------------------------------------------------------------------------------------
create or replace function public.ps_admin_set_kill_switch(p_engaged boolean, p_reason text, p_admin uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.project_server_platform set kill_switch = p_engaged, reason = left(p_reason, 300), updated_by = p_admin, updated_at = now() where id = 1;
  perform public.ps_event(null, null, case when p_engaged then 'kill_switch_on' else 'kill_switch_off' end, jsonb_build_object('admin', p_admin, 'reason', left(coalesce(p_reason,''), 300)));
end $$;

create or replace function public.ps_admin_set_owner(p_owner uuid, p_suspended boolean, p_reason text, p_multiplier numeric, p_admin uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_server_owner_controls (owner_id, suspended, reason, allowance_multiplier, updated_by)
    values (p_owner, coalesce(p_suspended, false), left(p_reason, 300), coalesce(p_multiplier, 1), p_admin)
  on conflict (owner_id) do update
    set suspended = coalesce(p_suspended, project_server_owner_controls.suspended),
        reason = coalesce(left(p_reason, 300), project_server_owner_controls.reason),
        allowance_multiplier = coalesce(p_multiplier, project_server_owner_controls.allowance_multiplier),
        updated_by = p_admin, updated_at = now();
  perform public.ps_event(null, p_owner, 'owner_controls', jsonb_build_object('admin', p_admin, 'suspended', p_suspended, 'multiplier', p_multiplier, 'reason', left(coalesce(p_reason,''), 300)));
end $$;

revoke all on function
  public.ps_set_enabled(uuid, uuid, text, boolean),
  public.ps_event(uuid, uuid, text, jsonb), public.ps_block_reason(uuid), public.ps_usage(uuid, uuid), public.ps_quota(uuid, uuid, text),
  public.ps_begin_start(uuid, uuid, text, text, int, int, int), public.ps_mark_ready(uuid, bigint, text, int, int, timestamptz),
  public.ps_mark_failed(uuid, bigint, text), public.ps_touch(uuid),
  public.ps_claim_stops(text, int, int, int, uuid, uuid, boolean), public.ps_mark_stopped(uuid, bigint), public.ps_stop_failed(uuid, bigint, text),
  public.ps_record_session_usage(text, uuid, uuid, timestamptz, timestamptz, bigint, bigint, bigint, bigint, int, int),
  public.ps_unmeasured_sessions(int), public.ps_admin_set_kill_switch(boolean, text, uuid), public.ps_admin_set_owner(uuid, boolean, text, numeric, uuid)
  from public, anon, authenticated;
grant execute on function
  public.ps_set_enabled(uuid, uuid, text, boolean),
  public.ps_event(uuid, uuid, text, jsonb), public.ps_block_reason(uuid), public.ps_usage(uuid, uuid), public.ps_quota(uuid, uuid, text),
  public.ps_begin_start(uuid, uuid, text, text, int, int, int), public.ps_mark_ready(uuid, bigint, text, int, int, timestamptz),
  public.ps_mark_failed(uuid, bigint, text), public.ps_touch(uuid),
  public.ps_claim_stops(text, int, int, int, uuid, uuid, boolean), public.ps_mark_stopped(uuid, bigint), public.ps_stop_failed(uuid, bigint, text),
  public.ps_record_session_usage(text, uuid, uuid, timestamptz, timestamptz, bigint, bigint, bigint, bigint, int, int),
  public.ps_unmeasured_sessions(int), public.ps_admin_set_kill_switch(boolean, text, uuid), public.ps_admin_set_owner(uuid, boolean, text, numeric, uuid)
  to service_role;

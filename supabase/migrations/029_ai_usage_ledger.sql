-- 029: Real-cost AI usage ledger and plan tiers. Commit only; apply manually after review.
create table if not exists public.ai_usage_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, project_id uuid null,
 source text not null check (source in ('chat','agent','securecheck')), provider text not null, model_code text not null,
 input_tokens integer not null default 0 check(input_tokens>=0), output_tokens integer not null default 0 check(output_tokens>=0),
 cached_input_tokens integer not null default 0 check(cached_input_tokens>=0), cost_usd numeric(12,6) not null check(cost_usd>=0),
 tier_at_time text not null, usage_estimated boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists ai_usage_ledger_user_created_idx on public.ai_usage_ledger(user_id,created_at desc);
alter table public.ai_usage_ledger enable row level security;
drop policy if exists ai_usage_ledger_select_own on public.ai_usage_ledger;
create policy ai_usage_ledger_select_own on public.ai_usage_ledger for select to authenticated using((select auth.uid())=user_id);
grant select on public.ai_usage_ledger to authenticated;
revoke insert,update,delete on public.ai_usage_ledger from anon,authenticated;
create table if not exists public.ai_usage_state (
 user_id uuid primary key, session_start timestamptz, session_spent_usd numeric(12,6) not null default 0 check(session_spent_usd>=0),
 week_start timestamptz, week_spent_usd numeric(12,6) not null default 0 check(week_spent_usd>=0)
);
alter table public.ai_usage_state enable row level security;
drop policy if exists ai_usage_state_select_own on public.ai_usage_state;
create policy ai_usage_state_select_own on public.ai_usage_state for select to authenticated using((select auth.uid())=user_id);
grant select on public.ai_usage_state to authenticated;
revoke insert,update,delete on public.ai_usage_state from anon,authenticated;
create or replace function public.ai_usage_record(p_user_id uuid,p_cost_usd numeric,p_session_hours integer,p_week_days integer)
returns table(session_spent numeric,session_start timestamptz,week_spent numeric,week_start timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_now timestamptz:=now(); v_state public.ai_usage_state%rowtype;
begin
 if p_user_id is null or p_cost_usd is null or p_cost_usd<0 or p_session_hours<=0 or p_week_days<=0 then raise exception 'Invalid AI usage record arguments'; end if;
 insert into public.ai_usage_state(user_id,session_start,session_spent_usd,week_start,week_spent_usd)
 values(p_user_id,v_now,0,v_now,0) on conflict(user_id) do nothing;
 select * into v_state from public.ai_usage_state where user_id=p_user_id for update;
 if v_state.session_start is null or v_state.session_start+make_interval(hours=>p_session_hours)<=v_now then v_state.session_start:=v_now; v_state.session_spent_usd:=0; end if;
 if v_state.week_start is null or v_state.week_start+make_interval(days=>p_week_days)<=v_now then v_state.week_start:=v_now; v_state.week_spent_usd:=0; end if;
 v_state.session_spent_usd:=v_state.session_spent_usd+p_cost_usd; v_state.week_spent_usd:=v_state.week_spent_usd+p_cost_usd;
 update public.ai_usage_state set session_start=v_state.session_start,session_spent_usd=v_state.session_spent_usd,week_start=v_state.week_start,week_spent_usd=v_state.week_spent_usd where user_id=p_user_id;
 return query select v_state.session_spent_usd,v_state.session_start,v_state.week_spent_usd,v_state.week_start;
end $$;
revoke all on function public.ai_usage_record(uuid,numeric,integer,integer) from public,anon,authenticated;
grant execute on function public.ai_usage_record(uuid,numeric,integer,integer) to service_role;
alter table public.billing_profile add column if not exists plan text not null default 'free';
alter table public.billing_profile drop constraint if exists billing_profile_plan_check;
update public.billing_profile set plan='pro' where plan='paid';
alter table public.billing_profile add constraint billing_profile_plan_check check(plan in('free','paid','pro','pro_plus'));
create or replace view public.ai_usage_daily as select user_id,(created_at at time zone 'UTC')::date as day,count(*)::bigint as requests,sum(cost_usd)::numeric(12,6) as cost_usd from public.ai_usage_ledger group by user_id,(created_at at time zone 'UTC')::date;
revoke all on public.ai_usage_daily from public,anon,authenticated;

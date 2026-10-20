-- Admin dashboard, phase B: account review and suspension, plus a private bucket
-- for account data exports.

create table if not exists public.account_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended boolean not null default false,
  reason text,
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.account_status enable row level security;

-- Users may read only their own row (so the app can show the suspended page).
-- Nobody writes through the API: changes go through admin_set_suspension().
drop policy if exists "Users read own account status" on public.account_status;
create policy "Users read own account status" on public.account_status
  for select using (auth.uid() = user_id);

create or replace function public.admin_set_suspension(p_user uuid, p_suspended boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot suspend your own account';
  end if;
  if exists (select 1 from public.admin_users where user_id = p_user) then
    raise exception 'You cannot suspend another admin';
  end if;
  if p_suspended and char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'A reason is required';
  end if;

  insert into public.account_status (user_id, suspended, reason, suspended_at, suspended_by, updated_at)
  values (p_user, p_suspended, case when p_suspended then trim(p_reason) else null end,
          case when p_suspended then now() else null end,
          case when p_suspended then auth.uid() else null end, now())
  on conflict (user_id) do update set
    suspended = excluded.suspended,
    reason = excluded.reason,
    suspended_at = excluded.suspended_at,
    suspended_by = excluded.suspended_by,
    updated_at = now();

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(),
          case when p_suspended then 'account.suspend' else 'account.reinstate' end,
          'user', p_user,
          jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')));
end;
$$;
revoke all on function public.admin_set_suspension(uuid, boolean, text) from public;
grant execute on function public.admin_set_suspension(uuid, boolean, text) to authenticated;

create or replace function public.admin_list_accounts()
returns table (
  user_id uuid, email text, full_name text, created_at timestamptz, last_sign_in_at timestamptz,
  plan text, project_count bigint, ai_requests_30d bigint,
  suspended boolean, suspended_reason text, suspended_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.full_name, u.created_at, u.last_sign_in_at,
         coalesce(b.plan, 'free'),
         (select count(*) from public.projects pr where pr.user_id = u.id),
         (select count(*) from public.ai_usage_ledger l
            where l.user_id = u.id and l.created_at > now() - interval '30 days'),
         coalesce(s.suspended, false), s.reason, s.suspended_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.billing_profile b on b.user_id = u.id
  left join public.account_status s on s.user_id = u.id
  where public.is_admin()
  order by coalesce(s.suspended, false) desc, u.created_at desc;
$$;
revoke all on function public.admin_list_accounts() from public;
grant execute on function public.admin_list_accounts() to authenticated;

-- Private bucket for account data exports (no policies: only the server's service role
-- can write, and users download through short-lived signed links).
insert into storage.buckets (id, name, public)
values ('account-exports', 'account-exports', false)
on conflict (id) do nothing;

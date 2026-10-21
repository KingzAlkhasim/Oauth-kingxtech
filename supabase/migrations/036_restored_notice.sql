-- When an admin reinstates an account, the user sees an "account restored" page with a link
-- to the Terms before continuing. restored_notice_pending drives that page.

alter table public.account_status
  add column if not exists restored_notice_pending boolean not null default false;

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

  insert into public.account_status (user_id, suspended, reason, suspended_at, suspended_by, restored_notice_pending, updated_at)
  values (p_user, p_suspended, case when p_suspended then trim(p_reason) else null end,
          case when p_suspended then now() else null end,
          case when p_suspended then auth.uid() else null end,
          false, now())  -- a first-ever row is never a restoration; the conflict branch handles that
  on conflict (user_id) do update set
    suspended = excluded.suspended,
    reason = excluded.reason,
    suspended_at = excluded.suspended_at,
    suspended_by = excluded.suspended_by,
    restored_notice_pending = case
      when excluded.suspended then false
      when public.account_status.suspended then true      -- was suspended, now restored
      else public.account_status.restored_notice_pending  -- reinstating an active account changes nothing
    end,
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

-- The user confirms they have seen the restored notice and the Terms.
create or replace function public.acknowledge_restoration()
returns void
language sql
security definer
set search_path = public
as $$
  update public.account_status
     set restored_notice_pending = false, updated_at = now()
   where user_id = auth.uid() and suspended = false;
$$;
revoke all on function public.acknowledge_restoration() from public;
grant execute on function public.acknowledge_restoration() to authenticated;

-- Admin dashboard, phase C: abuse flags. The server records flags (service role); admins
-- review them through the functions below. Nothing here is readable by normal users.

create table if not exists public.abuse_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  source text not null check (source in ('ai_prompt', 'published_site')),
  category text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  rule text not null,
  excerpt text,
  hit_count integer not null default 1,
  status text not null default 'new' check (status in ('new', 'auto_dismissed', 'dismissed', 'confirmed')),
  ai_verdict text check (ai_verdict in ('likely_abuse', 'likely_fine', 'unclear')),
  ai_reason text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  note text
);
create index if not exists abuse_flags_queue_idx on public.abuse_flags (status, severity, created_at desc);
create index if not exists abuse_flags_user_idx on public.abuse_flags (user_id, created_at desc);
alter table public.abuse_flags enable row level security;
-- No policies: only the server (service role) and the admin functions below touch this table.

create or replace function public.admin_list_flags(p_view text default 'open')
returns table (
  id uuid, user_id uuid, user_email text, user_name text, project_id uuid, project_name text,
  source text, category text, severity text, rule text, excerpt text, hit_count integer,
  status text, ai_verdict text, ai_reason text, created_at timestamptz, last_seen_at timestamptz,
  note text, user_open_flags bigint, user_suspended boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.user_id, u.email::text, p.full_name, f.project_id, pr.name,
         f.source, f.category, f.severity, f.rule, f.excerpt, f.hit_count,
         f.status, f.ai_verdict, f.ai_reason, f.created_at, f.last_seen_at, f.note,
         (select count(*) from public.abuse_flags x
            where x.user_id = f.user_id and x.status in ('new', 'confirmed')),
         coalesce(s.suspended, false)
  from public.abuse_flags f
  join auth.users u on u.id = f.user_id
  left join public.profiles p on p.id = f.user_id
  left join public.projects pr on pr.id = f.project_id
  left join public.account_status s on s.user_id = f.user_id
  where public.is_admin()
    and (p_view = 'all' or f.status = 'new')
  order by (f.status = 'new') desc,
           case f.severity when 'high' then 0 when 'medium' then 1 else 2 end,
           (f.ai_verdict = 'likely_abuse') desc nulls last,
           f.last_seen_at desc
  limit 200;
$$;
revoke all on function public.admin_list_flags(text) from public;
grant execute on function public.admin_list_flags(text) to authenticated;

create or replace function public.admin_resolve_flag(p_flag uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision not in ('dismissed', 'confirmed') then
    raise exception 'Unknown decision';
  end if;

  update public.abuse_flags
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_flag
   returning user_id into v_user;
  if v_user is null then
    raise exception 'Flag not found';
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(),
          case when p_decision = 'confirmed' then 'abuse.confirm' else 'abuse.dismiss' end,
          'abuse_flag', p_flag,
          jsonb_build_object('user_id', v_user, 'note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;
revoke all on function public.admin_resolve_flag(uuid, text, text) from public;
grant execute on function public.admin_resolve_flag(uuid, text, text) to authenticated;

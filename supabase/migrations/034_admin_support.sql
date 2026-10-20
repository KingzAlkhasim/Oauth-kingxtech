-- Admin dashboard, phase A: support inbox with replies and an audit log.
-- Admin rights live in the database and are enforced by RLS / security definer
-- functions, never only in the UI.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- No policies: nobody reads or writes this through the API. Admins are added in SQL.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Replies on a ticket (admin answers, and the ticket owner's follow-ups).
create table if not exists public.support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_replies_ticket_idx on public.support_replies (ticket_id, created_at);
alter table public.support_replies enable row level security;

drop policy if exists "Owner or admin reads replies" on public.support_replies;
create policy "Owner or admin reads replies" on public.support_replies
  for select using (
    public.is_admin()
    or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

drop policy if exists "Admin writes admin replies" on public.support_replies;
create policy "Admin writes admin replies" on public.support_replies
  for insert with check (public.is_admin() and is_admin and author_id = auth.uid());

drop policy if exists "Owner writes own follow-ups" on public.support_replies;
create policy "Owner writes own follow-ups" on public.support_replies
  for insert with check (
    not is_admin
    and author_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

-- Admins can read and update every ticket (status changes).
drop policy if exists "Admin reads all tickets" on public.support_tickets;
create policy "Admin reads all tickets" on public.support_tickets
  for select using (public.is_admin());

drop policy if exists "Admin updates all tickets" on public.support_tickets;
create policy "Admin updates all tickets" on public.support_tickets
  for update using (public.is_admin()) with check (public.is_admin());

-- Audit log. Written only by triggers below, readable only by admins.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

drop policy if exists "Admin reads audit log" on public.admin_audit_log;
create policy "Admin reads audit log" on public.admin_audit_log
  for select using (public.is_admin());

create or replace function public.audit_admin_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
    values (new.author_id, 'support.reply', 'support_ticket', new.ticket_id, jsonb_build_object('reply_id', new.id));
    update public.support_tickets set status = 'in_progress'
      where id = new.ticket_id and status = 'open';
  end if;
  return new;
end;
$$;
drop trigger if exists support_replies_audit on public.support_replies;
create trigger support_replies_audit after insert on public.support_replies
  for each row execute function public.audit_admin_reply();

create or replace function public.audit_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and public.is_admin() then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'support.status', 'support_ticket', new.id,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;
drop trigger if exists support_tickets_audit on public.support_tickets;
create trigger support_tickets_audit after update on public.support_tickets
  for each row execute function public.audit_ticket_status();

-- Inbox listing with the submitter's name and email (admins only).
create or replace function public.admin_list_tickets()
returns table (
  id uuid, user_id uuid, category text, subject text, message text, status text,
  created_at timestamptz, updated_at timestamptz,
  user_email text, user_name text, reply_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.user_id, t.category, t.subject, t.message, t.status,
         t.created_at, t.updated_at,
         u.email::text, p.full_name,
         (select count(*) from public.support_replies r where r.ticket_id = t.id)
  from public.support_tickets t
  join auth.users u on u.id = t.user_id
  left join public.profiles p on p.id = t.user_id
  where public.is_admin()
  order by (t.status in ('open','in_progress')) desc, t.created_at desc;
$$;
revoke all on function public.admin_list_tickets() from public;
grant execute on function public.admin_list_tickets() to authenticated;

-- First admin.
insert into public.admin_users (user_id)
select id from auth.users where email = 'kidohigh@gmail.com'
on conflict do nothing;

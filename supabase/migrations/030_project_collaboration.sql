-- 030: Phase 1 project collaboration.
-- Additive/idempotent. APPLY MANUALLY AFTER REVIEW; this migration is intentionally
-- not applied by the development agent.
--
-- Security model:
--   owner  = full project control
--   editor = read/write project files and project chat, but cannot manage secrets,
--            members, ownership, domains, or GitHub links
--   viewer = read project files/history and project chat; no writes
-- Existing projects.user_id remains the canonical billing/ownership field.

create table if not exists public.project_members (
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id, project_id);
create index if not exists project_members_project_role_idx on public.project_members(project_id, role);

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  email text not null,
  role text not null check (role in ('editor','viewer')),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_invites_project_idx on public.project_invites(project_id, created_at desc);
create index if not exists project_invites_email_idx on public.project_invites(lower(email), project_id);

create table if not exists public.project_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  from_user_id uuid references auth.users(id) on delete cascade not null,
  to_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists project_transfer_project_idx on public.project_transfer_requests(project_id, created_at desc);
create index if not exists project_transfer_target_idx on public.project_transfer_requests(to_user_id, status, created_at desc);

insert into public.project_members(project_id, user_id, role)
select p.id, p.user_id, 'owner'
from public.projects p
where p.user_id is not null
on conflict (project_id, user_id) do update set role = 'owner';

-- SECURITY DEFINER is deliberate: policies on project_members must not recurse.
create or replace function public.is_project_member(p_project_id uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
      and case p_min_role
        when 'viewer' then pm.role in ('viewer','editor','owner')
        when 'editor' then pm.role in ('editor','owner')
        when 'owner' then pm.role = 'owner'
        else false
      end
  );
$$;
revoke execute on function public.is_project_member(uuid,text) from public, anon;
grant execute on function public.is_project_member(uuid,text) to authenticated;

create or replace function public.project_owner_id(p_project_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select p.user_id from public.projects p where p.id = p_project_id; $$;
revoke execute on function public.project_owner_id(uuid) from public, anon, authenticated;

-- Atomic ownership transfer. Backend passes the authenticated target/actor and
-- this function performs the ownership, membership, GitHub and secret changes as
-- one transaction. Domains and files/history are intentionally preserved.
create or replace function public.accept_project_transfer(p_request_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r public.project_transfer_requests%rowtype; old_owner uuid; new_owner uuid;
begin
  select * into r from public.project_transfer_requests where id = p_request_id for update;
  if not found then raise exception 'Transfer request not found'; end if;
  if r.status <> 'pending' then raise exception 'Transfer request is no longer pending'; end if;
  if r.expires_at <= now() then
    update public.project_transfer_requests set status='expired' where id=r.id;
    raise exception 'Transfer request has expired';
  end if;
  if r.to_user_id <> p_actor_user_id then raise exception 'Only the invited target can accept this transfer'; end if;
  select p.user_id into old_owner from public.projects p where p.id=r.project_id for update;
  if old_owner is null or old_owner <> r.from_user_id then raise exception 'Current project owner changed'; end if;
  new_owner := r.to_user_id;
  if not exists (select 1 from public.project_members where project_id=r.project_id and user_id=new_owner) then
    raise exception 'Transfer target is not a project member';
  end if;
  update public.projects set user_id=new_owner, updated_at=now() where id=r.project_id;
  update public.project_members set role='editor' where project_id=r.project_id and user_id=old_owner;
  update public.project_members set role='owner' where project_id=r.project_id and user_id=new_owner;
  delete from public.project_github_links where project_id=r.project_id;
  update public.project_env_vars set value='' where project_id=r.project_id;
  update public.project_transfer_requests set status='accepted' where id=r.id;
  return jsonb_build_object('project_id',r.project_id,'old_owner_id',old_owner,'new_owner_id',new_owner,'status','accepted');
end;
$$;
revoke execute on function public.accept_project_transfer(uuid,uuid) from public, anon, authenticated;
grant execute on function public.accept_project_transfer(uuid,uuid) to service_role;

-- Atomic invite acceptance. The raw token is never stored; the backend supplies
-- only its SHA-256 hash and the signed-in email/user id.
create or replace function public.accept_project_invite(p_token_hash text, p_user_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare i public.project_invites%rowtype; existing_role text;
begin
  select * into i from public.project_invites where token_hash=p_token_hash for update;
  if not found then raise exception 'Invite not found'; end if;
  if i.accepted_at is not null then raise exception 'Invite has already been used'; end if;
  if i.revoked_at is not null then raise exception 'Invite has been revoked'; end if;
  if i.expires_at <= now() then raise exception 'Invite has expired'; end if;
  if lower(trim(i.email)) <> lower(trim(p_email)) then raise exception 'Invite email does not match signed-in account'; end if;
  select role into existing_role from public.project_members where project_id=i.project_id and user_id=p_user_id;
  if existing_role is not null then raise exception 'You are already a member of this project'; end if;
  insert into public.project_members(project_id,user_id,role,invited_by) values(i.project_id,p_user_id,i.role,i.invited_by);
  update public.project_invites set accepted_at=now() where id=i.id;
  return jsonb_build_object('project_id',i.project_id,'role',i.role,'invite_id',i.id);
end;
$$;
revoke execute on function public.accept_project_invite(text,uuid,text) from public, anon, authenticated;
grant execute on function public.accept_project_invite(text,uuid,text) to service_role;

-- Existing policy names vary across applied migrations, so remove policies from
-- the affected tables before installing the collaboration policy set.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public' and tablename in (
    'projects','project_files','project_file_versions','project_github_links','project_env_vars',
    'kxpert_sessions','kxpert_messages','activity_log','custom_domains','webhooks','project_members'
  ) loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- projects: members read; editors update metadata without changing ownership;
-- owner alone can delete or change projects.user_id.
create policy project_members_read on public.projects for select to authenticated
  using ((select public.is_project_member(id,'viewer')));
create policy project_editors_update on public.projects for update to authenticated
  using ((select public.is_project_member(id,'editor')))
  with check (user_id=(select public.project_owner_id(id)) or (select public.is_project_member(id,'owner')));
create policy project_owner_delete on public.projects for delete to authenticated
  using ((select public.is_project_member(id,'owner')));
create policy project_owner_insert on public.projects for insert to authenticated
  with check ((select auth.uid())=user_id);

-- Membership rows: the SELECT policy is intentionally separate and uses the
-- SECURITY DEFINER helper, so project_members does not recurse into itself.
alter table public.project_members enable row level security;
revoke all on public.project_members from anon;
grant select, insert, update, delete on public.project_members to authenticated;
create policy project_members_read on public.project_members for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
create policy project_members_owner_insert on public.project_members for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')));
create policy project_members_owner_update on public.project_members for update to authenticated
  using ((select public.is_project_member(project_id,'owner')))
  with check ((select public.is_project_member(project_id,'owner')));
create policy project_members_owner_delete on public.project_members for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

-- Project files: viewers read; editors write; only owner deletes. New/updated
-- rows stay attributed to the canonical owner so the legacy user_id column does
-- not become an accidental second ownership system.
create policy project_files_read on public.project_files for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
create policy project_files_editor_insert on public.project_files for insert to authenticated
  with check ((select public.is_project_member(project_id,'editor')) and user_id=(select public.project_owner_id(project_id)));
create policy project_files_editor_update on public.project_files for update to authenticated
  using ((select public.is_project_member(project_id,'editor')))
  with check (user_id=(select public.project_owner_id(project_id)));
create policy project_files_owner_delete on public.project_files for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

create policy project_file_versions_read on public.project_file_versions for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
create policy project_file_versions_editor_insert on public.project_file_versions for insert to authenticated
  with check ((select public.is_project_member(project_id,'editor')) and user_id=(select public.project_owner_id(project_id)));
create policy project_file_versions_editor_update on public.project_file_versions for update to authenticated
  using ((select public.is_project_member(project_id,'editor')))
  with check (user_id=(select public.project_owner_id(project_id)));
create policy project_file_versions_owner_delete on public.project_file_versions for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

-- Project chat is shared only when the session has a project_id. Personal chats
-- remain private. Viewers can read and create their own questions through the
-- backend; only the backend/service role writes assistant messages.
create policy kxpert_sessions_read on public.kxpert_sessions for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy kxpert_sessions_insert on public.kxpert_sessions for insert to authenticated
  with check ((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'viewer'))));
create policy kxpert_sessions_update on public.kxpert_sessions for update to authenticated
  using ((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'editor'))))
  with check ((select auth.uid())=user_id);
create policy kxpert_sessions_delete on public.kxpert_sessions for delete to authenticated
  using ((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'owner'))));

create policy kxpert_messages_read on public.kxpert_messages for select to authenticated
  using ((select auth.uid())=user_id or exists (
    select 1 from public.kxpert_sessions s
    where s.id::text=session_id and s.project_id is not null and (select public.is_project_member(s.project_id,'viewer'))
  ));
create policy kxpert_messages_insert on public.kxpert_messages for insert to authenticated
  with check ((select auth.uid())=user_id and exists (
    select 1 from public.kxpert_sessions s
    where s.id::text=session_id and (s.project_id is null and s.user_id=(select auth.uid()) or s.project_id is not null and (select public.is_project_member(s.project_id,'viewer')))
  ));
create policy kxpert_messages_update on public.kxpert_messages for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy kxpert_messages_delete on public.kxpert_messages for delete to authenticated
  using ((select auth.uid())=user_id);

-- GitHub links: members can see link metadata; owner alone manages it.
create policy project_github_links_read on public.project_github_links for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
create policy project_github_links_owner_insert on public.project_github_links for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid()));
create policy project_github_links_owner_update on public.project_github_links for update to authenticated
  using ((select public.is_project_member(project_id,'owner'))) with check ((select public.is_project_member(project_id,'owner')));
create policy project_github_links_owner_delete on public.project_github_links for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

-- Env vars are owner-only at the table level. Editors receive key names only
-- through the safe view below; they cannot SELECT the base table values.
create policy project_env_vars_owner_read on public.project_env_vars for select to authenticated
  using ((select public.is_project_member(project_id,'owner')));
create policy project_env_vars_owner_insert on public.project_env_vars for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid()));
create policy project_env_vars_owner_update on public.project_env_vars for update to authenticated
  using ((select public.is_project_member(project_id,'owner'))) with check ((select public.is_project_member(project_id,'owner')));
create policy project_env_vars_owner_delete on public.project_env_vars for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));
create or replace view public.project_env_var_keys with (security_invoker=true) as
  select project_id,id,key,is_public,created_at,updated_at from public.project_env_vars;
revoke all on public.project_env_var_keys from anon;
grant select on public.project_env_var_keys to authenticated;

-- Domains: member-readable metadata; owner-only management. Legacy domain rows
-- without project_id remain private to their recorded user_id.
create policy custom_domains_read on public.custom_domains for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy custom_domains_owner_insert on public.custom_domains for insert to authenticated
  with check ((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid())));
create policy custom_domains_owner_update on public.custom_domains for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id))
  with check ((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner'))));
create policy custom_domains_owner_delete on public.custom_domains for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id));

-- webhooks previously had no project_id. Add the nullable column so new project
-- webhooks can be member-scoped. Existing global rows remain private to user_id.
alter table public.webhooks add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists webhooks_project_idx on public.webhooks(project_id);
create policy webhooks_project_read on public.webhooks for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy webhooks_owner_insert on public.webhooks for insert to authenticated
  with check ((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid())));
create policy webhooks_owner_update on public.webhooks for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id))
  with check ((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner'))));
create policy webhooks_owner_delete on public.webhooks for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id));

-- Activity rows are append-only. Project-scoped rows can be read by project
-- members; legacy rows remain private. project_id is additive for clean RLS.
alter table public.activity_log add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists activity_log_project_idx on public.activity_log(project_id,created_at desc);
create policy activity_log_read on public.activity_log for select to authenticated
  using ((select auth.uid())=user_id or (project_id is not null and (select public.is_project_member(project_id,'viewer'))));
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check ((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'viewer'))));

-- Invite and transfer tables are backend-only: hashes/tokens and invited email
-- addresses never become directly readable through the authenticated Data API.
alter table public.project_invites enable row level security;
alter table public.project_transfer_requests enable row level security;
revoke all on public.project_invites from anon,authenticated;
revoke all on public.project_transfer_requests from anon,authenticated;

after insert?
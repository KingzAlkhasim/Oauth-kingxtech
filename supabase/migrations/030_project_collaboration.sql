-- 030: Phase 1 project collaboration. APPLY MANUALLY AFTER REVIEW; never apply from this PR.
-- Additive/idempotent. projects.user_id remains the canonical owner and billing owner.
-- Roles: owner, editor, viewer. No live co-editing or presence.

create table if not exists public.project_members (
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id,user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id,project_id);
create index if not exists project_members_project_role_idx on public.project_members(project_id,role);

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
create index if not exists project_invites_project_idx on public.project_invites(project_id,created_at desc);
create index if not exists project_invites_email_idx on public.project_invites(lower(email),project_id);

create table if not exists public.project_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  from_user_id uuid references auth.users(id) on delete cascade not null,
  to_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists project_transfer_project_idx on public.project_transfer_requests(project_id,created_at desc);
create index if not exists project_transfer_target_idx on public.project_transfer_requests(to_user_id,status,created_at desc);

insert into public.project_members(project_id,user_id,role)
select id,user_id,'owner' from public.projects
on conflict (project_id,user_id) do update set role='owner';

-- SECURITY DEFINER breaks RLS recursion on project_members. It returns only a boolean.
create or replace function public.is_project_member(p_project_id uuid,p_min_role text)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.project_members pm
    where pm.project_id=p_project_id and pm.user_id=(select auth.uid())
      and case p_min_role when 'viewer' then pm.role in ('viewer','editor','owner')
        when 'editor' then pm.role in ('editor','owner') when 'owner' then pm.role='owner' else false end);
$$;
revoke execute on function public.is_project_member(uuid,text) from public,anon;
grant execute on function public.is_project_member(uuid,text) to authenticated;

create or replace function public.project_owner_id(p_project_id uuid)
returns uuid language sql stable security definer set search_path=''
as $$ select p.user_id from public.projects p where p.id=p_project_id; $$;
revoke execute on function public.project_owner_id(uuid) from public,anon,authenticated;

-- Atomic transfer. Files/history/domains survive; old GitHub link is removed and
-- env-var values are blanked so the incoming owner must relink/re-enter secrets.
create or replace function public.accept_project_transfer(p_request_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare r public.project_transfer_requests%rowtype; old_owner uuid;
begin
  select * into r from public.project_transfer_requests where id=p_request_id for update;
  if not found then raise exception 'Transfer request not found'; end if;
  if r.status<>'pending' then raise exception 'Transfer request is no longer pending'; end if;
  if r.expires_at<=now() then update public.project_transfer_requests set status='expired' where id=r.id; raise exception 'Transfer request has expired'; end if;
  if r.to_user_id<>p_actor_user_id then raise exception 'Only the target member can accept this transfer'; end if;
  select user_id into old_owner from public.projects where id=r.project_id for update;
  if old_owner is null or old_owner<>r.from_user_id then raise exception 'Current project owner changed'; end if;
  if not exists(select 1 from public.project_members where project_id=r.project_id and user_id=r.to_user_id) then raise exception 'Target is not a project member'; end if;
  update public.projects set user_id=r.to_user_id,updated_at=now() where id=r.project_id;
  update public.project_members set role='editor' where project_id=r.project_id and user_id=old_owner;
  update public.project_members set role='owner' where project_id=r.project_id and user_id=r.to_user_id;
  delete from public.project_github_links where project_id=r.project_id;
  update public.project_env_vars set value='' where project_id=r.project_id;
  update public.project_transfer_requests set status='accepted' where id=r.id;
  return jsonb_build_object('project_id',r.project_id,'old_owner_id',old_owner,'new_owner_id',r.to_user_id,'status','accepted');
end; $$;
revoke execute on function public.accept_project_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_project_transfer(uuid,uuid) to service_role;

-- Atomic single-use invite acceptance. The raw token is never stored.
create or replace function public.accept_project_invite(p_token_hash text,p_user_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare i public.project_invites%rowtype;
begin
  select * into i from public.project_invites where token_hash=p_token_hash for update;
  if not found then raise exception 'Invite not found'; end if;
  if i.accepted_at is not null then raise exception 'Invite has already been used'; end if;
  if i.revoked_at is not null then raise exception 'Invite has been revoked'; end if;
  if i.expires_at<=now() then raise exception 'Invite has expired'; end if;
  if lower(trim(i.email))<>lower(trim(p_email)) then raise exception 'Invite email does not match signed-in account'; end if;
  if exists(select 1 from public.project_members where project_id=i.project_id and user_id=p_user_id) then raise exception 'Already a member'; end if;
  insert into public.project_members(project_id,user_id,role,invited_by) values(i.project_id,p_user_id,i.role,i.invited_by);
  update public.project_invites set accepted_at=now() where id=i.id;
  return jsonb_build_object('project_id',i.project_id,'role',i.role,'invite_id',i.id);
end; $$;
revoke execute on function public.accept_project_invite(text,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_project_invite(text,uuid,text) to service_role;

-- Remove all prior policies on the collaboration-scoped tables before installing
-- the single role model. This also makes the migration safe across prior policy names.
do $$ declare r record; begin
  for r in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('projects','project_members','project_files','project_file_versions','project_github_links','project_env_vars','kxpert_sessions','kxpert_messages','activity_log','custom_domains','webhooks') loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

-- projects: members read, editors update metadata, owner deletes/transfers.
create policy project_read on public.projects for select to authenticated using((select public.is_project_member(id,'viewer')));
create policy project_insert on public.projects for insert to authenticated with check((select auth.uid())=user_id);
create policy project_editor_update on public.projects for update to authenticated
  using((select public.is_project_member(id,'editor')))
  with check(user_id=(select public.project_owner_id(id)) or (select public.is_project_member(id,'owner')));
create policy project_owner_delete on public.projects for delete to authenticated using((select public.is_project_member(id,'owner')));

-- project_members has a separate read policy using the SECURITY DEFINER helper;
-- this is the non-recursive membership policy.
alter table public.project_members enable row level security;
revoke all on public.project_members from anon;
grant select,insert,update,delete on public.project_members to authenticated;
create policy member_read on public.project_members for select to authenticated using((select public.is_project_member(project_id,'viewer')));
create policy member_owner_insert on public.project_members for insert to authenticated with check((select public.is_project_member(project_id,'owner')));
create policy member_owner_update on public.project_members for update to authenticated using((select public.is_project_member(project_id,'owner'))) with check((select public.is_project_member(project_id,'owner')));
create policy member_owner_delete on public.project_members for delete to authenticated using((select public.is_project_member(project_id,'owner')));

-- Files/versions: viewer read, editor write, owner delete. Rows stay attributed to owner.
create policy files_read on public.project_files for select to authenticated using((select public.is_project_member(project_id,'viewer')));
create policy files_editor_insert on public.project_files for insert to authenticated with check((select public.is_project_member(project_id,'editor')) and user_id=(select public.project_owner_id(project_id)));
create policy files_editor_update on public.project_files for update to authenticated using((select public.is_project_member(project_id,'editor'))) with check(user_id=(select public.project_owner_id(project_id)));
create policy files_owner_delete on public.project_files for delete to authenticated using((select public.is_project_member(project_id,'owner')));
create policy versions_read on public.project_file_versions for select to authenticated using((select public.is_project_member(project_id,'viewer')));
create policy versions_editor_insert on public.project_file_versions for insert to authenticated with check((select public.is_project_member(project_id,'editor')) and user_id=(select public.project_owner_id(project_id)));
create policy versions_editor_update on public.project_file_versions for update to authenticated using((select public.is_project_member(project_id,'editor'))) with check(user_id=(select public.project_owner_id(project_id)));
create policy versions_owner_delete on public.project_file_versions for delete to authenticated using((select public.is_project_member(project_id,'owner')));

-- Project chats are shared only when session.project_id is set; personal chats stay private.
create policy sessions_read on public.kxpert_sessions for select to authenticated using((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy sessions_insert on public.kxpert_sessions for insert to authenticated with check((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'viewer'))));
create policy sessions_update on public.kxpert_sessions for update to authenticated using((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'editor')))) with check((select auth.uid())=user_id);
create policy sessions_delete on public.kxpert_sessions for delete to authenticated using((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'owner'))));
create policy messages_read on public.kxpert_messages for select to authenticated using((select auth.uid())=user_id or exists(select 1 from public.kxpert_sessions s where s.id::text=session_id and s.project_id is not null and (select public.is_project_member(s.project_id,'viewer'))));
create policy messages_insert on public.kxpert_messages for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.kxpert_sessions s where s.id::text=session_id and ((s.project_id is null and s.user_id=(select auth.uid())) or (s.project_id is not null and (select public.is_project_member(s.project_id,'viewer'))))));
create policy messages_update on public.kxpert_messages for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy messages_delete on public.kxpert_messages for delete to authenticated using((select auth.uid())=user_id);

-- GitHub: members read metadata, owner manages link.
create policy github_read on public.project_github_links for select to authenticated using((select public.is_project_member(project_id,'viewer')));
create policy github_owner_insert on public.project_github_links for insert to authenticated with check((select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid()));
create policy github_owner_update on public.project_github_links for update to authenticated using((select public.is_project_member(project_id,'owner'))) with check((select public.is_project_member(project_id,'owner')));
create policy github_owner_delete on public.project_github_links for delete to authenticated using((select public.is_project_member(project_id,'owner')));

-- Secrets: base table is owner-only. Editors receive key names through the safe view.
create policy env_owner_read on public.project_env_vars for select to authenticated using((select public.is_project_member(project_id,'owner')));
create policy env_owner_insert on public.project_env_vars for insert to authenticated with check((select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid()));
create policy env_owner_update on public.project_env_vars for update to authenticated using((select public.is_project_member(project_id,'owner'))) with check((select public.is_project_member(project_id,'owner')));
create policy env_owner_delete on public.project_env_vars for delete to authenticated using((select public.is_project_member(project_id,'owner')));
create or replace view public.project_env_var_keys with (security_invoker=true) as select project_id,id,key,is_public,created_at,updated_at from public.project_env_vars;
revoke all on public.project_env_var_keys from anon;
grant select on public.project_env_var_keys to authenticated;

-- Domains: members read; owner manages. Legacy rows without project_id remain private.
create policy domains_read on public.custom_domains for select to authenticated using((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy domains_owner_insert on public.custom_domains for insert to authenticated with check((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid())));
create policy domains_owner_update on public.custom_domains for update to authenticated using((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id)) with check((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner'))));
create policy domains_owner_delete on public.custom_domains for delete to authenticated using((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id));

-- webhooks lacked project_id, so add it for new project-scoped hooks; existing global hooks remain private.
alter table public.webhooks add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists webhooks_project_idx on public.webhooks(project_id);
create policy webhooks_read on public.webhooks for select to authenticated using((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and (select auth.uid())=user_id));
create policy webhooks_owner_insert on public.webhooks for insert to authenticated with check((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id=(select auth.uid())));
create policy webhooks_owner_update on public.webhooks for update to authenticated using((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id)) with check((project_id is null and (select auth.uid())=user_id) or (project_id is not null and (select public.is_project_member(project_id,'owner'))));
create policy webhooks_owner_delete on public.webhooks for delete to authenticated using((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and (select auth.uid())=user_id));

-- Project activity becomes shareable by project_id; old personal rows remain private.
alter table public.activity_log add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists activity_log_project_idx on public.activity_log(project_id,created_at desc);
create policy activity_read on public.activity_log for select to authenticated using((select auth.uid())=user_id or (project_id is not null and (select public.is_project_member(project_id,'viewer'))));
create policy activity_insert on public.activity_log for insert to authenticated with check((select auth.uid())=user_id and (project_id is null or (select public.is_project_member(project_id,'viewer'))));

-- Invite/transfer tables are backend-only so raw invite hashes and email addresses
-- are never returned by the authenticated Data API.
alter table public.project_invites enable row level security;
alter table public.project_transfer_requests enable row level security;
revoke all on public.project_invites from anon,authenticated;
revoke all on public.project_transfer_requests from anon,authenticated;

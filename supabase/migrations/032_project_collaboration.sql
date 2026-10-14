-- 032: Phase 1 project collaboration. APPLY MANUALLY AFTER REVIEW; never apply from this PR.
-- Migration 031 is reserved for the plan-expiry PR. Additive/idempotent.
-- projects.user_id remains canonical ownership and compute/storage billing ownership.

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
select id,user_id,'owner' from public.projects where user_id is not null
on conflict (project_id,user_id) do update set role='owner';

create or replace function public.is_project_member(p_project_id uuid,p_min_role text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid() and case p_min_role when 'viewer' then pm.role in ('viewer','editor','owner') when 'editor' then pm.role in ('editor','owner') when 'owner' then pm.role='owner' else false end);
$$;
revoke execute on function public.is_project_member(uuid,text) from public,anon;
grant execute on function public.is_project_member(uuid,text) to authenticated;

create or replace function public.project_owner_id(p_project_id uuid)
returns uuid language sql stable security definer set search_path=public
as $$ select user_id from public.projects where id=p_project_id; $$;
revoke execute on function public.project_owner_id(uuid) from public,anon,authenticated;

create or replace function public.create_project_invite(p_project_id uuid,p_email text,p_role text,p_invited_by uuid,p_token_hash text,p_expires_at timestamptz,p_member_cap integer)
returns uuid language plpgsql security definer set search_path=public
as $$
declare invite_id uuid; member_count integer; pending_count integer;
begin
  perform 1 from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  select count(*)::integer into member_count from public.project_members where project_id=p_project_id and role<>'owner';
  select count(*)::integer into pending_count from public.project_invites where project_id=p_project_id and accepted_at is null and revoked_at is null and expires_at>now();
  if member_count+pending_count>=p_member_cap then raise exception 'Project member cap reached'; end if;
  if exists(select 1 from public.project_invites where project_id=p_project_id and lower(email)=lower(trim(p_email)) and accepted_at is null and revoked_at is null and expires_at>now()) then raise exception 'Duplicate pending invite'; end if;
  insert into public.project_invites(project_id,email,role,token_hash,invited_by,expires_at) values(p_project_id,lower(trim(p_email)),p_role,p_token_hash,p_invited_by,p_expires_at) returning id into invite_id;
  return invite_id;
end;
$$;
revoke execute on function public.create_project_invite(uuid,text,text,uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.create_project_invite(uuid,text,text,uuid,text,timestamptz,integer) to service_role;

create or replace function public.accept_project_invite(p_token_hash text,p_user_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare i public.project_invites%rowtype;
begin
  select * into i from public.project_invites where token_hash=p_token_hash for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at<=now() or lower(trim(i.email))<>lower(trim(p_email)) then raise exception 'Invite is invalid'; end if;
  if exists(select 1 from public.project_members where project_id=i.project_id and user_id=p_user_id) then raise exception 'Already a member'; end if;
  insert into public.project_members(project_id,user_id,role,invited_by) values(i.project_id,p_user_id,i.role,i.invited_by);
  update public.project_invites set accepted_at=now() where id=i.id;
  return jsonb_build_object('project_id',i.project_id,'role',i.role,'invite_id',i.id);
end;
$$;
revoke execute on function public.accept_project_invite(text,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_project_invite(text,uuid,text) to service_role;

create or replace function public.accept_project_transfer(p_request_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare r public.project_transfer_requests%rowtype; old_owner uuid;
begin
  select * into r from public.project_transfer_requests where id=p_request_id for update;
  if not found or r.status<>'pending' or r.expires_at<=now() or r.to_user_id<>p_actor_user_id then raise exception 'Transfer is invalid'; end if;
  select user_id into old_owner from public.projects where id=r.project_id for update;
  if old_owner is null or old_owner<>r.from_user_id then raise exception 'Current project owner changed'; end if;
  if not exists(select 1 from public.project_members where project_id=r.project_id and user_id=r.to_user_id) then raise exception 'Target is not a project member'; end if;
  update public.projects set user_id=r.to_user_id,updated_at=now() where id=r.project_id;
  update public.project_members set role='editor' where project_id=r.project_id and user_id=old_owner;
  update public.project_members set role='owner' where project_id=r.project_id and user_id=r.to_user_id;
  update public.project_files set user_id=r.to_user_id where project_id=r.project_id;
  update public.project_file_versions set user_id=r.to_user_id where project_id=r.project_id;
  update public.project_env_vars set user_id=r.to_user_id,value='' where project_id=r.project_id;
  delete from public.project_github_links where project_id=r.project_id;
  update public.project_transfer_requests set status='accepted' where id=r.id;
  return jsonb_build_object('project_id',r.project_id,'old_owner_id',old_owner,'new_owner_id',r.to_user_id,'status','accepted');
end;
$$;
revoke execute on function public.accept_project_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_project_transfer(uuid,uuid) to service_role;

do $$ declare r record; begin
  for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('projects','project_members','project_files','project_file_versions','project_github_links','project_env_vars','kxpert_sessions','kxpert_messages','activity_log','custom_domains','webhooks') loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

create policy project_read on public.projects for select to authenticated using(public.is_project_member(id,'viewer'));
create policy project_insert on public.projects for insert to authenticated with check(auth.uid()=user_id);
create policy project_editor_update on public.projects for update to authenticated using(public.is_project_member(id,'editor')) with check(user_id=public.project_owner_id(id));
create policy project_owner_delete on public.projects for delete to authenticated using(public.is_project_member(id,'owner'));

alter table public.project_members enable row level security;
revoke all on public.project_members from anon,authenticated;
grant select on public.project_members to authenticated;
drop policy if exists member_owner_insert on public.project_members;
drop policy if exists member_owner_update on public.project_members;
drop policy if exists member_owner_delete on public.project_members;
create policy member_read on public.project_members for select to authenticated using(public.is_project_member(project_id,'viewer'));

create policy files_read on public.project_files for select to authenticated using(public.is_project_member(project_id,'viewer'));
create policy files_editor_insert on public.project_files for insert to authenticated with check(public.is_project_member(project_id,'editor') and user_id=public.project_owner_id(project_id));
create policy files_editor_update on public.project_files for update to authenticated using(public.is_project_member(project_id,'editor')) with check(user_id=public.project_owner_id(project_id));
create policy files_editor_delete on public.project_files for delete to authenticated using(public.is_project_member(project_id,'editor'));
create policy versions_read on public.project_file_versions for select to authenticated using(public.is_project_member(project_id,'viewer'));
create policy versions_editor_insert on public.project_file_versions for insert to authenticated with check(public.is_project_member(project_id,'editor') and user_id=public.project_owner_id(project_id));
create policy versions_editor_update on public.project_file_versions for update to authenticated using(public.is_project_member(project_id,'editor')) with check(user_id=public.project_owner_id(project_id));
create policy versions_editor_delete on public.project_file_versions for delete to authenticated using(public.is_project_member(project_id,'editor'));

create policy sessions_read on public.kxpert_sessions for select to authenticated using((project_id is not null and public.is_project_member(project_id,'viewer')) or (project_id is null and auth.uid()=user_id));
create policy sessions_insert on public.kxpert_sessions for insert to authenticated with check(auth.uid()=user_id and (project_id is null or public.is_project_member(project_id,'viewer')));
create policy sessions_update on public.kxpert_sessions for update to authenticated using(auth.uid()=user_id and (project_id is null or public.is_project_member(project_id,'editor')));
create policy sessions_delete on public.kxpert_sessions for delete to authenticated using(auth.uid()=user_id and (project_id is null or public.is_project_member(project_id,'owner')));
create policy messages_read on public.kxpert_messages for select to authenticated using(auth.uid()=user_id or exists(select 1 from public.kxpert_sessions s where s.id::text=session_id and s.project_id is not null and public.is_project_member(s.project_id,'viewer')));
create policy messages_insert on public.kxpert_messages for insert to authenticated with check(auth.uid()=user_id and exists(select 1 from public.kxpert_sessions s where s.id::text=session_id and ((s.project_id is null and s.user_id=auth.uid()) or (s.project_id is not null and public.is_project_member(s.project_id,'viewer')))));
create policy messages_update on public.kxpert_messages for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy messages_delete on public.kxpert_messages for delete to authenticated using(auth.uid()=user_id);

create policy github_read on public.project_github_links for select to authenticated using(public.is_project_member(project_id,'viewer'));
create policy github_owner_insert on public.project_github_links for insert to authenticated with check(public.is_project_member(project_id,'owner') and user_id=auth.uid());
create policy github_owner_update on public.project_github_links for update to authenticated using(public.is_project_member(project_id,'owner'));
create policy github_owner_delete on public.project_github_links for delete to authenticated using(public.is_project_member(project_id,'owner'));

create policy env_owner_read on public.project_env_vars for select to authenticated using(public.is_project_member(project_id,'owner'));
create policy env_owner_insert on public.project_env_vars for insert to authenticated with check(public.is_project_member(project_id,'owner') and user_id=auth.uid());
create policy env_owner_update on public.project_env_vars for update to authenticated using(public.is_project_member(project_id,'owner'));
create policy env_owner_delete on public.project_env_vars for delete to authenticated using(public.is_project_member(project_id,'owner'));

create or replace function public.project_env_keys(p_project_id uuid)
returns table(id uuid,key text,is_public boolean,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public
as $$ select e.id,e.key,e.is_public,e.created_at,e.updated_at from public.project_env_vars e where e.project_id=p_project_id and public.is_project_member(p_project_id,'viewer'); $$;
revoke execute on function public.project_env_keys(uuid) from public,anon;
grant execute on function public.project_env_keys(uuid) to authenticated;

create policy domains_read on public.custom_domains for select to authenticated using((project_id is not null and public.is_project_member(project_id,'viewer')) or (project_id is null and auth.uid()=user_id));
create policy domains_owner_insert on public.custom_domains for insert to authenticated with check((project_id is null and auth.uid()=user_id) or (project_id is not null and public.is_project_member(project_id,'owner')));
create policy domains_owner_update on public.custom_domains for update to authenticated using((project_id is not null and public.is_project_member(project_id,'owner')) or (project_id is null and auth.uid()=user_id));
create policy domains_owner_delete on public.custom_domains for delete to authenticated using((project_id is not null and public.is_project_member(project_id,'owner')) or (project_id is null and auth.uid()=user_id));

alter table public.webhooks add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists webhooks_project_idx on public.webhooks(project_id);
create policy webhooks_read on public.webhooks for select to authenticated using((project_id is not null and public.is_project_member(project_id,'viewer')) or (project_id is null and auth.uid()=user_id));
create policy webhooks_owner_insert on public.webhooks for insert to authenticated with check((project_id is null and auth.uid()=user_id) or (project_id is not null and public.is_project_member(project_id,'owner')));
create policy webhooks_owner_update on public.webhooks for update to authenticated using((project_id is not null and public.is_project_member(project_id,'owner')) or (project_id is null and auth.uid()=user_id));
create policy webhooks_owner_delete on public.webhooks for delete to authenticated using((project_id is not null and public.is_project_member(project_id,'owner')) or (project_id is null and auth.uid()=user_id));

alter table public.activity_log add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists activity_log_project_idx on public.activity_log(project_id,created_at desc);
create policy activity_read on public.activity_log for select to authenticated using(auth.uid()=user_id or (project_id is not null and public.is_project_member(project_id,'viewer')));
create policy activity_insert on public.activity_log for insert to authenticated with check(auth.uid()=user_id and (project_id is null or public.is_project_member(project_id,'viewer')));

alter table public.project_invites enable row level security;
alter table public.project_transfer_requests enable row level security;
revoke all on public.project_invites from anon,authenticated;
revoke all on public.project_transfer_requests from anon,authenticated;

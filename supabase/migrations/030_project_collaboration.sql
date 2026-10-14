-- Project Collaboration Phase 1
-- SECURITY NOTE: additive only; DO NOT apply automatically.
-- projects.user_id remains the canonical project/billing owner.

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id, created_at desc);
create index if not exists project_members_project_role_idx on public.project_members(project_id, role);

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_invites_project_idx on public.project_invites(project_id, created_at desc);
create index if not exists project_invites_email_idx on public.project_invites(lower(email), project_id);

create table if not exists public.project_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists project_transfer_project_idx on public.project_transfer_requests(project_id, created_at desc);
create index if not exists project_transfer_target_idx on public.project_transfer_requests(to_user_id, status, created_at desc);

alter table public.activity_log add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.custom_domains add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.webhooks add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists activity_log_project_idx on public.activity_log(project_id, created_at desc);
create index if not exists custom_domains_project_idx on public.custom_domains(project_id);
create index if not exists webhooks_project_idx on public.webhooks(project_id);

-- Backfill every existing project with its canonical owner.
insert into public.project_members (project_id, user_id, role)
select p.id, p.user_id, 'owner'
from public.projects p
where not exists (
  select 1 from public.project_members m where m.project_id = p.id and m.user_id = p.user_id
)
on conflict (project_id, user_id) do nothing;

-- Boolean-only SECURITY DEFINER helper breaks RLS recursion without exposing membership rows.
create or replace function public.is_project_member(p_project_id uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
      and case p_min_role
        when 'viewer' then m.role in ('owner','editor','viewer')
        when 'editor' then m.role in ('owner','editor')
        when 'owner' then m.role = 'owner'
        else false
      end
  );
$$;
revoke all on function public.is_project_member(uuid, text) from public;
grant execute on function public.is_project_member(uuid, text) to authenticated;

-- Membership rows contain IDs/roles only; no email is exposed through RLS.
alter table public.project_members enable row level security;
drop policy if exists "Project members can view membership" on public.project_members;
create policy "Project members can view membership" on public.project_members for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
drop policy if exists "Project owners manage membership" on public.project_members;
create policy "Project owners manage membership" on public.project_members for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Project owners update membership" on public.project_members;
create policy "Project owners update membership" on public.project_members for update to authenticated
  using ((select public.is_project_member(project_id,'owner')))
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Owners or members leave membership" on public.project_members;
create policy "Owners or members leave membership" on public.project_members for delete to authenticated
  using (
    ((select public.is_project_member(project_id,'owner')) and role <> 'owner')
    or (user_id = (select auth.uid()) and role <> 'owner')
  );

alter table public.project_invites enable row level security;
drop policy if exists "Project owners and editors create invites" on public.project_invites;
create policy "Project owners and editors create invites" on public.project_invites for insert to authenticated
  with check ((select public.is_project_member(project_id,'editor')) and invited_by = (select auth.uid()));
drop policy if exists "Only owners view invite records" on public.project_invites;
create policy "Only owners view invite records" on public.project_invites for select to authenticated
  using ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Only owners revoke invite records" on public.project_invites;
create policy "Only owners revoke invite records" on public.project_invites for update to authenticated
  using ((select public.is_project_member(project_id,'owner')))
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Only owners delete invite records" on public.project_invites;
create policy "Only owners delete invite records" on public.project_invites for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

alter table public.project_transfer_requests enable row level security;
drop policy if exists "Transfer participants can view request" on public.project_transfer_requests;
create policy "Transfer participants can view request" on public.project_transfer_requests for select to authenticated
  using (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()));
drop policy if exists "Only owners create transfer request" on public.project_transfer_requests;
create policy "Only owners create transfer request" on public.project_transfer_requests for insert to authenticated
  with check (from_user_id = (select auth.uid()) and (select public.is_project_member(project_id,'owner')));
drop policy if exists "Transfer participants update request" on public.project_transfer_requests;
create policy "Transfer participants update request" on public.project_transfer_requests for update to authenticated
  using (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
  with check (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()));

-- Shared project rows: viewers read, editors write, owners delete the project.
alter table public.projects enable row level security;
drop policy if exists "Users can view own projects" on public.projects;
drop policy if exists "Users can view member projects" on public.projects;
create policy "Users can view member projects" on public.projects for select to authenticated
  using ((select public.is_project_member(id,'viewer')));
drop policy if exists "Users can insert own projects" on public.projects;
create policy "Users can insert own projects" on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Project editors can update projects" on public.projects;
create policy "Project editors can update projects" on public.projects for update to authenticated
  using ((select public.is_project_member(id,'editor')))
  with check ((select public.is_project_member(id,'editor')));
drop policy if exists "Users can delete own projects" on public.projects;
drop policy if exists "Project owners can delete projects" on public.projects;
create policy "Project owners can delete projects" on public.projects for delete to authenticated
  using ((select public.is_project_member(id,'owner')));

alter table public.project_files enable row level security;
drop policy if exists "Users can view own project files" on public.project_files;
drop policy if exists "Project members can view project files" on public.project_files;
create policy "Project members can view project files" on public.project_files for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
drop policy if exists "Users can insert own project files" on public.project_files;
drop policy if exists "Project editors can insert project files" on public.project_files;
create policy "Project editors can insert project files" on public.project_files for insert to authenticated
  with check ((select public.is_project_member(project_id,'editor'))
    and user_id = (select p.user_id from public.projects p where p.id = project_id));
drop policy if exists "Users can update own project files" on public.project_files;
drop policy if exists "Project editors can update project files" on public.project_files;
create policy "Project editors can update project files" on public.project_files for update to authenticated
  using ((select public.is_project_member(project_id,'editor')))
  with check ((select public.is_project_member(project_id,'editor'))
    and user_id = (select p.user_id from public.projects p where p.id = project_id));
drop policy if exists "Users can delete own project files" on public.project_files;
drop policy if exists "Project editors can delete project files" on public.project_files;
create policy "Project editors can delete project files" on public.project_files for delete to authenticated
  using ((select public.is_project_member(project_id,'editor')));

alter table public.project_file_versions enable row level security;
drop policy if exists "Users can view own file versions" on public.project_file_versions;
drop policy if exists "Project members can view file versions" on public.project_file_versions;
create policy "Project members can view file versions" on public.project_file_versions for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
drop policy if exists "Users can insert own file versions" on public.project_file_versions;
drop policy if exists "Project editors can insert file versions" on public.project_file_versions;
create policy "Project editors can insert file versions" on public.project_file_versions for insert to authenticated
  with check ((select public.is_project_member(project_id,'editor')) and user_id = (select auth.uid()));

-- Env-var values are server-mediated. Direct authenticated table access is revoked because
-- RLS cannot conditionally hide the value column from editors while exposing it to owners.
alter table public.project_env_vars enable row level security;
drop policy if exists "Users can view own project env vars" on public.project_env_vars;
drop policy if exists "Project owners can view project env vars" on public.project_env_vars;
create policy "Project owners can view project env vars" on public.project_env_vars for select to authenticated
  using ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Users can insert own project env vars" on public.project_env_vars;
drop policy if exists "Project owners can insert project env vars" on public.project_env_vars;
create policy "Project owners can insert project env vars" on public.project_env_vars for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Users can update own project env vars" on public.project_env_vars;
drop policy if exists "Project owners can update project env vars" on public.project_env_vars;
create policy "Project owners can update project env vars" on public.project_env_vars for update to authenticated
  using ((select public.is_project_member(project_id,'owner')))
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Users can delete own project env vars" on public.project_env_vars;
drop policy if exists "Project owners can delete project env vars" on public.project_env_vars;
create policy "Project owners can delete project env vars" on public.project_env_vars for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));
revoke all on table public.project_env_vars from anon, authenticated;

-- GitHub link metadata is readable to members; only owner can mutate it.
alter table public.project_github_links enable row level security;
drop policy if exists "Users can view own github links" on public.project_github_links;
drop policy if exists "Project members can view github links" on public.project_github_links;
create policy "Project members can view github links" on public.project_github_links for select to authenticated
  using ((select public.is_project_member(project_id,'viewer')));
drop policy if exists "Users can insert own github links" on public.project_github_links;
drop policy if exists "Project owners can insert github links" on public.project_github_links;
create policy "Project owners can insert github links" on public.project_github_links for insert to authenticated
  with check ((select public.is_project_member(project_id,'owner')) and user_id = (select auth.uid()));
drop policy if exists "Users can update own github links" on public.project_github_links;
drop policy if exists "Project owners can update github links" on public.project_github_links;
create policy "Project owners can update github links" on public.project_github_links for update to authenticated
  using ((select public.is_project_member(project_id,'owner')))
  with check ((select public.is_project_member(project_id,'owner')));
drop policy if exists "Users can delete own github links" on public.project_github_links;
drop policy if exists "Project owners can delete github links" on public.project_github_links;
create policy "Project owners can delete github links" on public.project_github_links for delete to authenticated
  using ((select public.is_project_member(project_id,'owner')));

-- Project chats are shared only when the session itself is attached to the project.
alter table public.kxpert_sessions enable row level security;
drop policy if exists "Users can view own sessions" on public.kxpert_sessions;
drop policy if exists "Project members can view project sessions" on public.kxpert_sessions;
create policy "Project members can view project sessions" on public.kxpert_sessions for select to authenticated
  using ((user_id = (select auth.uid())) or (project_id is not null and (select public.is_project_member(project_id,'viewer'))));
drop policy if exists "Users can insert own sessions" on public.kxpert_sessions;
drop policy if exists "Users can insert own project sessions" on public.kxpert_sessions;
create policy "Users can insert own project sessions" on public.kxpert_sessions for insert to authenticated
  with check (user_id = (select auth.uid()) and (project_id is null or (select public.is_project_member(project_id,'viewer'))));
drop policy if exists "Users can update own sessions" on public.kxpert_sessions;
create policy "Users can update own sessions" on public.kxpert_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users can delete own sessions" on public.kxpert_sessions;
create policy "Users can delete own sessions" on public.kxpert_sessions for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.kxpert_messages enable row level security;
drop policy if exists "Users can view own kxpert messages" on public.kxpert_messages;
drop policy if exists "Project members can view project kxpert messages" on public.kxpert_messages;
create policy "Project members can view project kxpert messages" on public.kxpert_messages for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.kxpert_sessions s
      where s.id::text = kxpert_messages.session_id
        and s.project_id is not null
        and (select public.is_project_member(s.project_id,'viewer')))
  );
drop policy if exists "Users can insert own kxpert messages" on public.kxpert_messages;
create policy "Users can insert own kxpert messages" on public.kxpert_messages for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can delete own kxpert messages" on public.kxpert_messages;
create policy "Users can delete own kxpert messages" on public.kxpert_messages for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.activity_log enable row level security;
drop policy if exists "Users can view own activity" on public.activity_log;
drop policy if exists "Project members can view project activity" on public.activity_log;
create policy "Project members can view project activity" on public.activity_log for select to authenticated
  using ((user_id = (select auth.uid())) or (project_id is not null and (select public.is_project_member(project_id,'viewer'))));
drop policy if exists "Users can insert own activity" on public.activity_log;
create policy "Users can insert own activity" on public.activity_log for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Project-scoped domains/webhooks stay visible to members, but only owners mutate them.
-- Legacy rows without project_id remain private to their existing user_id.
alter table public.custom_domains enable row level security;
drop policy if exists "Users can view own domains" on public.custom_domains;
drop policy if exists "Project members can view project domains" on public.custom_domains;
create policy "Project members can view project domains" on public.custom_domains for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can insert own domains" on public.custom_domains;
drop policy if exists "Project owners can insert domains" on public.custom_domains;
create policy "Project owners can insert domains" on public.custom_domains for insert to authenticated
  with check ((project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id = (select auth.uid())) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can update own domains" on public.custom_domains;
drop policy if exists "Project owners can update domains" on public.custom_domains;
create policy "Project owners can update domains" on public.custom_domains for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())))
  with check ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can delete own domains" on public.custom_domains;
drop policy if exists "Project owners can delete domains" on public.custom_domains;
create policy "Project owners can delete domains" on public.custom_domains for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())));

alter table public.webhooks enable row level security;
drop policy if exists "Users can view own webhooks" on public.webhooks;
drop policy if exists "Project members can view project webhooks" on public.webhooks;
create policy "Project members can view project webhooks" on public.webhooks for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'viewer'))) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can insert own webhooks" on public.webhooks;
drop policy if exists "Project owners can insert webhooks" on public.webhooks;
create policy "Project owners can insert webhooks" on public.webhooks for insert to authenticated
  with check ((project_id is not null and (select public.is_project_member(project_id,'owner')) and user_id = (select auth.uid())) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can update own webhooks" on public.webhooks;
drop policy if exists "Project owners can update webhooks" on public.webhooks;
create policy "Project owners can update webhooks" on public.webhooks for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())))
  with check ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())));
drop policy if exists "Users can delete own webhooks" on public.webhooks;
drop policy if exists "Project owners can delete webhooks" on public.webhooks;
create policy "Project owners can delete webhooks" on public.webhooks for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id,'owner'))) or (project_id is null and user_id = (select auth.uid())));

revoke all on table public.project_members, public.project_invites, public.project_transfer_requests from anon;
revoke all on table public.project_members, public.project_invites, public.project_transfer_requests from authenticated;
grant select, insert, update, delete on table public.project_members to authenticated;
grant select, insert, update, delete on table public.project_invites to authenticated;
grant select, insert, update on table public.project_transfer_requests to authenticated;

-- Ownership transfer is one DB transaction. Files/history remain. GitHub is unlinked,
-- env keys remain but values are blanked, and project domains remain attached to the project.
create or replace function public.accept_project_transfer(p_request_id uuid, p_actor_user_id uuid)
returns table(project_id uuid, previous_owner_id uuid, new_owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.project_transfer_requests%rowtype;
  current_owner uuid;
begin
  select * into req from public.project_transfer_requests
    where id = p_request_id for update;
  if not found then raise exception 'Transfer request not found.'; end if;
  if req.status <> 'pending' then raise exception 'Transfer request is no longer pending.'; end if;
  if req.expires_at <= now() then
    update public.project_transfer_requests set status = 'expired' where id = req.id;
    raise exception 'Transfer request has expired.';
  end if;
  if req.to_user_id <> p_actor_user_id then raise exception 'Only the invited target can accept this transfer.'; end if;

  select user_id into current_owner from public.projects where id = req.project_id for update;
  if current_owner is null then raise exception 'Project not found.'; end if;
  if current_owner <> req.from_user_id then raise exception 'Project ownership changed; this transfer is no longer valid.'; end if;
  if not exists (select 1 from public.project_members where project_id = req.project_id and user_id = req.to_user_id) then
    raise exception 'Transfer target is no longer a project member.';
  end if;

  update public.projects set user_id = req.to_user_id, updated_at = now() where id = req.project_id;
  update public.project_members set role = 'editor' where project_id = req.project_id and user_id = current_owner;
  update public.project_members set role = 'owner' where project_id = req.project_id and user_id = req.to_user_id;
  delete from public.project_github_links where project_id = req.project_id;
  update public.project_env_vars set value = '', user_id = req.to_user_id, updated_at = now() where project_id = req.project_id;
  update public.custom_domains set user_id = req.to_user_id where project_id = req.project_id;
  update public.webhooks set user_id = req.to_user_id where project_id = req.project_id;
  update public.project_transfer_requests set status = 'accepted' where id = req.id;

  return query select req.project_id, current_owner, req.to_user_id;
end;
$$;
revoke all on function public.accept_project_transfer(uuid, uuid) from public;
grant execute on function public.accept_project_transfer(uuid, uuid) to service_role;

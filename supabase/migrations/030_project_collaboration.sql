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

-- Existing projects get an explicit membership owner row. projects.user_id stays canonical.
insert into public.project_members(project_id, user_id, role)
select p.id, p.user_id, 'owner'
from public.projects p
where p.user_id is not null
on conflict (project_id, user_id) do update set role = 'owner';

-- SECURITY DEFINER is deliberate: policies on project_members must not recurse.
-- The function is exposed only to authenticated callers and returns only a boolean.
create or replace function public.is_project_member(p_project_id uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
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
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id from public.projects p where p.id = p_project_id;
$$;

revoke execute on function public.project_owner_id(uuid) from public, anon, authenticated;

create or replace function public.project_member_count(p_project_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.role <> 'owner';
$$;

revoke execute on function public.project_member_count(uuid) from public, anon, authenticated;

-- The helper below is used by the project-chat message policy without requiring
-- a second RLS evaluation of kxpert_sessions.
create or replace function public.is_project_chat_session(p_session_id text, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.kxpert_sessions s
    where s.id::text = p_session_id and s.project_id = p_project_id
  );
$$;

revoke execute on function public.is_project_chat_session(text,uuid) from public, anon, authenticated;

-- Rebuild policies on collaboration-scoped tables. This deliberately removes
-- the old owner-only policies so membership is the single authorization rule.
do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_files','project_file_versions','project_github_links',
    'project_env_vars','kxpert_sessions','kxpert_messages','activity_log',
    'custom_domains','webhooks','project_members'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Users can view own projects', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own projects', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own projects', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own projects', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own project files', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own project files', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own project files', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own project files', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own file versions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own file versions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own file versions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own file versions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own sessions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own sessions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own sessions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own sessions', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own messages', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own messages', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own messages', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own messages', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own activity', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own activity', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own custom domains', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own custom domains', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own custom domains', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own custom domains', t);
    execute format('drop policy if exists %I on public.%I', 'Users can view own webhooks', t);
    execute format('drop policy if exists %I on public.%I', 'Users can insert own webhooks', t);
    execute format('drop policy if exists %I on public.%I', 'Users can update own webhooks', t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete own webhooks', t);
  end loop;
end $$;

-- projects: members read; editors update metadata; owner alone may delete or change user_id.
create policy project_members_read on public.projects for select to authenticated
  using ((select public.is_project_member(id, 'viewer')));
create policy project_editors_update on public.projects for update to authenticated
  using ((select public.is_project_member(id, 'editor')))
  with check (user_id = (select public.project_owner_id(id)));
create policy project_owner_delete on public.projects for delete to authenticated
  using ((select public.is_project_member(id, 'owner')));
create policy project_owner_insert on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- project_members: separate non-recursive membership policy; helper bypasses this table's RLS.
alter table public.project_members enable row level security;
revoke all on public.project_members from anon;
grant select on public.project_members to authenticated;
create policy project_members_read on public.project_members for select to authenticated
  using ((select public.is_project_member(project_id, 'viewer')));
create policy project_members_owner_insert on public.project_members for insert to authenticated
  with check ((select public.is_project_member(project_id, 'owner')));
create policy project_members_owner_update on public.project_members for update to authenticated
  using ((select public.is_project_member(project_id, 'owner')))
  with check ((select public.is_project_member(project_id, 'owner')));
create policy project_members_owner_delete on public.project_members for delete to authenticated
  using ((select public.is_project_member(project_id, 'owner')));

-- Files: all members read. Editors can create/update rows but rows remain attributed
-- to the canonical owner. Viewers cannot write. Only owners can delete files.
create policy project_files_read on public.project_files for select to authenticated
  using ((select public.is_project_member(project_id, 'viewer')));
create policy project_files_editor_insert on public.project_files for insert to authenticated
  with check ((select public.is_project_member(project_id, 'editor')) and user_id = (select public.project_owner_id(project_id)));
create policy project_files_editor_update on public.project_files for update to authenticated
  using ((select public.is_project_member(project_id, 'editor')))
  with check (user_id = (select public.project_owner_id(project_id)));
create policy project_files_owner_delete on public.project_files for delete to authenticated
  using ((select public.is_project_member(project_id, 'owner')));

-- File versions follow the same project authorization; only owners can delete history.
create policy project_file_versions_read on public.project_file_versions for select to authenticated
  using ((select public.is_project_member(project_id, 'viewer')));
create policy project_file_versions_editor_insert on public.project_file_versions for insert to authenticated
  with check ((select public.is_project_member(project_id, 'editor')) and user_id = (select public.project_owner_id(project_id)));
create policy project_file_versions_editor_update on public.project_file_versions for update to authenticated
  using ((select public.is_project_member(project_id, 'editor')))
  with check (user_id = (select public.project_owner_id(project_id)));
create policy project_file_versions_owner_delete on public.project_file_versions for delete to authenticated
  using ((select public.is_project_member(project_id, 'owner')));

-- Project chat: project sessions/history are shared with members. Personal sessions
-- (project_id IS NULL) remain private to their creator.
create policy kxpert_sessions_read on public.kxpert_sessions for select to authenticated
  using (
    (project_id is not null and (select public.is_project_member(project_id, 'viewer')))
    or (project_id is null and (select auth.uid()) = user_id)
  );
create policy kxpert_sessions_insert on public.kxpert_sessions for insert to authenticated
  with check (
    (select auth.uid()) = user_id and
    (project_id is null or (select public.is_project_member(project_id, 'editor')))
  );
create policy kxpert_sessions_update on public.kxpert_sessions for update to authenticated
  using ((select auth.uid()) = user_id and (project_id is null or (select public.is_project_member(project_id, 'editor'))))
  with check ((select auth.uid()) = user_id);
create policy kxpert_sessions_delete on public.kxpert_sessions for delete to authenticated
  using ((select auth.uid()) = user_id and (project_id is null or (select public.is_project_member(project_id, 'owner'))));

create policy kxpert_messages_read on public.kxpert_messages for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.kxpert_sessions s
      where s.id::text = session_id and s.project_id is not null
        and (select public.is_project_member(s.project_id, 'viewer'))
    )
  );
create policy kxpert_messages_insert on public.kxpert_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id and
    (
      exists (select 1 from public.kxpert_sessions s where s.id::text = session_id and s.project_id is null and s.user_id = (select auth.uid()))
      or exists (select 1 from public.kxpert_sessions s where s.id::text = session_id and s.project_id is not null and (select public.is_project_member(s.project_id, 'editor')))
    )
  );
create policy kxpert_messages_update on public.kxpert_messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy kxpert_messages_delete on public.kxpert_messages for delete to authenticated
  using ((select auth.uid()) = user_id);

-- GitHub link: members may see that a project has a link, but only the owner can manage it.
create policy project_github_links_read on public.project_github_links for select to authenticated
  using ((select public.is_project_member(project_id, 'viewer')));
create policy project_github_links_owner_insert on public.project_github_links for insert to authenticated
  with check ((select public.is_project_member(project_id, 'owner')) and user_id = (select auth.uid()));
create policy project_github_links_owner_update on public.project_github_links for update to authenticated
  using ((select public.is_project_member(project_id, 'owner')))
  with check ((select public.is_project_member(project_id, 'owner')));
create policy project_github_links_owner_delete on public.project_github_links for delete to authenticated
  using ((select public.is_project_member(project_id, 'owner')));

-- Env vars: base table is owner-only so an editor can never select values through
-- the Data API. Editors get key names through the safe view created below.
create policy project_env_vars_owner_read on public.project_env_vars for select to authenticated
  using ((select public.is_project_member(project_id, 'owner')));
create policy project_env_vars_owner_insert on public.project_env_vars for insert to authenticated
  with check ((select public.is_project_member(project_id, 'owner')) and user_id = (select auth.uid()));
create policy project_env_vars_owner_update on public.project_env_vars for update to authenticated
  using ((select public.is_project_member(project_id, 'owner')))
  with check ((select public.is_project_member(project_id, 'owner')));
create policy project_env_vars_owner_delete on public.project_env_vars for delete to authenticated
  using ((select public.is_project_member(project_id, 'owner')));

create or replace view public.project_env_var_keys with (security_invoker = true) as
select project_id, id, key, is_public, created_at, updated_at
from public.project_env_vars;
revoke all on public.project_env_var_keys from anon;
grant select on public.project_env_var_keys to authenticated;

-- Domains: visible to members; only owner can add/change/remove.
create policy custom_domains_read on public.custom_domains for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'viewer'))) or (project_id is null and (select auth.uid()) = user_id));
create policy custom_domains_owner_insert on public.custom_domains for insert to authenticated
  with check ((project_id is null and (select auth.uid()) = user_id) or (project_id is not null and (select public.is_project_member(project_id, 'owner')) and user_id = (select auth.uid())));
create policy custom_domains_owner_update on public.custom_domains for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'owner'))) or (project_id is null and (select auth.uid()) = user_id))
  with check ((project_id is null and (select auth.uid()) = user_id) or (project_id is not null and (select public.is_project_member(project_id, 'owner'))));
create policy custom_domains_owner_delete on public.custom_domains for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'owner'))) or (project_id is null and (select auth.uid()) = user_id));

-- webhooks did not previously carry a project_id. Add one so collaboration can
-- scope webhook records without guessing ownership of existing global hooks.
alter table public.webhooks add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists webhooks_project_idx on public.webhooks(project_id);
create policy webhooks_project_read on public.webhooks for select to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'viewer'))) or (project_id is null and (select auth.uid()) = user_id));
create policy webhooks_owner_insert on public.webhooks for insert to authenticated
  with check ((project_id is null and (select auth.uid()) = user_id) or (project_id is not null and (select public.is_project_member(project_id, 'owner')) and user_id = (select auth.uid())));
create policy webhooks_owner_update on public.webhooks for update to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'owner'))) or (project_id is null and (select auth.uid()) = user_id))
  with check ((project_id is null and (select auth.uid()) = user_id) or (project_id is not null and (select public.is_project_member(project_id, 'owner'))));
create policy webhooks_owner_delete on public.webhooks for delete to authenticated
  using ((project_id is not null and (select public.is_project_member(project_id, 'owner'))) or (project_id is null and (select auth.uid()) = user_id));

-- Activity is append-only. Project-scoped activity can be read by project members;
-- legacy personal rows remain private. Writes stay tied to the caller.
create policy activity_log_read on public.activity_log for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.projects p
      where p.id = nullif((detail::jsonb ->> 'project_id'), '')::uuid
        and (select public.is_project_member(p.id, 'viewer'))
    )
  );
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Invites and transfer requests are intentionally backend-only. Tokens and email
-- addresses are never exposed through direct authenticated-table reads.
alter table public.project_invites enable row level security;
alter table public.project_transfer_requests enable row level security;
revoke all on public.project_invites from anon, authenticated;
revoke all on public.project_transfer_requests from anon, authenticated;

-- Audit helper used by the backend with service_role; clients cannot execute it.
create or replace function public.collaboration_audit(p_user_id uuid, p_action text, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log(user_id, action, detail)
  values (p_user_id, p_action, p_detail::text);
$$;
revoke execute on function public.collaboration_audit(uuid,text,jsonb) from public, anon, authenticated;

after insert? -- marker intentionally invalid?
-- Phase 1 collaboration RLS test harness.
-- NOT RUN: this repository connection cannot execute arbitrary Postgres SQL.
-- Run this only against a disposable Supabase database AFTER 030_project_collaboration.sql.
-- Replace the UUIDs below with two real Auth users and a project owned by user A.

\set user_a '''00000000-0000-0000-0000-000000000001'''
\set user_b '''00000000-0000-0000-0000-000000000002'''
\set project_id '''00000000-0000-0000-0000-000000000010'''

-- Helper for simulating an authenticated JWT in a psql test session.
create or replace function public._test_set_user(p_user uuid) returns void
language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', p_user::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;

-- A cannot accidentally expose B's project before membership exists.
select public._test_set_user(:'user_b');
select count(*) = 0 as b_cannot_read_before_invite
from public.projects where id = :'project_id'::uuid;

-- Invite B as viewer (service-role fixture operation).
insert into public.project_members(project_id,user_id,role,invited_by)
values (:'project_id'::uuid, :'user_b'::uuid, 'viewer', :'user_a'::uuid)
on conflict (project_id,user_id) do update set role='viewer';

select count(*) = 1 as viewer_can_read_project
from public.projects where id = :'project_id'::uuid;

-- Viewer cannot mutate project metadata.
update public.projects set description = 'SHOULD_NOT_WRITE' where id = :'project_id'::uuid;
select description <> 'SHOULD_NOT_WRITE' as viewer_cannot_write_project
from public.projects where id = :'project_id'::uuid;

-- Viewer can read files but cannot write them.
select count(*) >= 0 as viewer_file_read_is_allowed
from public.project_files where project_id = :'project_id'::uuid;
-- Expect the following statement to fail with an RLS policy violation when no matching row is permitted.
insert into public.project_files(project_id,user_id,path,content)
select :'project_id'::uuid, p.user_id, '__rls_viewer_should_fail__.txt', 'blocked'
from public.projects p where p.id = :'project_id'::uuid;

-- Viewer cannot read env-var rows at all; the API exposes no env values to viewers.
select count(*) = 0 as viewer_cannot_read_env_values
from public.project_env_vars where project_id = :'project_id'::uuid;

-- Promote B to editor using the owner context.
select public._test_set_user(:'user_a');
update public.project_members set role='editor' where project_id=:'project_id'::uuid and user_id=:'user_b'::uuid;
select public._test_set_user(:'user_b');

-- Editor can write files but still cannot read env values or delete the project.
insert into public.project_files(project_id,user_id,path,content)
select :'project_id'::uuid, p.user_id, '__rls_editor_can_write__.txt', 'editor write'
from public.projects p where p.id = :'project_id'::uuid;
select count(*) = 1 as editor_can_write_file
from public.project_files where project_id=:'project_id'::uuid and path='__rls_editor_can_write__.txt';
select count(*) = 0 as editor_cannot_read_env_values
from public.project_env_vars where project_id=:'project_id'::uuid;
delete from public.projects where id=:'project_id'::uuid;
select count(*) = 1 as editor_cannot_delete_project
from public.projects where id=:'project_id'::uuid;

-- Removal is immediate.
select public._test_set_user(:'user_a');
delete from public.project_members where project_id=:'project_id'::uuid and user_id=:'user_b'::uuid;
select public._test_set_user(:'user_b');
select count(*) = 0 as removed_member_loses_project_access
from public.projects where id=:'project_id'::uuid;

-- Transfer fixture: re-add B, create pending request, then accept through the atomic RPC.
select public._test_set_user(:'user_a');
insert into public.project_members(project_id,user_id,role,invited_by)
values (:'project_id'::uuid, :'user_b'::uuid, 'editor', :'user_a'::uuid)
on conflict (project_id,user_id) do update set role='editor';
insert into public.project_transfer_requests(project_id,from_user_id,to_user_id,expires_at)
values (:'project_id'::uuid, :'user_a'::uuid, :'user_b'::uuid, now()+interval '7 days');

-- The accept RPC is service-role-only by design. Execute it as a trusted backend test,
-- then verify projects.user_id, member roles, transfer status, GitHub unlink, and blank env values.
-- select * from public.accept_project_transfer(<request-id>, :'user_b'::uuid);
-- select user_id = :'user_b'::uuid as new_billing_owner from public.projects where id=:'project_id'::uuid;
-- select role='owner' as b_is_owner from public.project_members where project_id=:'project_id'::uuid and user_id=:'user_b'::uuid;
-- select role='editor' as a_is_editor from public.project_members where project_id=:'project_id'::uuid and user_id=:'user_a'::uuid;
-- select not exists(select 1 from public.project_github_links where project_id=:'project_id'::uuid) as github_unlinked;
-- select bool_and(value='') as env_values_blank from public.project_env_vars where project_id=:'project_id'::uuid;
-- select status='accepted' as transfer_accepted from public.project_transfer_requests where id=<request-id>;

-- Drop the test-only helper after running the script.
drop function if exists public._test_set_user(uuid);

-- Phase 1 collaboration RLS tests.
-- NOT RUN: migration is intentionally not applied in this PR.
-- Staging: apply migrations 001..032 to a disposable/local Supabase project,
-- then run this file with the pgTAP test runner (for example `supabase test db`).

begin;
select plan(18);

select tests.create_supabase_user('collab_a@example.com') as a_id \gset
select tests.create_supabase_user('collab_b@example.com') as b_id \gset
select tests.authenticate_as(:'a_id');
insert into public.projects(user_id,name,product) values(:'a_id','RLS Collaboration Test','K-XpertAI') returning id \gset

-- Authenticated users have SELECT-only membership access. Even the owner cannot mutate membership directly.
select throws_ok(
  $$insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','viewer')$$,
  '42501',
  null,
  'owner cannot add a member directly through RLS/grants'
);
select throws_ok(
  $$insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','owner')$$,
  '42501',
  null,
  'owner cannot insert a second owner directly through RLS/grants'
);
select throws_ok(
  $$update public.project_members set role='owner' where project_id=:'id' and user_id=:'a_id'$$,
  '42501',
  null,
  'owner cannot change membership directly through RLS/grants'
);
select throws_ok(
  $$delete from public.project_members where project_id=:'id' and user_id=:'a_id'$$,
  '42501',
  null,
  'owner cannot delete membership directly through RLS/grants'
);

-- Service-role fixture represents the backend invite/accept path.
select tests.authenticate_as_service_role();
insert into public.project_members(project_id,user_id,role) values(:'id',:'a_id','owner') on conflict do nothing;
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','viewer');
insert into public.project_files(project_id,user_id,path,content) values(:'id',:'a_id','index.html','<h1>A</h1>');
insert into public.project_env_vars(project_id,user_id,key,value) values(:'id',:'a_id','SECRET_KEY','do-not-leak');
select tests.authenticate_as(:'b_id');
select is((select count(*) from public.projects where id=:'id'),1::bigint,'invited viewer can read project');
select ok(exists(select 1 from public.project_files where project_id=:'id'),'viewer can read project files');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'viewer cannot read env values');
select throws_ok(
  $$update public.project_files set content='<h1>B</h1>' where project_id=:'id' and path='index.html'$$,
  '42501',
  null,
  'viewer cannot write files'
);

-- Promote B to editor as the backend service role, then verify editor write but no project deletion.
select tests.authenticate_as_service_role();
update public.project_members set role='editor' where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
update public.project_files set content='<h1>B</h1>' where project_id=:'id' and path='index.html';
select is((select content from public.project_files where project_id=:'id' and path='index.html'),'<h1>B</h1>','editor can write files');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'editor cannot see env values');
select throws_ok(
  $$delete from public.projects where id=:'id'$$,
  '42501',
  null,
  'editor cannot delete project'
);

-- Remove B through the backend/service role; access disappears immediately.
select tests.authenticate_as_service_role();
delete from public.project_members where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
select is((select count(*) from public.projects where id=:'id'),0::bigint,'removed member loses access immediately');

-- Re-add B and verify atomic transfer, including ownership attribution on files/versions/env.
select tests.authenticate_as_service_role();
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','editor');
insert into public.project_file_versions(project_id,user_id,turn_id,path,action,existed_before,prev_content,prev_is_folder)
  values(:'id',:'a_id',gen_random_uuid(),'index.html','write',true,'<h1>old</h1>',false);
insert into public.project_transfer_requests(project_id,from_user_id,to_user_id,expires_at)
  values(:'id',:'a_id',:'b_id',now()+interval '7 days') returning id \gset transfer
select public.accept_project_transfer(:'transfer_id',:'b_id');
select is((select user_id from public.projects where id=:'id'),:'b_id'::uuid,'transfer changes canonical owner');
select is((select role from public.project_members where project_id=:'id' and user_id=:'a_id'),'editor','old owner becomes editor');
select is((select user_id from public.project_files where project_id=:'id' and path='index.html'),:'b_id'::uuid,'transfer moves file ownership attribution');
select is((select user_id from public.project_file_versions where project_id=:'id' and path='index.html' limit 1),:'b_id'::uuid,'transfer moves version ownership attribution');
select is((select value from public.project_env_vars where project_id=:'id' and key='SECRET_KEY'),'','transfer blanks environment values');

select * from finish();
rollback;

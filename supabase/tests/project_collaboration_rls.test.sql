-- Phase 1 collaboration RLS tests.
-- NOT RUN: 030_project_collaboration.sql is intentionally not applied in this PR.
-- Run in a disposable/local database after applying the migration with `supabase test db`.

begin;
select plan(12);

select tests.create_supabase_user('collab_a@example.com') as a_id \gset
select tests.create_supabase_user('collab_b@example.com') as b_id \gset
select tests.authenticate_as(:'a_id');
insert into public.projects(user_id,name,product) values(:'a_id','RLS Collaboration Test','K-XpertAI') returning id \gset
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','viewer');
insert into public.project_files(project_id,user_id,path,content) values(:'id',:'a_id','index.html','<h1>A</h1>');
insert into public.project_env_vars(project_id,user_id,key,value) values(:'id',:'a_id','SECRET_KEY','do-not-leak');

-- Before invite: B has no access. After the fixture invite below, B becomes a viewer.
delete from public.project_members where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
select is((select count(*) from public.projects where id=:'id'),0::bigint,'non-member cannot read A project');
select tests.authenticate_as(:'a_id');
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','viewer');
select tests.authenticate_as(:'b_id');
select ok(exists(select 1 from public.projects where id=:'id'),'viewer can read invited project');
select ok(exists(select 1 from public.project_files where project_id=:'id'),'viewer can read project files');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'viewer cannot read env values');

-- Promote B to editor as owner A.
select tests.authenticate_as(:'a_id');
update public.project_members set role='editor' where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
update public.project_files set content='<h1>B</h1>' where project_id=:'id' and path='index.html';
select is((select content from public.project_files where project_id=:'id' and path='index.html'),'<h1>B</h1>','editor can write files');
select is((select count(*) from public.project_env_var_keys where project_id=:'id' and key='SECRET_KEY'),1::bigint,'editor can see env key name');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'editor cannot see env values');
delete from public.projects where id=:'id';
select is((select count(*) from public.projects where id=:'id'),1::bigint,'editor cannot delete project');

-- Remove B; access disappears immediately.
select tests.authenticate_as(:'a_id');
delete from public.project_members where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
select is((select count(*) from public.projects where id=:'id'),0::bigint,'removed member loses access immediately');

-- Re-add B and verify atomic transfer: canonical owner changes and the old owner becomes editor.
select tests.authenticate_as(:'a_id');
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','editor');
insert into public.project_transfer_requests(project_id,from_user_id,to_user_id,expires_at) values(:'id',:'a_id',:'b_id',now()+interval '7 days') returning id \gset transfer
select tests.authenticate_as(:'b_id');
select public.accept_project_transfer(:'transfer_id',:'b_id');
select is((select user_id from public.projects where id=:'id'),:'b_id'::uuid,'transfer changes canonical owner');
select is((select role from public.project_members where project_id=:'id' and user_id=:'a_id'),'editor','old owner becomes editor');

select * from finish();
rollback;

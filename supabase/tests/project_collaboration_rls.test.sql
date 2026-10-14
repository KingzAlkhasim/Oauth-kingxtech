-- Phase 1 collaboration RLS test plan.
-- NOT RUN against production: 030_project_collaboration.sql is intentionally not applied in this PR.
-- Run with `supabase test db` in a disposable/local database after the migration is installed.
-- Uses Supabase's test helpers; replace helper names if the local test harness version differs.

begin;

select plan(14);

-- The test fixture must create two authenticated users A/B and a project owned by A.
select tests.create_supabase_user('collab_a@example.com') as a_id \gset
select tests.create_supabase_user('collab_b@example.com') as b_id \gset
select tests.authenticate_as(:'a_id');

insert into public.projects(user_id,name,product) values(:'a_id','RLS Collaboration Test','K-XpertAI') returning id \gset
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','viewer');
insert into public.project_files(project_id,user_id,path,content) values(:'id',:'a_id','index.html','<h1>A</h1>');
insert into public.project_env_vars(project_id,user_id,key,value) values(:'id',:'a_id','SECRET_KEY','do-not-leak');
insert into public.kxpert_sessions(id,user_id,project_id,title) values(gen_random_uuid(),:'a_id',:'id','Shared chat');

select tests.authenticate_as(:'b_id');
select ok(exists(select 1 from public.projects where id=:'id'),'viewer can read invited project');
select ok(exists(select 1 from public.project_files where project_id=:'id'),'viewer can read project files');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'viewer cannot read env values');
select throws_ok($q$update public.project_files set content='bad' where project_id='00000000-0000-0000-0000-000000000000'$q$,'42501',null,'viewer cannot write files');
select throws_ok($q$delete from public.projects where id='00000000-0000-0000-0000-000000000000'$q$,'42501',null,'viewer cannot delete projects');

update public.project_members set role='editor' where project_id=:'id' and user_id=:'b_id';
select ok(exists(select 1 from public.project_members where project_id=:'id' and user_id=:'b_id' and role='editor'),'member role can be promoted by owner');
select tests.authenticate_as(:'b_id');
update public.project_files set content='<h1>B</h1>' where project_id=:'id' and path='index.html';
select is((select content from public.project_files where project_id=:'id' and path='index.html'),'<h1>B</h1>','editor can write project files');
select is((select count(*) from public.project_env_var_keys where project_id=:'id' and key='SECRET_KEY'),1::bigint,'editor can see env key name');
select is((select count(*) from public.project_env_vars where project_id=:'id'),0::bigint,'editor cannot see env values');

select tests.authenticate_as(:'a_id');
delete from public.project_members where project_id=:'id' and user_id=:'b_id';
select tests.authenticate_as(:'b_id');
select is((select count(*) from public.projects where id=:'id'),0::bigint,'removed member loses project access immediately');
select is((select count(*) from public.project_files where project_id=:'id'),0::bigint,'removed member loses file access immediately');

select tests.authenticate_as(:'a_id');
insert into public.project_members(project_id,user_id,role) values(:'id',:'b_id','editor');
insert into public.project_transfer_requests(project_id,from_user_id,to_user_id,expires_at) values(:'id',:'a_id',:'b_id',now()+interval '7 days') returning id \gset transfer
select tests.authenticate_as(:'b_id');
select public.accept_project_transfer(:'transfer_id',:'b_id');
select is((select user_id from public.projects where id=:'id'),:'b_id'::uuid,'transfer makes target canonical owner');

select * from finish();
rollback;

-- Minimal stand-ins for what migration 047 depends on in a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create table if not exists public.projects (id uuid primary key, user_id uuid not null);
create table if not exists public.account_status (user_id uuid primary key, suspended boolean not null default false);
create table if not exists public.admin_users (user_id uuid primary key);

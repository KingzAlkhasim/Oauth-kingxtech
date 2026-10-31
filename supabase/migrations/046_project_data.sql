-- Project Data API: lets a project's published site save and read its own records
-- (contact forms, guestbooks, orders, scores...) through the KingxTech backend,
-- with no server code and no database key in the visitor's browser.
create table if not exists public.project_data_rules (
  project_id uuid not null references public.projects(id) on delete cascade,
  collection text not null check (collection ~ '^[a-z][a-z0-9_-]{0,39}$'),
  public_create boolean not null default false,  -- visitors may add records
  public_read boolean not null default false,    -- visitors may list records
  updated_at timestamptz not null default now(),
  primary key (project_id, collection)
);

create table if not exists public.project_data_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  collection text not null check (collection ~ '^[a-z][a-z0-9_-]{0,39}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  created_at timestamptz not null default now()
);
create index if not exists project_data_rows_lookup on public.project_data_rows (project_id, collection, created_at desc);

-- Backend-only tables: RLS on, no policies, so the browser keys can never touch them.
alter table public.project_data_rules enable row level security;
alter table public.project_data_rows enable row level security;
revoke all on public.project_data_rules, public.project_data_rows from anon, authenticated;

-- Adds a record only while the project is under its row cap. Returns the new id, or null when full.
create or replace function public.add_project_data_row(p_project uuid, p_collection text, p_data jsonb, p_max_rows integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project::text, 46));
  if (select count(*) from public.project_data_rows where project_id = p_project) >= greatest(1, least(coalesce(p_max_rows, 1), 100000)) then
    return null;
  end if;
  insert into public.project_data_rows (project_id, collection, data) values (p_project, p_collection, p_data) returning id into new_id;
  return new_id;
end
$$;
revoke all on function public.add_project_data_row(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.add_project_data_row(uuid, text, jsonb, integer) to service_role;

-- Whole-project restore points. Created automatically after every successful publish, before a
-- restore, and on request. Only the backend (service role) touches these tables.
create table if not exists public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  content_hash text not null,
  file_count integer not null default 0,
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists project_snapshots_project_idx on public.project_snapshots (project_id, created_at desc);

create table if not exists public.project_snapshot_files (
  snapshot_id uuid not null references public.project_snapshots(id) on delete cascade,
  path text not null,
  is_folder boolean not null default false,
  content text,
  primary key (snapshot_id, path)
);

alter table public.project_snapshots enable row level security;
alter table public.project_snapshot_files enable row level security;
-- No policies on purpose.

-- Copies the project's current source files into a new snapshot. Returns null when there is nothing
-- to save or nothing changed since the latest snapshot. Keeps only the newest p_keep snapshots.
create or replace function public.create_project_snapshot(p_project uuid, p_label text, p_keep integer default 5)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_count integer;
  v_bytes bigint;
  v_latest text;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_project::text));

  select coalesce(md5(string_agg(f.path || ':' || f.is_folder::text || ':' || coalesce(md5(f.content), ''), ',' order by f.path)), md5('')),
         count(*)::integer,
         coalesce(sum(octet_length(f.content)), 0)::bigint
    into v_hash, v_count, v_bytes
    from public.project_files f
   where f.project_id = p_project
     and f.path not like '.kingxtech-dist/%'
     and f.path not like '.kx-verify-dist/%';

  if v_count = 0 then
    return null;
  end if;

  select s.content_hash into v_latest
    from public.project_snapshots s
   where s.project_id = p_project
   order by s.created_at desc
   limit 1;
  if v_latest is not null and v_latest = v_hash then
    return null;
  end if;

  insert into public.project_snapshots (project_id, label, content_hash, file_count, bytes)
  values (p_project, left(coalesce(nullif(trim(p_label), ''), 'Restore point'), 60), v_hash, v_count, v_bytes)
  returning id into v_id;

  insert into public.project_snapshot_files (snapshot_id, path, is_folder, content)
  select v_id, f.path, f.is_folder, f.content
    from public.project_files f
   where f.project_id = p_project
     and f.path not like '.kingxtech-dist/%'
     and f.path not like '.kx-verify-dist/%';

  delete from public.project_snapshots
   where id in (
     select id from public.project_snapshots
      where project_id = p_project
      order by created_at desc
      offset greatest(p_keep, 1)
   );

  return v_id;
end;
$$;

-- Replaces the project's source files with a snapshot, in one transaction. The current state is saved
-- first as "Before restore" so a restore can always be undone. p_limit_bytes (optional) is the owner's
-- plan limit; the restore is refused with STORAGE_FULL if it would push the owner over it.
create or replace function public.restore_project_snapshot(
  p_project uuid, p_snapshot uuid, p_keep integer default 5, p_limit_bytes bigint default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_snap_bytes bigint;
  v_current_bytes bigint;
  v_used bigint;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_project::text));

  select p.user_id into v_owner from public.projects p where p.id = p_project;
  if v_owner is null then
    raise exception 'Project not found';
  end if;

  select s.bytes into v_snap_bytes
    from public.project_snapshots s
   where s.id = p_snapshot and s.project_id = p_project;
  if v_snap_bytes is null then
    raise exception 'Snapshot not found';
  end if;

  if p_limit_bytes is not null then
    select coalesce(sum(octet_length(f.content)), 0)::bigint into v_current_bytes
      from public.project_files f
     where f.project_id = p_project and not f.is_folder
       and f.path not like '.kingxtech-dist/%' and f.path not like '.kx-verify-dist/%';
    v_used := public.user_source_bytes(v_owner);
    if v_used - v_current_bytes + v_snap_bytes > p_limit_bytes then
      raise exception 'STORAGE_FULL';
    end if;
  end if;

  -- +1 so saving the "Before restore" copy can never trim away the snapshot we are about to restore.
  perform public.create_project_snapshot(p_project, 'Before restore', greatest(p_keep, 1) + 1);

  delete from public.project_files
   where project_id = p_project
     and path not like '.kingxtech-dist/%'
     and path not like '.kx-verify-dist/%';

  insert into public.project_files (project_id, user_id, path, is_folder, content)
  select p_project, v_owner, sf.path, sf.is_folder, sf.content
    from public.project_snapshot_files sf
   where sf.snapshot_id = p_snapshot;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.create_project_snapshot(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.restore_project_snapshot(uuid, uuid, integer, bigint) from public, anon, authenticated;
grant execute on function public.create_project_snapshot(uuid, text, integer) to service_role;
grant execute on function public.restore_project_snapshot(uuid, uuid, integer, bigint) to service_role;

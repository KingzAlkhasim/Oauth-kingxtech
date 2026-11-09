-- Project Servers: a deleted project must not erase its usage, and must not leave its sandbox behind.
--
-- Found in the first real test: deleting the project removed its runtime and usage rows (ON DELETE CASCADE).
--  1. Quota bypass: usage lived only on the project, so deleting a project wiped its hours/CPU/egress from the owner's month.
--  2. Orphan sandbox: the runtime row was the only record that a sandbox existed, so nothing could ever stop or delete it.
-- Projects are deleted straight from the browser (no API call to hook), so the database itself has to keep the records.
--
-- Additive and safe to re-run. project_server_settings keeps its cascade: no project means no on/off switch to keep.

alter table public.project_server_sessions drop constraint if exists project_server_sessions_project_id_fkey;
alter table public.project_server_runtime  drop constraint if exists project_server_runtime_project_id_fkey;

-- Runtime rows whose project is gone and whose server is not running. A row waits until its sessions carry measured numbers
-- (deleting the sandbox first would lose them), or for 3 days, whichever comes first.
create or replace function public.ps_orphan_runtimes(p_limit int default 20)
returns table (project_id uuid, owner_id uuid)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select r.project_id, r.owner_id from public.project_server_runtime r
  where r.state in ('STOPPED','FAILED')
    and not exists (select 1 from public.projects p where p.id = r.project_id)
    and (r.updated_at < now() - interval '3 days'
         or not exists (select 1 from public.project_server_sessions s where s.project_id = r.project_id and s.basis = 'estimated'))
  order by r.updated_at limit p_limit;
$$;

-- Forget a runtime row once its sandbox is deleted. Refuses while the project exists or the server is not stopped. Usage rows stay.
create or replace function public.ps_forget_runtime(p_project uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare n int;
begin
  delete from public.project_server_runtime r
  where r.project_id = p_project and r.state in ('STOPPED','FAILED')
    and not exists (select 1 from public.projects p where p.id = p_project);
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.ps_orphan_runtimes(int), public.ps_forget_runtime(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ps_orphan_runtimes(int), public.ps_forget_runtime(uuid) to service_role;

-- Total stored size of a user's counted source files (published builds excluded).
-- Called only by the backend (service role) to enforce plan storage limits.
create or replace function public.user_source_bytes(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(octet_length(f.content)), 0)::bigint
  from public.project_files f
  join public.projects p on p.id = f.project_id
  where p.user_id = p_user
    and not f.is_folder
    and f.path not like '.kingxtech-dist/%'
    and f.path not like '.kx-verify-dist/%'
$$;
revoke all on function public.user_source_bytes(uuid) from public, anon, authenticated;
grant execute on function public.user_source_bytes(uuid) to service_role;

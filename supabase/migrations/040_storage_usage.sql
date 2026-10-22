-- Per-project storage for the signed-in user: source files vs. the published build.
-- Sizes are the stored size of each file (images and fonts are stored as base64, so they
-- count about a third larger than on disk). Only the caller's own projects are returned.
create or replace function public.my_storage_usage()
returns table (
  project_id uuid,
  project_name text,
  slug text,
  published boolean,
  source_bytes bigint,
  build_bytes bigint,
  file_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.slug,
    (p.published_at is not null),
    coalesce(sum(octet_length(f.content)) filter (where not f.is_folder and f.path not like '.kingxtech-dist/%'), 0)::bigint,
    coalesce(sum(octet_length(f.content)) filter (where not f.is_folder and f.path like '.kingxtech-dist/%'), 0)::bigint,
    (count(f.id) filter (where not f.is_folder and f.path not like '.kingxtech-dist/%'))::integer
  from public.projects p
  left join public.project_files f on f.project_id = p.id
  where p.user_id = auth.uid()
  group by p.id, p.name, p.slug, p.published_at
  order by 5 desc, 6 desc
$$;
revoke all on function public.my_storage_usage() from public;
grant execute on function public.my_storage_usage() to authenticated;

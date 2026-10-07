-- Pro custom PWA icons: one nullable project pointer plus a public-read Storage bucket.
alter table public.projects
  add column if not exists pwa_icon_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-pwa-icons',
  'project-pwa-icons',
  true,
  1048576,
  array['image/png']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

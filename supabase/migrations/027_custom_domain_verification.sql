-- Store Vercel's actual domain verification challenges so the UI can
-- show the exact DNS record(s) instead of assuming every domain is a CNAME.

alter table public.custom_domains
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists verification jsonb not null default '[]'::jsonb;

create index if not exists custom_domains_project_id_idx on public.custom_domains(project_id);

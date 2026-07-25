-- Run this once in Supabase Dashboard → SQL Editor.
-- Every mutating file operation the AI performs snapshots the PRE-CHANGE
-- state here first, tagged with a turn_id (one per agent response). This
-- powers both "revert this whole turn" (reject) and "undo this one file".

create table if not exists public.project_file_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  turn_id uuid not null,
  path text not null,
  action text not null check (action in ('write', 'delete', 'create_folder')),
  existed_before boolean not null,
  prev_content text,
  prev_is_folder boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_file_versions_turn_idx
  on public.project_file_versions (project_id, turn_id, created_at desc);

create index if not exists project_file_versions_path_idx
  on public.project_file_versions (project_id, path, created_at desc);

alter table public.project_file_versions enable row level security;

drop policy if exists "Users can view own file versions" on public.project_file_versions;
create policy "Users can view own file versions" on public.project_file_versions
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own file versions" on public.project_file_versions;
create policy "Users can insert own file versions" on public.project_file_versions
  for insert with check (auth.uid() = user_id);

-- No update/delete policy — version history is append-only and immutable,
-- so an undo can never itself be tampered with after the fact.

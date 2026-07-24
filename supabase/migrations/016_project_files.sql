-- Run this once in Supabase Dashboard → SQL Editor.
-- Extends the existing `projects` table with a virtual filesystem: every
-- row here is one file or folder marker belonging to a project. The AI
-- agent reads/writes/deletes THESE rows — never the real host filesystem —
-- so "delete a file" can never touch anything outside this sandboxed data.

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  path text not null,               -- e.g. "src/App.jsx" or "src/components" (folder)
  is_folder boolean not null default false,
  content text,                     -- null for folders
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One path per project — writing to an existing path is an edit (upsert),
  -- not a duplicate row.
  unique (project_id, path)
);

create index if not exists project_files_project_idx
  on public.project_files (project_id, path);

alter table public.project_files enable row level security;

drop policy if exists "Users can view own project files" on public.project_files;
create policy "Users can view own project files" on public.project_files
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own project files" on public.project_files;
create policy "Users can insert own project files" on public.project_files
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own project files" on public.project_files;
create policy "Users can update own project files" on public.project_files
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own project files" on public.project_files;
create policy "Users can delete own project files" on public.project_files
  for delete using (auth.uid() = user_id);

drop trigger if exists project_files_set_updated_at on public.project_files;
create trigger project_files_set_updated_at
  before update on public.project_files
  for each row execute function public.set_updated_at();

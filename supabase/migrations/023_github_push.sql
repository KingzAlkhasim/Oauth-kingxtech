-- Run this once in Supabase Dashboard → SQL Editor.
-- Powers "push this project to GitHub". Uses a user-supplied Personal Access
-- Token rather than a registered GitHub OAuth App (the existing "Connect"
-- button under Console → Settings is Supabase's SSO identity link, used for
-- sign-in only — it doesn't grant API scopes to read/write repos, and
-- Supabase doesn't persist third-party provider tokens for later use). This
-- table follows the same "treat like a .env file, not a secrets vault"
-- convention already used by env_vars and api_keys.

create table if not exists public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now()
);

alter table public.github_connections enable row level security;

drop policy if exists "Users can view own github connection" on public.github_connections;
create policy "Users can view own github connection" on public.github_connections
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own github connection" on public.github_connections;
create policy "Users can insert own github connection" on public.github_connections
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own github connection" on public.github_connections;
create policy "Users can update own github connection" on public.github_connections
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own github connection" on public.github_connections;
create policy "Users can delete own github connection" on public.github_connections
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------------------

create table if not exists public.project_github_links (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null, -- e.g. "kingz/frontend-estate-web"
  branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_github_links enable row level security;

drop policy if exists "Users can view own github links" on public.project_github_links;
create policy "Users can view own github links" on public.project_github_links
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own github links" on public.project_github_links;
create policy "Users can insert own github links" on public.project_github_links
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own github links" on public.project_github_links;
create policy "Users can update own github links" on public.project_github_links
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own github links" on public.project_github_links;
create policy "Users can delete own github links" on public.project_github_links
  for delete using (auth.uid() = user_id);

-- Run this once in Supabase Dashboard → SQL Editor.
-- Adds an explicit opt-in flag so KX Cloud env vars can be safely exposed to
-- a PUBLIC preview/published site. This is deliberately opt-in per variable
-- (default false) — preview/site routes have no login wall, so anything
-- marked public here becomes visible to anyone who views the page source,
-- the same way VITE_-prefixed or NEXT_PUBLIC_-prefixed vars work elsewhere.
-- Never mark a real secret (API secret keys, tokens) as public.

alter table public.env_vars
  add column if not exists is_public boolean not null default false;

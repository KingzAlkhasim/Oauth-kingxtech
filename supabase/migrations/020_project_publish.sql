-- Run this once in Supabase Dashboard → SQL Editor.
-- Adds a public, human-friendly slug to projects so a published project gets
-- a permanent URL (/site/:slug/) instead of only the raw UUID preview link.
-- Note: the raw /preview/:projectId/ link already works the instant the AI
-- writes files — nothing needs "deploying" in the traditional sense, since
-- the preview route renders straight from project_files on every request.
-- Publishing just assigns a nicer, stable, memorable URL on top of that.

alter table public.projects
  add column if not exists slug text unique,
  add column if not exists published_at timestamptz;

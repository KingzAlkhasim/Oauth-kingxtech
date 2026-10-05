-- Per-project PWA settings. Disabled by default so existing published sites are unchanged.
alter table public.projects
  add column if not exists pwa_enabled boolean not null default false,
  add column if not exists pwa_theme_color text not null default '#09090B',
  add column if not exists pwa_background_color text not null default '#09090B';

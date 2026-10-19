-- Vercel's "verified" only proves ownership. dns_configured records whether DNS really
-- points at us (null = not checked yet). The UI shows Active only when both are true.
alter table public.custom_domains
  add column if not exists dns_configured boolean;

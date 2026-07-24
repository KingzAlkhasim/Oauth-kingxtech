-- Run this once in Supabase Dashboard → SQL Editor.
-- Gates which models a user can access. 'free' users can only use the
-- genuinely-free open-weights models (Qwen, Llama via OpenRouter); 'paid'
-- users can also use Gemini/Claude/GPT. Until the payment gateway is wired,
-- everyone defaults to 'free' — flip a user to 'paid' manually for now:
--   update billing_profile set plan = 'paid' where user_id = '...';

alter table public.billing_profile
  add column if not exists plan text not null default 'free';

alter table public.billing_profile
  drop constraint if exists billing_profile_plan_check;

alter table public.billing_profile
  add constraint billing_profile_plan_check check (plan in ('free', 'paid'));

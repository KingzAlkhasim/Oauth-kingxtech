-- Run this once in Supabase Dashboard → SQL Editor.
-- billing_events previously had no read access for regular users (only the
-- service role, via the webhook function, could touch it at all). This adds
-- a SELECT-only policy so the Billing page can show a real transaction
-- history — insert/update/delete remain service-role-only.

drop policy if exists "Users can view own billing events" on public.billing_events;
create policy "Users can view own billing events" on public.billing_events
  for select using (auth.uid() = user_id);

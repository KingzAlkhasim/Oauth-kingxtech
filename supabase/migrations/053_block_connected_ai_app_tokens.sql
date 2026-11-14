-- AI-app connector (Claude, ChatGPT): tokens issued by Supabase's OAuth server are ordinary user JWTs plus a
-- `client_id` claim. Without this, an AI app holding one could call the Supabase REST, RPC and Storage APIs directly
-- with the user's rights. Connected apps may only use our /mcp endpoint, which has a fixed, small set of tools.
-- Already applied to production by hand; this file is the record.

create or replace function public.block_oauth_app_tokens()
returns void language plpgsql stable set search_path = pg_catalog, public as $$
declare v_client text;
begin
  begin
    v_client := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id';
  exception when others then
    v_client := null;
  end;
  if v_client is not null then
    raise exception 'Tokens issued to connected AI apps cannot use this API.' using errcode = '42501';
  end if;
end $$;
grant execute on function public.block_oauth_app_tokens() to anon, authenticated, service_role;

-- Runs before every PostgREST (REST + RPC) request. To undo:
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
alter role authenticator set pgrst.db_pre_request = 'public.block_oauth_app_tokens';
notify pgrst, 'reload config';

-- The Storage API checks RLS on storage.objects, so close that door too.
create policy "no_connected_ai_apps" on storage.objects as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'client_id') is null)
  with check ((select auth.jwt() ->> 'client_id') is null);

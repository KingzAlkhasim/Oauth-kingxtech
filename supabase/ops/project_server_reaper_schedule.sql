-- OPT-IN operations script. NOT a migration: it is never applied automatically and it contains no secrets.
--
-- Why this exists: the project-server reaper endpoint (GET /api/internal/cron/project-servers-reap) has to run far more
-- often than once a day. The only Vercel account visible to this work is on the Hobby plan, where cron jobs may run
-- at most once per day (and a sub-daily expression fails the deployment). Supabase pg_cron + pg_net are already enabled
-- on the KingxTech Ecosystem project (the aria-dispatch job uses them), so the schedule can live there instead.
--
-- If the API's Vercel project is on Pro, you can instead add this to core/vercel.json (any plan check first):
--   { "path": "/api/internal/cron/project-servers-reap", "schedule": "*/5 * * * *" }
--
-- Apply to STAGING first. Steps:
--  1. Store the endpoint and the same secret the API has as CRON_SECRET in Vault (run once, by hand, with real values):
--       select vault.create_secret('https://<api-host>/api/internal/cron/project-servers-reap', 'project_server_reap_url');
--       select vault.create_secret('<CRON_SECRET value>',                                       'project_server_reap_secret');
--  2. Run the statement below.
--  3. Verify:  select jobid, jobname, schedule, active from cron.job where jobname = 'project-server-reaper';
--              select status_code, created from net._http_response order by created desc limit 5;   -- expect 200s
--  4. Remove:  select cron.unschedule('project-server-reaper');
--
-- Overlapping or repeated calls are safe: the reaper claims work with row locks and leases.
select cron.schedule(
  'project-server-reaper',
  '* * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_server_reap_url'),
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_server_reap_secret')),
      timeout_milliseconds := 60000
    );
  $job$
);

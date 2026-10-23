-- Calls the Vercel tick route (web/app/api/tick) every minute, so the staged runner settles, makes final calls, picks,
-- refreshes Scout and writes debates and lessons as soon as there is work (one stage per call, under the runner lock).
--
-- CREATED DISABLED. It is switched on at cutover (docs/runbook/supabase-cutover.md), after KDACE_STORE=supabase is set
-- on Vercel and the records are copied. The route also refuses to run unless KDACE_STORE=supabase, so turning this on
-- early does nothing but log 409s.
--
-- The URL lives in Supabase Vault; the bearer secret is the lock route's (LOCK_SECRET, already in Vault):
--   select vault.create_secret('https://<your-vercel-domain>/api/tick', 'kdace_tick_url');
-- Enable:   select cron.alter_job((select jobid from cron.job where jobname = 'kdace-tick'), active := true);
-- Disable:  select cron.alter_job((select jobid from cron.job where jobname = 'kdace-tick'), active := false);
-- Runs:      select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'kdace-tick') order by start_time desc limit 20;
-- Responses: select * from net._http_response order by created desc limit 20;
--
-- The timeout is just under Vercel's 300 s: a stage can take minutes, and the route answers when it is done.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kdace-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 295000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'kdace_tick_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'kdace_lock_secret') as secret
  ) s
  where s.url is not null and s.secret is not null;
  $$
);

select cron.alter_job((select jobid from cron.job where jobname = 'kdace-tick'), active := false);

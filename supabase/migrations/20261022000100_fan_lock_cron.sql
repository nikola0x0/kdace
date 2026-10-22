-- Calls the Vercel lock route every minute, so each series' fan batch is committed right after its lock
-- (5 minutes before the scheduled start). The GitHub tick runs only every 30 minutes and often starts late.
--
-- The URL and the secret live in Supabase Vault, not in this file. Set them once (SQL editor):
--   select vault.create_secret('https://<your-vercel-domain>/api/lock', 'kdace_lock_url');
--   select vault.create_secret('<same value as LOCK_SECRET on Vercel>', 'kdace_lock_secret');
-- To change one later:
--   select vault.update_secret((select id from vault.secrets where name = 'kdace_lock_url'), '<new value>');
-- Until both exist the job does nothing.
-- Runs:      select * from cron.job_run_details order by start_time desc limit 20;
-- Responses: select * from net._http_response order by created desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kdace-fan-lock',
  '* * * * *',
  $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'kdace_lock_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'kdace_lock_secret') as secret
  ) s
  where s.url is not null and s.secret is not null;
  $$
);

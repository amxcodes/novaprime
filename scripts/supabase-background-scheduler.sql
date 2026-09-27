-- Optional Supabase Cloud scheduler adapter.
-- Run once in the exact NOVA project's SQL editor or with psql after setting:
--   \set nova_public_origin 'https://nova.example.com'
--   \set nova_background_job_secret 'the deployment-only secret'
-- The values are stored in Supabase Vault, not in the cron command text.

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Supabase Cloud exposes the Vault extension as `supabase_vault`; it creates
-- the provider-neutral `vault` schema used below. Direct PostgreSQL/VPS
-- deployments can select another secret adapter instead of this script.
create extension if not exists supabase_vault;

select cron.unschedule(jobid)
from cron.job
where jobname = 'nova-background-tick';

-- Replace NOVA's two Vault values so this setup command is safe to rerun.
delete from vault.secrets
where name in ('nova_background_url', 'nova_background_job_secret');

select vault.create_secret(:'nova_public_origin', 'nova_background_url', 'NOVA background tick URL');
select vault.create_secret(:'nova_background_job_secret', 'nova_background_job_secret', 'NOVA background tick bearer secret');

select cron.schedule(
  'nova-background-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nova_background_url') || '/api/internal/background/tick',
  headers := jsonb_build_object(
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nova_background_job_secret'),
      'x-nova-background-scheduler', 'supabase',
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

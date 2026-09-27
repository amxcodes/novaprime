-- Disable only NOVA's Supabase Cron job and remove only its two Vault secrets.
-- The command is safe when NOVA's scheduler has never been configured.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''nova-background-tick''';
  end if;
  if exists (select 1 from pg_extension where extname = 'supabase_vault') then
    execute 'delete from vault.secrets where name in (''nova_background_url'', ''nova_background_job_secret'')';
  end if;
end
$$;

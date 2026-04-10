do $$
declare
  existing_job record;
  project_url text;
  cron_token text;
  has_cron boolean := false;
  has_net boolean := false;
  has_vault boolean := false;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  select exists(select 1 from pg_extension where extname = 'pg_net') into has_net;
  select exists(select 1 from pg_extension where extname = 'vault') into has_vault;

  if not has_cron or not has_net or not has_vault or to_regclass('cron.job') is null then
    raise notice 'AI watcher cron was not rescheduled. pg_cron, pg_net, or vault is unavailable in this environment.';
    return;
  end if;

  for existing_job in
    select jobid from cron.job where jobname in ('ai-watcher-bot-every-120-minutes', 'ai-watcher-bot-every-30-minutes')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into cron_token
  from vault.decrypted_secrets
  where name = 'ai_watcher_cron_token'
  limit 1;

  if project_url is null or cron_token is null then
    raise notice 'AI watcher cron was not rescheduled. Add Vault secrets named project_url and ai_watcher_cron_token, then rerun the scheduling block.';
  else
    perform cron.schedule(
      'ai-watcher-bot-every-30-minutes',
      '*/30 * * * *',
      format($job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-ai-watcher-cron-token', %L
          ),
          body := jsonb_build_object(
            'trigger', 'pg_cron',
            'scheduled_at', now()
          )
        ) as request_id;
      $job$, rtrim(project_url, '/') || '/functions/v1/ai-watcher', cron_token)
    );
  end if;
end;
$$;
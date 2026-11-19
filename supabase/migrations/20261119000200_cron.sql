-- Scheduled ingestion without a browser: pg_cron → pg_net → Edge Functions.
-- Before this runs, store two secrets in Vault (Dashboard → Project Settings → Vault, or SQL):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_edge_function(fn text, payload jsonb default '{}')
returns bigint language plpgsql security definer set search_path = public as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if base is null or secret is null then
    raise notice 'Vault secrets project_url / cron_secret are not set; skipping %', fn;
    return null;
  end if;
  return net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := payload,
    timeout_milliseconds := 150000
  );
end $$;
revoke all on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- every 15 minutes: run sources that are due (the function decides per source refresh_minutes)
select cron.schedule('signal-ingest', '*/15 * * * *', $$select public.invoke_edge_function('ingest', '{"mode":"due"}')$$);
-- daily digest at 07:43 UTC
select cron.schedule('signal-digest', '43 7 * * *', $$select public.invoke_edge_function('digest', '{}')$$);

alter table public.reports
  add column if not exists reported_key text;

update public.reports
set reported_key = coalesce(reported_key, reported_id::text, reported_user_id::text)
where reported_key is null;

create index if not exists reports_reported_key_idx
  on public.reports (reported_key);

create index if not exists reports_type_reported_key_idx
  on public.reports (type, reported_key);
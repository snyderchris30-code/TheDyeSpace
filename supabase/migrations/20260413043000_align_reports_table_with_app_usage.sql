alter table public.reports
  add column if not exists type text;

alter table public.reports
  add column if not exists reported_id uuid;

alter table public.reports
  add column if not exists reported_by uuid references public.profiles(id) on delete set null;

update public.reports
set reported_id = reported_user_id
where reported_id is null
  and reported_user_id is not null;

update public.reports
set reported_by = reporter_id
where reported_by is null
  and reporter_id is not null;

update public.reports
set type = coalesce(type, case when reported_user_id is not null then 'user' else null end)
where type is null;

create index if not exists reports_type_created_at_idx
  on public.reports (type, created_at desc);

create index if not exists reports_reported_id_idx
  on public.reports (reported_id);

create index if not exists reports_reported_user_id_idx
  on public.reports (reported_user_id);

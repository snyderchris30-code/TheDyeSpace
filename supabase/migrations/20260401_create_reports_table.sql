create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz default now()
);

alter table public.reports enable row level security;

drop policy if exists "Authenticated users can insert reports" on public.reports;
create policy "Authenticated users can insert reports" on public.reports
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Reporters can read their own reports" on public.reports;
create policy "Reporters can read their own reports" on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

-- create policy "Admins can read all reports" on public.reports
--   for select to authenticated
--   using (auth.role() = 'service_role');

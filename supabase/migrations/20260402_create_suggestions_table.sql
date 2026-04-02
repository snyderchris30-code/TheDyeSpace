create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text,
  email text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;

drop policy if exists "Anyone can insert suggestions" on public.suggestions;
create policy "Anyone can insert suggestions" on public.suggestions
  for insert to anon, authenticated
  with check (true);

drop policy if exists "Users can read their own suggestions" on public.suggestions;
create policy "Users can read their own suggestions" on public.suggestions
  for select to authenticated
  using (user_id = auth.uid());
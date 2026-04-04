-- Ensure post writes from authenticated users consistently satisfy RLS checks.

alter table public.posts enable row level security;

drop policy if exists "Authenticated users can insert posts" on public.posts;
create policy "Authenticated users can insert posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Authenticated users can update their posts" on public.posts;
create policy "Authenticated users can update their posts"
  on public.posts for update
  to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

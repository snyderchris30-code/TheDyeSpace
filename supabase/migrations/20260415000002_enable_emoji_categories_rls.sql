alter table if exists public.emoji_categories
  enable row level security;

drop policy if exists "Public can read emoji categories" on public.emoji_categories;
create policy "Public can read emoji categories"
  on public.emoji_categories
  for select
  using (true);

-- Keep management operations restricted to service role / server-side code.
drop policy if exists "Authenticated users can manage emoji categories" on public.emoji_categories;
create policy "Authenticated users can manage emoji categories"
  on public.emoji_categories
  for all
  to authenticated
  using (false)
  with check (false);

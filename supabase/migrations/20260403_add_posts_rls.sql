-- Enable RLS and allow authenticated users to insert and update their own posts

alter table public.posts enable row level security;

drop policy if exists "Authenticated users can insert posts" on public.posts;
create policy "Authenticated users can insert posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Authenticated users can update their posts" on public.posts;
create policy "Authenticated users can update their posts"
  on public.posts for update
  to authenticated
  using (auth.uid() = user_id);

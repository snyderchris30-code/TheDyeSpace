create table if not exists public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint user_follows_no_self_follow check (follower_id <> followed_id)
);

create index if not exists idx_user_follows_followed on public.user_follows (followed_id);
create index if not exists idx_user_follows_created_at on public.user_follows (created_at desc);

alter table public.user_follows enable row level security;

drop policy if exists "Users can read own following" on public.user_follows;
create policy "Users can read own following" on public.user_follows
  for select to authenticated
  using (follower_id = auth.uid());

drop policy if exists "Users can follow others" on public.user_follows;
create policy "Users can follow others" on public.user_follows
  for insert to authenticated
  with check (follower_id = auth.uid() and follower_id <> followed_id);

drop policy if exists "Users can unfollow others" on public.user_follows;
create policy "Users can unfollow others" on public.user_follows
  for delete to authenticated
  using (follower_id = auth.uid());
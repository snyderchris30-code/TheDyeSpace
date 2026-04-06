alter table public.posts
  add column if not exists deleted_at timestamptz null;

alter table public.post_comments
  add column if not exists deleted_at timestamptz null;

create index if not exists posts_deleted_at_idx on public.posts (deleted_at, created_at desc);
create index if not exists post_comments_deleted_at_idx on public.post_comments (deleted_at, created_at desc);

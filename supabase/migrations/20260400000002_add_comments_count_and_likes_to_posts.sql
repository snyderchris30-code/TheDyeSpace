alter table public.posts add column if not exists comments_count integer not null default 0;
alter table public.posts add column if not exists likes integer not null default 0;
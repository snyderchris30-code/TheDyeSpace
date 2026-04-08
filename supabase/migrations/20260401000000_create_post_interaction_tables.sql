create extension if not exists pgcrypto;

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_id_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_user_id_idx on public.post_comments (user_id, created_at);

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id, created_at);
create index if not exists post_reactions_user_id_idx on public.post_reactions (user_id, created_at);

alter table public.post_comments enable row level security;
alter table public.post_reactions enable row level security;

drop policy if exists "Public can view post comments" on public.post_comments;
create policy "Public can view post comments"
  on public.post_comments for select
  using (true);

drop policy if exists "Authenticated users can add their comments" on public.post_comments;
create policy "Authenticated users can add their comments"
  on public.post_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their comments" on public.post_comments;
create policy "Users can delete their comments"
  on public.post_comments for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Public can view post reactions" on public.post_reactions;
create policy "Public can view post reactions"
  on public.post_reactions for select
  using (true);

drop policy if exists "Authenticated users can manage their reactions" on public.post_reactions;
create policy "Authenticated users can manage their reactions"
  on public.post_reactions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into public.post_comments (id, post_id, user_id, content, created_at)
select
  case
    when (comment->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (comment->>'id')::uuid
    else gen_random_uuid()
  end,
  (comment->>'post_id')::uuid,
  profiles.id,
  comment->>'content',
  case
    when coalesce(comment->>'created_at', '') <> '' then (comment->>'created_at')::timestamptz
    else now()
  end
from public.profiles
cross join lateral jsonb_array_elements(coalesce(profiles.theme_settings->'post_comments', '[]'::jsonb)) as comment
where (comment->>'post_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and char_length(trim(coalesce(comment->>'content', ''))) > 0
on conflict (id) do nothing;

insert into public.post_reactions (post_id, user_id, emoji, created_at)
select distinct on ((reaction->>'post_id')::uuid, profiles.id)
  (reaction->>'post_id')::uuid,
  profiles.id,
  (reaction->>'emoji')::text,
  case
    when coalesce(reaction->>'created_at', '') <> '' then (reaction->>'created_at')::timestamptz
    else now()
  end
from public.profiles
cross join lateral jsonb_array_elements(coalesce(profiles.theme_settings->'post_reactions', '[]'::jsonb)) as reaction
where (reaction->>'post_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (reaction->>'emoji') in ('❤️', '🔥', '😂', '😮', '😢', '🎉', '👍')
order by (reaction->>'post_id')::uuid, profiles.id,
  case
    when coalesce(reaction->>'created_at', '') <> '' then (reaction->>'created_at')::timestamptz
    else now()
  end desc
on conflict (post_id, user_id) do update
set emoji = excluded.emoji,
    created_at = excluded.created_at;

update public.posts set comments_count = 0, likes = 0;

update public.posts posts
set comments_count = counts.comment_count
from (
  select post_id, count(*)::int as comment_count
  from public.post_comments
  group by post_id
) counts
where posts.id = counts.post_id;

update public.posts posts
set likes = counts.reaction_count
from (
  select post_id, count(*)::int as reaction_count
  from public.post_reactions
  group by post_id
) counts
where posts.id = counts.post_id;
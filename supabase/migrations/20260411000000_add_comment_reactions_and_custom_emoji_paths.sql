delete from public.post_reactions
where emoji !~* '^/emojis/.+\.(png|gif)$';

alter table public.post_reactions
  drop constraint if exists post_reactions_emoji_check;

alter table public.post_reactions
  add constraint post_reactions_emoji_check
  check (emoji ~* '^/emojis/.+\.(png|gif)$');

create table if not exists public.post_comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji ~* '^/emojis/.+\.(png|gif)$'),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists post_comment_reactions_comment_id_idx
  on public.post_comment_reactions (comment_id, created_at desc);

create index if not exists post_comment_reactions_user_id_idx
  on public.post_comment_reactions (user_id, created_at desc);

alter table public.post_comment_reactions enable row level security;

drop policy if exists "Public can view post comment reactions" on public.post_comment_reactions;
create policy "Public can view post comment reactions"
  on public.post_comment_reactions for select
  using (true);

drop policy if exists "Authenticated users can manage their comment reactions" on public.post_comment_reactions;
create policy "Authenticated users can manage their comment reactions"
  on public.post_comment_reactions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

update public.posts set likes = 0;

update public.posts posts
set likes = counts.reaction_count
from (
  select post_id, count(*)::int as reaction_count
  from public.post_reactions
  group by post_id
) counts
where posts.id = counts.post_id;
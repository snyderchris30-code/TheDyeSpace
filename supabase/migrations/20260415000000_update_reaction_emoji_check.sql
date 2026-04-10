alter table if exists public.post_reactions
  drop constraint if exists post_reactions_emoji_check;

alter table if exists public.post_reactions
  add constraint post_reactions_emoji_check
  check (emoji ~* '^(/emojis/)?(?:[^/]+/)*[^/]+\.(png|gif)$');

alter table if exists public.post_comment_reactions
  drop constraint if exists post_comment_reactions_emoji_check;

alter table if exists public.post_comment_reactions
  add constraint post_comment_reactions_emoji_check
  check (emoji ~* '^(/emojis/)?(?:[^/]+/)*[^/]+\.(png|gif)$');

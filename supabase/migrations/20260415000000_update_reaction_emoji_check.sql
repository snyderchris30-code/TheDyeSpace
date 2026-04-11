-- removed invalid stray line
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'post_reactions'
      AND constraint_name = 'post_reactions_emoji_check'
  ) THEN
    ALTER TABLE public.post_reactions DROP CONSTRAINT post_reactions_emoji_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'post_reactions'
      AND constraint_name = 'post_reactions_emoji_check'
  ) THEN
    ALTER TABLE public.post_reactions ADD CONSTRAINT post_reactions_emoji_check CHECK (emoji ~* '^(/emojis/)?(?:[^/]+/)*[^/]+\.(png|gif)$');
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'post_comment_reactions'
      AND constraint_name = 'post_comment_reactions_emoji_check'
  ) THEN
    ALTER TABLE public.post_comment_reactions DROP CONSTRAINT post_comment_reactions_emoji_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'post_comment_reactions'
      AND constraint_name = 'post_comment_reactions_emoji_check'
  ) THEN
    ALTER TABLE public.post_comment_reactions ADD CONSTRAINT post_comment_reactions_emoji_check CHECK (emoji ~* '^(/emojis/)?(?:[^/]+/)*[^/]+\.(png|gif)$');
  END IF;
END$$;

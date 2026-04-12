-- Add missing notifications columns needed by the notifications API route.
-- This is intentionally idempotent so it can be applied safely to existing databases.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT 'someone';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS post_id uuid NULL REFERENCES public.posts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notifications_post_idx ON public.notifications (post_id);

-- Ensure notifications rows have both actor_name and actor_avatar_url columns.
-- This migration is idempotent and safe to run on existing schema.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT 'someone';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_avatar_url text NULL;

-- Normalize existing rows so the actor_name column is not null.
UPDATE public.notifications
SET actor_name = 'someone'
WHERE actor_name IS NULL;

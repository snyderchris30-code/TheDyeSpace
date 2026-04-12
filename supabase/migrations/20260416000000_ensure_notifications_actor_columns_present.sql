-- Ensure notifications rows always expose actor_name and actor_avatar_url.
-- This is safe to run even if prior migrations already added the columns.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_name text;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_avatar_url text;

ALTER TABLE public.notifications
  ALTER COLUMN actor_name SET DEFAULT 'someone';

UPDATE public.notifications
SET actor_name = 'someone'
WHERE actor_name IS NULL OR btrim(actor_name) = '';

ALTER TABLE public.notifications
  ALTER COLUMN actor_name SET NOT NULL;
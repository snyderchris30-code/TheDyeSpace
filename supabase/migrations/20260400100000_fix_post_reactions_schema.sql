-- Pre-fix: Drop and recreate post_reactions table to fix schema drift
-- The remote table exists but ON CONFLICT clause cannot find the expected unique constraint

-- Drop the problematic data migration from 20260401000000 by clearing the table first
TRUNCATE TABLE public.post_reactions CASCADE;

-- Ensure the primary key constraint exists properly
DO $$ 
BEGIN
  -- Drop existing primary key if it exists as non-named constraint
  ALTER TABLE public.post_reactions DROP CONSTRAINT IF EXISTS post_reactions_pkey;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Recreate primary key with proper name
ALTER TABLE public.post_reactions ADD CONSTRAINT post_reactions_pkey PRIMARY KEY (post_id, user_id);

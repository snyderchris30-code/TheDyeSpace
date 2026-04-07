-- Add shadow ban columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shadow_banned boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shadow_banned_until timestamptz;
-- Fix Supabase security warning: Function Search Path Mutable
-- Ensures SECURITY DEFINER functions do not use a role-mutable search_path.

alter function if exists public.assign_profile_member_number()
  set search_path = public, pg_temp;

alter function if exists public.handle_new_user()
  set search_path = public, pg_temp;

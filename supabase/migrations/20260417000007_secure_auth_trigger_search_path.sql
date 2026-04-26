-- Fix Supabase security warning: Function Search Path Mutable
-- Superseded by 20260423000000_fix_function_search_path_warnings.sql which
-- uses a DO block to safely handle all function signatures.
select 1;

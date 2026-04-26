-- Fix Supabase warning: Function Search Path Mutable
-- Applies to every signature of the named functions in the public schema.

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'assign_profile_member_number'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end;
$$;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'handle_new_user'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end;
$$;

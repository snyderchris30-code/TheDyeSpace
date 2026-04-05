-- Enable realtime for the profiles table so the user count widget
-- updates instantly when a new user joins (requires Supabase Realtime
-- to be enabled for this project in the Supabase dashboard).

alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

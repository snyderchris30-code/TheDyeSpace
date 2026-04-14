-- Secure is_admin function by adding set search_path
-- This function checks if a user is an admin based on their profile role

create or replace function public.is_admin(_uid uuid default null)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = _uid
      and profiles.role = 'admin'
  );
$$;

-- Fix search_path security issue on can_access_private_room function
-- Set explicit search_path to prevent privilege escalation

create or replace function public.can_access_private_room(room_name text, profile_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = profile_user_id
      and (
        profiles.role = 'admin'
        or (room_name = 'psychonautics' and profiles.psychonautics_access = true)
        or (room_name = 'admin_room' and profiles.admin_room_access = true)
      )
  );
$$;

-- Fix search_path security issue on cleanup_expired_room_posts function
-- Set explicit search_path to prevent privilege escalation

create or replace function public.cleanup_expired_room_posts()
returns bigint
language plpgsql
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.room_posts
  where expires_at <= timezone('utc', now());

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

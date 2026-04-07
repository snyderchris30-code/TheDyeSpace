create or replace function public.assign_profile_member_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.member_number is null then
    new.member_number := nextval('public.profile_member_number_seq');
  end if;
  return new;
end;
$$;

drop policy if exists "Anyone can insert suggestions" on public.suggestions;
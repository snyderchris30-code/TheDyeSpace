alter table public.profiles
  add column if not exists member_number integer;

create sequence if not exists public.profile_member_number_seq;

-- Clear member numbers for ignored profiles so we can rebuild real member numbering cleanly.
update public.profiles
set member_number = null
where role = 'test'
  or shadow_banned = true
  or (shadow_banned_until is not null and shadow_banned_until > now())
  or (voided_until is not null and voided_until > now());

with ordered_profiles as (
  select id, row_number() over (order by created_at asc, id asc) as next_member_number
  from public.profiles
  where coalesce(role, '') <> 'test'
    and shadow_banned = false
    and (shadow_banned_until is null or shadow_banned_until <= now())
    and (voided_until is null or voided_until <= now())
)
update public.profiles as profiles
set member_number = ordered_profiles.next_member_number
from ordered_profiles
where profiles.id = ordered_profiles.id;

select setval(
  'public.profile_member_number_seq',
  coalesce((select max(member_number) from public.profiles), 0),
  true
);

create or replace function public.assign_profile_member_number()
returns trigger
language plpgsql
as $$
begin
  if new.member_number is null
     and coalesce(new.role, '') <> 'test'
     and new.shadow_banned <> true
     and (new.shadow_banned_until is null or new.shadow_banned_until <= now())
     and (new.voided_until is null or new.voided_until <= now())
  then
    new.member_number := nextval('public.profile_member_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_profile_member_number_trigger on public.profiles;

create trigger assign_profile_member_number_trigger
before insert or update on public.profiles
for each row
execute function public.assign_profile_member_number();

create unique index if not exists profiles_member_number_key
  on public.profiles (member_number);

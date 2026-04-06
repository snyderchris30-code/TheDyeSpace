alter table public.profiles
  add column if not exists verified_badge boolean not null default false,
  add column if not exists member_number integer;

create sequence if not exists public.profile_member_number_seq;

with ordered_profiles as (
  select id, row_number() over (order by created_at asc, id asc) as next_member_number
  from public.profiles
)
update public.profiles as profiles
set member_number = ordered_profiles.next_member_number
from ordered_profiles
where profiles.id = ordered_profiles.id
  and profiles.member_number is null;

select setval(
  'public.profile_member_number_seq',
  greatest(coalesce((select max(member_number) from public.profiles), 0), 1),
  true
);

create or replace function public.assign_profile_member_number()
returns trigger
language plpgsql
as $$
begin
  if new.member_number is null then
    new.member_number := nextval('public.profile_member_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_profile_member_number_trigger on public.profiles;

create trigger assign_profile_member_number_trigger
before insert on public.profiles
for each row
execute function public.assign_profile_member_number();

create unique index if not exists profiles_member_number_key
  on public.profiles (member_number);
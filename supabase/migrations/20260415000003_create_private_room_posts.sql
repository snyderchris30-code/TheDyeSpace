alter table public.profiles add column if not exists psychonautics_access boolean not null default false;
alter table public.profiles add column if not exists admin_room_access boolean not null default false;

create table if not exists public.room_posts (
  id uuid primary key default gen_random_uuid(),
  room text not null check (room in ('psychonautics', 'admin_room')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  image_bucket text,
  image_path text,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '16 hours'),
  constraint room_posts_payload_check check (
    coalesce(length(btrim(content)), 0) > 0 or image_path is not null
  )
);

create index if not exists room_posts_room_created_at_idx on public.room_posts (room, created_at desc);
create index if not exists room_posts_expires_at_idx on public.room_posts (expires_at);

create or replace function public.can_access_private_room(room_name text, profile_user_id uuid)
returns boolean
language sql
stable
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

alter table public.room_posts enable row level security;

drop policy if exists "Authorized users can read private room posts" on public.room_posts;
create policy "Authorized users can read private room posts"
on public.room_posts
for select
to authenticated
using (
  expires_at > timezone('utc', now())
  and public.can_access_private_room(room, auth.uid())
);

drop policy if exists "Authorized users can insert private room posts" on public.room_posts;
create policy "Authorized users can insert private room posts"
on public.room_posts
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.can_access_private_room(room, auth.uid())
);

drop policy if exists "Authors and admins can delete private room posts" on public.room_posts;
create policy "Authors and admins can delete private room posts"
on public.room_posts
for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'
  )
);

create or replace function public.cleanup_expired_room_posts()
returns bigint
language plpgsql
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

do $$
declare
  has_cron boolean := false;
  existing_job record;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into has_cron;

  if not has_cron then
    raise notice 'Private room post cleanup was not scheduled because pg_cron is unavailable in this environment.';
    return;
  end if;

  for existing_job in
    select jobid
    from cron.job
    where jobname = 'cleanup-expired-room-posts'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'cleanup-expired-room-posts',
    '* * * * *',
    $cron$select public.cleanup_expired_room_posts();$cron$
  );
exception
  when undefined_table then
    raise notice 'Private room cleanup schedule skipped because cron.job is unavailable.';
  when others then
    raise notice 'Private room cleanup schedule skipped: %', sqlerrm;
end;
$$;
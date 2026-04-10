alter table if exists public.notifications
  add column if not exists post_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_post_id_fkey'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_post_id_fkey
      foreign key (post_id)
      references public.posts(id)
      on delete cascade;
  end if;
end
$$;

create index if not exists notifications_post_idx
  on public.notifications (post_id);

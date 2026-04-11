DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'post_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN post_id uuid;
  END IF;
END$$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'notifications_post_idx'
      AND n.nspname = 'public'
  ) THEN
    CREATE INDEX notifications_post_idx ON public.notifications (post_id);
  END IF;
END$$;

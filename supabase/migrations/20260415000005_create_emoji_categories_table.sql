DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'emoji_categories'
  ) THEN
    CREATE TABLE public.emoji_categories (
      id uuid not null primary key,
      name text not null,
      sort_order int not null default 0,
      emoji_ids jsonb not null default '[]'::jsonb
    );

  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'emoji_categories_sort_order_idx'
      AND n.nspname = 'public'
  ) THEN

    CREATE INDEX emoji_categories_sort_order_idx ON public.emoji_categories (sort_order);
  END IF;
END$$;
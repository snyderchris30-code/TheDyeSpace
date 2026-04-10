create table if not exists public.emoji_categories (
  id uuid not null primary key,
  name text not null,
  sort_order int not null default 0,
  emoji_ids jsonb not null default '[]'::jsonb
);

create index if not exists emoji_categories_sort_order_idx
  on public.emoji_categories (sort_order);

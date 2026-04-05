alter table public.profiles
  add column if not exists muted_until timestamptz null,
  add column if not exists voided_until timestamptz null,
  add column if not exists blessed_until timestamptz null;

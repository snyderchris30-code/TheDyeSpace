-- Add storage bucket policies for public read and authenticated owner uploads.
-- This file is intentionally idempotent: existing policies are dropped before recreation.

alter table if exists storage.objects enable row level security;

-- Avatars

drop policy if exists "Public read access to avatars" on storage.objects;
create policy "Public read access to avatars"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "Authenticated upload to avatars" on storage.objects;
create policy "Authenticated upload to avatars"
  on storage.objects
  for insert
  with check (bucket_id = 'avatars' and owner = auth.uid());

drop policy if exists "Authenticated update own avatars" on storage.objects;
create policy "Authenticated update own avatars"
  on storage.objects
  for update
  using (bucket_id = 'avatars' and owner = auth.uid())
  with check (bucket_id = 'avatars' and owner = auth.uid());

drop policy if exists "Authenticated delete own avatars" on storage.objects;
create policy "Authenticated delete own avatars"
  on storage.objects
  for delete
  using (bucket_id = 'avatars' and owner = auth.uid());

-- Banners

drop policy if exists "Public read access to banners" on storage.objects;
create policy "Public read access to banners"
  on storage.objects
  for select
  using (bucket_id = 'banners');

drop policy if exists "Authenticated upload to banners" on storage.objects;
create policy "Authenticated upload to banners"
  on storage.objects
  for insert
  with check (bucket_id = 'banners' and owner = auth.uid());

drop policy if exists "Authenticated update own banners" on storage.objects;
create policy "Authenticated update own banners"
  on storage.objects
  for update
  using (bucket_id = 'banners' and owner = auth.uid())
  with check (bucket_id = 'banners' and owner = auth.uid());

drop policy if exists "Authenticated delete own banners" on storage.objects;
create policy "Authenticated delete own banners"
  on storage.objects
  for delete
  using (bucket_id = 'banners' and owner = auth.uid());

-- Posts / general images

drop policy if exists "Public read access to posts" on storage.objects;
create policy "Public read access to posts"
  on storage.objects
  for select
  using (bucket_id = 'posts');

drop policy if exists "Authenticated upload to posts" on storage.objects;
create policy "Authenticated upload to posts"
  on storage.objects
  for insert
  with check (bucket_id = 'posts' and owner = auth.uid());

drop policy if exists "Authenticated update own posts" on storage.objects;
create policy "Authenticated update own posts"
  on storage.objects
  for update
  using (bucket_id = 'posts' and owner = auth.uid())
  with check (bucket_id = 'posts' and owner = auth.uid());

drop policy if exists "Authenticated delete own posts" on storage.objects;
create policy "Authenticated delete own posts"
  on storage.objects
  for delete
  using (bucket_id = 'posts' and owner = auth.uid());

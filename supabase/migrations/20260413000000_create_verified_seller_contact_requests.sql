create table if not exists public.verified_seller_contact_requests (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references public.profiles(id) on delete cascade,
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz null,
  constraint verified_seller_contact_requests_unique_pair unique (seller_user_id, requester_user_id),
  constraint verified_seller_contact_requests_no_self check (seller_user_id <> requester_user_id)
);

create index if not exists verified_seller_contact_requests_seller_idx
  on public.verified_seller_contact_requests (seller_user_id, status, created_at desc);

create index if not exists verified_seller_contact_requests_requester_idx
  on public.verified_seller_contact_requests (requester_user_id, created_at desc);

alter table public.verified_seller_contact_requests enable row level security;

create policy "seller reads own contact requests"
  on public.verified_seller_contact_requests
  for select
  to authenticated
  using (auth.uid() = seller_user_id or auth.uid() = requester_user_id);

create policy "requester inserts own contact requests"
  on public.verified_seller_contact_requests
  for insert
  to authenticated
  with check (auth.uid() = requester_user_id);

create policy "seller updates own contact requests"
  on public.verified_seller_contact_requests
  for update
  to authenticated
  using (auth.uid() = seller_user_id)
  with check (auth.uid() = seller_user_id);
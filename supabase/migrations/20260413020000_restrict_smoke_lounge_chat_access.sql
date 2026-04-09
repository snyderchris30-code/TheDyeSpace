alter table public.chat_messages enable row level security;

drop policy if exists "Public can read global chat messages" on public.chat_messages;
create policy "Public can read global chat messages"
on public.chat_messages
for select
using (coalesce(room, 'smoke_room') = 'smoke_room');

drop policy if exists "Verified sellers can read smoke lounge messages" on public.chat_messages;
create policy "Verified sellers can read smoke lounge messages"
on public.chat_messages
for select
to authenticated
using (
  room = 'smoke_room_2'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or (profiles.verified_badge = true and profiles.smoke_room_2_invited = true)
      )
  )
);

drop policy if exists "Authenticated users can post to global chat" on public.chat_messages;
create policy "Authenticated users can post to global chat"
on public.chat_messages
for insert
to authenticated
with check (
  auth.uid() = user_id
  and coalesce(room, 'smoke_room') = 'smoke_room'
);

drop policy if exists "Verified sellers can post to smoke lounge" on public.chat_messages;
create policy "Verified sellers can post to smoke lounge"
on public.chat_messages
for insert
to authenticated
with check (
  auth.uid() = user_id
  and room = 'smoke_room_2'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or (profiles.verified_badge = true and profiles.smoke_room_2_invited = true)
      )
  )
);

drop policy if exists "Users can update own global chat messages" on public.chat_messages;
create policy "Users can update own global chat messages"
on public.chat_messages
for update
to authenticated
using (
  auth.uid() = user_id
  and coalesce(room, 'smoke_room') = 'smoke_room'
)
with check (
  auth.uid() = user_id
  and coalesce(room, 'smoke_room') = 'smoke_room'
);

drop policy if exists "Verified sellers can update own smoke lounge messages" on public.chat_messages;
create policy "Verified sellers can update own smoke lounge messages"
on public.chat_messages
for update
to authenticated
using (
  auth.uid() = user_id
  and room = 'smoke_room_2'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or (profiles.verified_badge = true and profiles.smoke_room_2_invited = true)
      )
  )
)
with check (
  auth.uid() = user_id
  and room = 'smoke_room_2'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or (profiles.verified_badge = true and profiles.smoke_room_2_invited = true)
      )
  )
);

drop policy if exists "Users can delete own global chat messages" on public.chat_messages;
create policy "Users can delete own global chat messages"
on public.chat_messages
for delete
to authenticated
using (
  auth.uid() = user_id
  and coalesce(room, 'smoke_room') = 'smoke_room'
);

drop policy if exists "Verified sellers can delete own smoke lounge messages" on public.chat_messages;
create policy "Verified sellers can delete own smoke lounge messages"
on public.chat_messages
for delete
to authenticated
using (
  auth.uid() = user_id
  and room = 'smoke_room_2'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or (profiles.verified_badge = true and profiles.smoke_room_2_invited = true)
      )
  )
);
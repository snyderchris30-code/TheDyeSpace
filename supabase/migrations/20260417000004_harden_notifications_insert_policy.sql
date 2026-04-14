-- Replace overly permissive notifications INSERT RLS policy.
-- This policy enforces that authenticated users can only insert their own rows.

drop policy if exists notifications_insert on public.notifications;
drop policy if exists "Users can insert own notifications" on public.notifications;

create policy "Users can insert own notifications"
  on public.notifications for insert
  to authenticated
  with check (auth.uid() = user_id);

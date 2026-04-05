-- Hablawithflow booking payment and cancellation setup
-- Apply this in Supabase SQL Editor if student cancel or teacher mark-paid actions
-- fail with a permissions error.

alter table public.bookings
alter column status set default 'pending_payment';

alter table public.bookings
add column if not exists paid_at timestamptz;

update public.bookings
set status = 'confirmed_paid'
where coalesce(status, '') in ('confirmed', 'paid', 'confirmed_paid');

update public.bookings
set status = 'cancelled_paid'
where coalesce(status, '') in ('cancelled', 'canceled', 'cancelled_paid', 'canceled_paid');

update public.bookings
set status = 'pending_payment'
where coalesce(status, '') in ('', 'pending', 'awaiting_payment', 'awaiting payment', 'unpaid', 'pending_payment');

alter table public.bookings enable row level security;

drop policy if exists "Students read their own bookings" on public.bookings;
create policy "Students read their own bookings"
on public.bookings
for select
using (auth.uid() = student_id);

drop policy if exists "Students insert their own bookings" on public.bookings;
create policy "Students insert their own bookings"
on public.bookings
for insert
with check (
  auth.uid() = student_id
  and status in ('pending_payment', 'confirmed_paid')
);

drop policy if exists "Teachers and admins read bookings" on public.bookings;
create policy "Teachers and admins read bookings"
on public.bookings
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('teacher', 'admin')
  )
);

drop policy if exists "Students update their own bookings" on public.bookings;
create policy "Students update their own bookings"
on public.bookings
for update
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

drop policy if exists "Teachers and admins update bookings" on public.bookings;
create policy "Teachers and admins update bookings"
on public.bookings
for update
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('teacher', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('teacher', 'admin')
  )
);

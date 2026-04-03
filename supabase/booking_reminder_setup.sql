-- Hablawithflow booking reminder setup
-- Run this in Supabase SQL Editor before enabling the reminder worker.

alter table public.bookings
add column if not exists reminder_sent_at timestamptz;

create index if not exists bookings_reminder_pending_idx
on public.bookings (lesson_date, lesson_time)
where reminder_sent_at is null;

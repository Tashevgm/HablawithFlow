-- Role-based teacher access setup for Hablawithflow
-- Run this in Supabase SQL Editor.

-- 1) Add role column to profiles and enforce valid values.
alter table public.profiles
add column if not exists role text not null default 'student';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_role_check
    check (role in ('student', 'teacher', 'admin'));
  end if;
end $$;

-- 2) Create teacher-specific profile table.
create table if not exists public.teacher_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  bio text,
  hourly_rate numeric(10, 2),
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Keep updated_at fresh on teacher profile updates.
create or replace function public.set_teacher_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teacher_profiles_set_updated_at on public.teacher_profiles;
create trigger teacher_profiles_set_updated_at
before update on public.teacher_profiles
for each row
execute procedure public.set_teacher_profiles_updated_at();

-- 4) Enable RLS and minimal policies.
alter table public.teacher_profiles enable row level security;

drop policy if exists "teacher_profiles_select_own" on public.teacher_profiles;
create policy "teacher_profiles_select_own"
on public.teacher_profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "teacher_profiles_update_own" on public.teacher_profiles;
create policy "teacher_profiles_update_own"
on public.teacher_profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "teacher_profiles_insert_own" on public.teacher_profiles;
create policy "teacher_profiles_insert_own"
on public.teacher_profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

-- 5) Mark a known teacher account as teacher when it exists.
update public.profiles p
set role = 'teacher',
    updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = 'vtsagov@gmail.com';

-- 6) Optional verification query.
select
  u.email,
  p.role
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = 'vtsagov@gmail.com';

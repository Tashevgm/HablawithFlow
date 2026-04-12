-- Teacher portal student personalization context
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.student_personalization_profiles (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  student_id uuid references auth.users(id) on delete set null,
  learning_goal text,
  occupation text,
  hobbies text,
  interests text,
  personality_notes text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_personalization_profiles_email_key
on public.student_personalization_profiles (lower(student_email));

create or replace function public.set_student_personalization_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists student_personalization_profiles_set_updated_at on public.student_personalization_profiles;
create trigger student_personalization_profiles_set_updated_at
before update on public.student_personalization_profiles
for each row
execute procedure public.set_student_personalization_profiles_updated_at();

alter table public.student_personalization_profiles enable row level security;

drop policy if exists "Teachers manage student personalization profiles" on public.student_personalization_profiles;
create policy "Teachers manage student personalization profiles"
on public.student_personalization_profiles
for all
to authenticated
using (public.is_teacher_or_admin())
with check (public.is_teacher_or_admin());

drop policy if exists "Students view own personalization profile" on public.student_personalization_profiles;
create policy "Students view own personalization profile"
on public.student_personalization_profiles
for select
to authenticated
using (lower(student_email) = public.current_user_email());

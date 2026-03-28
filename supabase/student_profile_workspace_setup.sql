-- Student profile workspace for teachers
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

create or replace function public.is_teacher_or_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('teacher', 'admin')
  );
$$;

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create table if not exists public.student_learning_plans (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  plan_title text,
  long_term_goal text,
  weekly_focus text,
  objectives text[] not null default '{}',
  teacher_notes text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_learning_plans_email_key
on public.student_learning_plans (lower(student_email));

create table if not exists public.student_lesson_logs (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  lesson_date date not null,
  topic text not null,
  duration_minutes integer,
  outcome text,
  homework text,
  teacher_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_lesson_logs_email_date_idx
on public.student_lesson_logs (lower(student_email), lesson_date desc, created_at desc);

create table if not exists public.student_homework_files (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  title text not null,
  notes text,
  file_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_homework_files_email_created_idx
on public.student_homework_files (lower(student_email), created_at desc);

create or replace function public.set_student_profile_workspace_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists student_learning_plans_set_updated_at on public.student_learning_plans;
create trigger student_learning_plans_set_updated_at
before update on public.student_learning_plans
for each row
execute procedure public.set_student_profile_workspace_updated_at();

alter table public.student_learning_plans enable row level security;
alter table public.student_lesson_logs enable row level security;
alter table public.student_homework_files enable row level security;

drop policy if exists "Teachers manage student learning plans" on public.student_learning_plans;
create policy "Teachers manage student learning plans"
on public.student_learning_plans
for all
to authenticated
using (public.is_teacher_or_admin())
with check (public.is_teacher_or_admin());

drop policy if exists "Students view own learning plan" on public.student_learning_plans;
create policy "Students view own learning plan"
on public.student_learning_plans
for select
to authenticated
using (lower(student_email) = public.current_user_email());

drop policy if exists "Teachers manage lesson logs" on public.student_lesson_logs;
create policy "Teachers manage lesson logs"
on public.student_lesson_logs
for all
to authenticated
using (public.is_teacher_or_admin())
with check (public.is_teacher_or_admin());

drop policy if exists "Students view own lesson logs" on public.student_lesson_logs;
create policy "Students view own lesson logs"
on public.student_lesson_logs
for select
to authenticated
using (lower(student_email) = public.current_user_email());

drop policy if exists "Teachers manage homework records" on public.student_homework_files;
create policy "Teachers manage homework records"
on public.student_homework_files
for all
to authenticated
using (public.is_teacher_or_admin())
with check (public.is_teacher_or_admin());

drop policy if exists "Students view own homework records" on public.student_homework_files;
create policy "Students view own homework records"
on public.student_homework_files
for select
to authenticated
using (lower(student_email) = public.current_user_email());

insert into storage.buckets (id, name, public)
values ('student-homework', 'student-homework', false)
on conflict (id) do nothing;

drop policy if exists "Teachers manage student homework objects" on storage.objects;
create policy "Teachers manage student homework objects"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'student-homework'
  and public.is_teacher_or_admin()
)
with check (
  bucket_id = 'student-homework'
  and public.is_teacher_or_admin()
);

drop policy if exists "Students read student homework objects" on storage.objects;
create policy "Students read student homework objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-homework'
  and lower(split_part(name, '/', 1)) = public.current_user_email()
);

-- Community profile setup for Hablawithflow
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.community_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  headline text,
  bio text,
  location text,
  languages text[] not null default '{}',
  avatar_url text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_community_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists community_profiles_set_updated_at on public.community_profiles;
create trigger community_profiles_set_updated_at
before update on public.community_profiles
for each row
execute procedure public.set_community_profiles_updated_at();

alter table public.community_profiles enable row level security;

drop policy if exists "Community profiles are visible" on public.community_profiles;
create policy "Community profiles are visible"
on public.community_profiles
for select
to authenticated
using (is_public = true or id = auth.uid());

drop policy if exists "Users insert own community profile" on public.community_profiles;
create policy "Users insert own community profile"
on public.community_profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users update own community profile" on public.community_profiles;
create policy "Users update own community profile"
on public.community_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Users delete own community profile" on public.community_profiles;
create policy "Users delete own community profile"
on public.community_profiles
for delete
to authenticated
using (id = auth.uid());

insert into storage.buckets (id, name, public)
values ('community-avatars', 'community-avatars', true)
on conflict (id) do nothing;

drop policy if exists "Users upload own community avatar" on storage.objects;
create policy "Users upload own community avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'community-avatars'
  and lower(split_part(name, '/', 1)) = auth.uid()::text
);

drop policy if exists "Users update own community avatar" on storage.objects;
create policy "Users update own community avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'community-avatars'
  and lower(split_part(name, '/', 1)) = auth.uid()::text
)
with check (
  bucket_id = 'community-avatars'
  and lower(split_part(name, '/', 1)) = auth.uid()::text
);

drop policy if exists "Users delete own community avatar" on storage.objects;
create policy "Users delete own community avatar"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'community-avatars'
  and lower(split_part(name, '/', 1)) = auth.uid()::text
);

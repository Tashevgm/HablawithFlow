-- Hablawithflow Messaging System Setup
-- Creates tables for student-teacher direct messaging with real-time support
-- Apply this in Supabase SQL Editor to set up the messaging system

-- 1. Create conversations table
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null,
  lesson_id uuid,
  subject text,
  last_message_at timestamptz,
  student_archived boolean default false,
  teacher_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(student_id, teacher_id)
);

-- 2. Create messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  sender_type text not null check (sender_type in ('student', 'teacher')),
  body text not null,
  created_at timestamptz default now(),
  deleted_at timestamptz,
  updated_at timestamptz default now()
);

-- 3. Create message_read_status table
create table if not exists public.message_read_status (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reader_id uuid not null references auth.users(id),
  read_at timestamptz,
  created_at timestamptz default now(),
  unique(message_id, reader_id)
);

-- 4. Create indexes for performance
create index if not exists idx_conversations_student_id on public.conversations(student_id);
create index if not exists idx_conversations_teacher_id on public.conversations(teacher_id);
create index if not exists idx_conversations_created_at on public.conversations(created_at desc);

create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_messages_created_at on public.messages(created_at desc);

create index if not exists idx_message_read_status_message_id on public.message_read_status(message_id);
create index if not exists idx_message_read_status_reader_id on public.message_read_status(reader_id);

-- 5. Enable Row Level Security
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_read_status enable row level security;

-- 6. Conversations policies
drop policy if exists "Students can see their conversations" on public.conversations;
create policy "Students can see their conversations"
on public.conversations for select
using (auth.uid() = student_id);

drop policy if exists "Teachers can see their conversations" on public.conversations;
create policy "Teachers can see their conversations"
on public.conversations for select
using (auth.uid() = teacher_id);

drop policy if exists "Students can create conversations" on public.conversations;
create policy "Students can create conversations"
on public.conversations for insert
with check (auth.uid() = student_id);

drop policy if exists "Students can update their conversations" on public.conversations;
create policy "Students can update their conversations"
on public.conversations for update
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

drop policy if exists "Teachers can update their conversations" on public.conversations;
create policy "Teachers can update their conversations"
on public.conversations for update
using (auth.uid() = teacher_id)
with check (auth.uid() = teacher_id);

-- 7. Messages policies
drop policy if exists "Users can see messages in their conversations" on public.messages;
create policy "Users can see messages in their conversations"
on public.messages for select
using (
  exists (
    select 1 from public.conversations
    where conversations.id = messages.conversation_id
    and (conversations.student_id = auth.uid() or conversations.teacher_id = auth.uid())
  )
);

drop policy if exists "Users can insert messages to their conversations" on public.messages;
create policy "Users can insert messages to their conversations"
on public.messages for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations
    where conversations.id = messages.conversation_id
    and (conversations.student_id = auth.uid() or conversations.teacher_id = auth.uid())
  )
);

drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Users can delete their own messages"
on public.messages for update
using (auth.uid() = sender_id)
with check (auth.uid() = sender_id);

-- 8. Message read status policies
drop policy if exists "Users can see read status for their messages" on public.message_read_status;
create policy "Users can see read status for their messages"
on public.message_read_status for select
using (
  reader_id = auth.uid()
  or exists (
    select 1 from public.messages
    where messages.id = message_read_status.message_id
    and messages.sender_id = auth.uid()
  )
);

drop policy if exists "Users can mark messages as read" on public.message_read_status;
create policy "Users can mark messages as read"
on public.message_read_status for insert
with check (reader_id = auth.uid());

-- 9. Enable realtime for messaging tables
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_read_status;

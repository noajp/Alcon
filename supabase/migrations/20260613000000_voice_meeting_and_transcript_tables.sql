-- Voice meeting minutes + live transcript lines for Room voice channels.
--
-- Backs the "video meeting + live captions + rolling/final minutes" feature.
-- These tables were originally created straight on the hosted project
-- (PRs #77/#78) without a committed migration, so a fresh `db reset` /
-- preview branch never had them and an ALTER referencing them failed with
-- 42P01. This file captures the full schema so any environment provisions
-- it correctly. Everything is written to be idempotent
-- (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / guarded publication add)
-- so it is a safe no-op where the tables already exist.

-- ── voice_meeting_minutes — one continuous "call" per row ────────────
create table if not exists public.voice_meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  markdown text not null default '',
  final_markdown text,
  last_summarized_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Covers environments that already had the table from before final_markdown.
alter table public.voice_meeting_minutes
  add column if not exists final_markdown text;
comment on column public.voice_meeting_minutes.final_markdown is
  'Comprehensive final minutes generated once when the session ends (distinct from the rolling `markdown` draft updated every few minutes).';

-- At most one open session per channel; fast "latest session for channel".
create unique index if not exists idx_voice_meeting_minutes_active_per_channel
  on public.voice_meeting_minutes (channel_id) where (ended_at is null);
create index if not exists idx_voice_meeting_minutes_channel
  on public.voice_meeting_minutes (channel_id, started_at desc);

-- Touch updated_at on every UPDATE.
create or replace function public.touch_voice_meeting_minutes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_voice_meeting_minutes_updated_at on public.voice_meeting_minutes;
create trigger trg_voice_meeting_minutes_updated_at
  before update on public.voice_meeting_minutes
  for each row execute function public.touch_voice_meeting_minutes_updated_at();

-- ── voice_transcript_lines — one finalized phrase per row ────────────
create table if not exists public.voice_transcript_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voice_meeting_minutes(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  speaker_id uuid references auth.users(id) on delete set null,
  speaker_name text not null,
  text text not null,
  spoken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_voice_transcript_lines_session_spoken
  on public.voice_transcript_lines (session_id, spoken_at);

-- ── RLS — only the room owner (channel → room.created_by) ────────────
alter table public.voice_meeting_minutes enable row level security;
alter table public.voice_transcript_lines enable row level security;

drop policy if exists voice_meeting_minutes_select on public.voice_meeting_minutes;
create policy voice_meeting_minutes_select on public.voice_meeting_minutes
  for select using (
    exists (
      select 1 from public.channels c
      join public.rooms r on r.id = c.room_id
      where c.id = channel_id and r.created_by = auth.uid()
    )
  );

drop policy if exists voice_meeting_minutes_insert on public.voice_meeting_minutes;
create policy voice_meeting_minutes_insert on public.voice_meeting_minutes
  for insert with check (
    exists (
      select 1 from public.channels c
      join public.rooms r on r.id = c.room_id
      where c.id = channel_id and r.created_by = auth.uid()
    )
  );

drop policy if exists voice_meeting_minutes_update on public.voice_meeting_minutes;
create policy voice_meeting_minutes_update on public.voice_meeting_minutes
  for update using (
    exists (
      select 1 from public.channels c
      join public.rooms r on r.id = c.room_id
      where c.id = channel_id and r.created_by = auth.uid()
    )
  );

drop policy if exists voice_transcript_lines_select on public.voice_transcript_lines;
create policy voice_transcript_lines_select on public.voice_transcript_lines
  for select using (
    exists (
      select 1 from public.channels c
      join public.rooms r on r.id = c.room_id
      where c.id = channel_id and r.created_by = auth.uid()
    )
  );

drop policy if exists voice_transcript_lines_insert on public.voice_transcript_lines;
create policy voice_transcript_lines_insert on public.voice_transcript_lines
  for insert with check (
    speaker_id = auth.uid() and exists (
      select 1 from public.channels c
      join public.rooms r on r.id = c.room_id
      where c.id = channel_id and r.created_by = auth.uid()
    )
  );

-- ── Realtime — minutes-row updates + each new transcript line ────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'voice_meeting_minutes'
  ) then
    alter publication supabase_realtime add table public.voice_meeting_minutes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'voice_transcript_lines'
  ) then
    alter publication supabase_realtime add table public.voice_transcript_lines;
  end if;
end $$;

-- The AI's conversations, kept: each person's own, in the Space they were
-- had in, in two layers.
--
--   ai_folders   a person's folders of conversations in one Space
--   ai_sessions  one conversation: its title, its folder (none for loose
--                ones) and its messages as the panel shows them
--
-- Both are private to their author: nobody else, the Space's owner included,
-- reads another person's conversations. A person who leaves the Space stops
-- seeing them too.
-- Guarded for preview replay: the Space membership check may be absent.
do $$
begin
  if to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'ai_conversations skipped: is_activity_space_member not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.ai_folders (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null,
      user_id uuid not null default auth.uid(),
      name text not null check (char_length(name) between 1 and 200),
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists ai_folders_owner on public.ai_folders (user_id, activity_space_id)';
  execute 'alter table public.ai_folders enable row level security';
  execute 'drop policy if exists ai_folders_own on public.ai_folders';
  execute $p$
    create policy ai_folders_own on public.ai_folders for all to authenticated
      using (user_id = auth.uid() and public.is_activity_space_member(activity_space_id))
      with check (user_id = auth.uid() and public.is_activity_space_member(activity_space_id))
  $p$;

  execute $ddl$
    create table if not exists public.ai_sessions (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null,
      user_id uuid not null default auth.uid(),
      folder_id uuid references public.ai_folders(id) on delete cascade,
      title text not null default '' check (char_length(title) <= 200),
      messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists ai_sessions_owner on public.ai_sessions (user_id, activity_space_id, updated_at desc)';
  execute 'alter table public.ai_sessions enable row level security';
  execute 'drop policy if exists ai_sessions_own on public.ai_sessions';
  -- A conversation goes only into its author's own folder in the same Space.
  execute $p$
    create policy ai_sessions_own on public.ai_sessions for all to authenticated
      using (user_id = auth.uid() and public.is_activity_space_member(activity_space_id))
      with check (
        user_id = auth.uid() and public.is_activity_space_member(activity_space_id)
        and (folder_id is null or exists (
          select 1 from public.ai_folders f
          where f.id = folder_id and f.user_id = auth.uid() and f.activity_space_id = ai_sessions.activity_space_id))
      )
  $p$;
end $$;

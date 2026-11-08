-- A Copilot conversation may live outside any Space: the profile
-- screen's chat is the person's own, with no Space to belong to, and
-- the engine unification puts it on a run like every other conversation
-- — which takes a session row to be the run's subject. So a session's
-- Space becomes optional:
--
--   ai_sessions   activity_space_id drops its NOT NULL; the ownership
--                 policy gains a "no Space" branch — the author's alone,
--                 exactly as a Space session is, minus the membership.
--                 Folders stay Space-bound, so a personal session is
--                 always loose (the folder check compares Spaces, and
--                 a null Space matches no folder).
--   agent_runs    the one-open-run-per-session index learns
--                 'awaiting_input', the chat driver's word for a run
--                 waiting for the next message: a session's run resting
--                 that way is still its one open run.
--
-- A personal run stamps no Space (the stamp's session branch reads the
-- session's Space, which is null) and is budgeted on its starter's own
-- monthly budget — the standing rule for runs outside a Space.
-- Guarded for preview replay: each part checks what it touches first.
do $$
begin
  if to_regclass('public.ai_sessions') is null then
    raise notice 'ai_sessions personal skipped: ai_sessions not present';
    return;
  end if;

  execute 'alter table public.ai_sessions alter column activity_space_id drop not null';

  if to_regprocedure('public.is_activity_space_member(uuid)') is not null then
    execute 'drop policy if exists ai_sessions_own on public.ai_sessions';
    -- A conversation goes only into its author's own folder in the same
    -- Space; a personal conversation has no Space and no folder.
    execute $p$
      create policy ai_sessions_own on public.ai_sessions for all to authenticated
        using (user_id = auth.uid() and (activity_space_id is null or public.is_activity_space_member(activity_space_id)))
        with check (
          user_id = auth.uid()
          and (activity_space_id is null or public.is_activity_space_member(activity_space_id))
          and (folder_id is null or exists (
            select 1 from public.ai_folders f
            where f.id = folder_id and f.user_id = auth.uid() and f.activity_space_id = ai_sessions.activity_space_id))
        )
    $p$;
  end if;

  if to_regclass('public.agent_runs') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'ai_session_id') then
    execute 'drop index if exists public.agent_runs_one_open_per_session';
    execute 'create unique index agent_runs_one_open_per_session on public.agent_runs (ai_session_id) where ai_session_id is not null and status in (''queued'', ''running'', ''awaiting_approval'', ''paused'', ''awaiting_input'')';
  end if;
end
$$;

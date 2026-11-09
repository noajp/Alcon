-- Deleting an AI conversation sets agent_runs.ai_session_id to null on its
-- runs (ON DELETE SET NULL). That update runs as the person deleting, and the
-- client guard on agent_runs refused every client update but a cancel — so a
-- conversation that had started a run could not be deleted at all. The guard
-- now lets through the one change that deletion makes: a run losing the link
-- to its conversation, with nothing else about it changing.
do $$
begin
  if to_regclass('public.agent_runs') is null then
    return;
  end if;

  create or replace function public.agent_runs_guard_client()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  as $fn$
  begin
    if coalesce(auth.role(), '') <> 'authenticated' then
      return new;
    end if;
    if tg_op = 'INSERT' and new.status <> 'queued' then
      raise exception 'a run starts queued' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      -- Its conversation was deleted: only the link to it goes.
      if new.ai_session_id is null and old.ai_session_id is not null
         and (to_jsonb(new) - 'ai_session_id') = (to_jsonb(old) - 'ai_session_id') then
        return new;
      end if;
      if (to_jsonb(new) - 'domain_id' - 'worker_id') = (to_jsonb(old) - 'domain_id' - 'worker_id')
         and (new.domain_id is null or new.domain_id is not distinct from old.domain_id)
         and (new.worker_id is null or new.worker_id is not distinct from old.worker_id)
         and (new.domain_id is distinct from old.domain_id or new.worker_id is distinct from old.worker_id) then
        return new;
      end if;
      if old.status not in ('queued', 'running', 'awaiting_approval', 'paused') or new.status <> 'cancelled' then
        raise exception 'a run can only be cancelled from the app, while it is open' using errcode = '42501';
      end if;
      if (to_jsonb(new) - 'status' - 'finished_at') is distinct from (to_jsonb(old) - 'status' - 'finished_at') then
        raise exception 'cancelling a run changes nothing but its status' using errcode = '42501';
      end if;
      if old.triggered_by is distinct from auth.uid() and not public.user_can_manage_approval(old.element_id) then
        raise exception 'only who started a run, or who manages its Element, can cancel it' using errcode = '42501';
      end if;
    end if;
    return new;
  end
  $fn$;
end $$;

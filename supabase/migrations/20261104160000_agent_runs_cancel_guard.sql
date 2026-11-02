-- A signed-in user may only cancel an open run (agent_runs_guard_client), but
-- the guard checked the status alone: the same update could rewrite the
-- transcript, result, cost or continuation token, and anyone who could work
-- on the Element could cancel anyone's run (ELE_OBJ-028). Now a cancel by a
-- signed-in user changes status and finished_at only, and is made by whoever
-- started the run or by someone who manages its Element (its Domain's owners
-- and admins, or its owner — user_can_manage_approval).
do $mig$
begin
  if to_regclass('public.agent_runs') is null
     or to_regprocedure('public.user_can_manage_approval(uuid)') is null then
    raise notice 'agent_runs_cancel_guard skipped: base schema not present'; return;
  end if;

  execute $f$
    create or replace function public.agent_runs_guard_client()
    returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
    begin
      if coalesce(auth.role(), '') <> 'authenticated' then
        return new;
      end if;
      if tg_op = 'INSERT' and new.status <> 'queued' then
        raise exception 'a run starts queued' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' then
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
    $b$
  $f$;
  execute 'revoke execute on function public.agent_runs_guard_client() from public, anon, authenticated';
end $mig$;

-- Deleting a Domain or a Worker sets agent_runs.domain_id / worker_id to null
-- (on delete set null). That update runs as the deleting user, and the
-- client guard refused it as "not a cancel", so the Domain or Worker could
-- not be deleted while a past run pointed at it. An update that only clears
-- those references is let through.
do $mig$
begin
  if to_regclass('public.agent_runs') is null
     or to_regprocedure('public.user_can_manage_approval(uuid)') is null then
    raise notice 'agent_runs_guard_fk_set_null skipped: base schema not present'; return;
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
        -- A referenced Domain or Worker being deleted (on delete set null).
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
    $b$
  $f$;
  execute 'revoke execute on function public.agent_runs_guard_client() from public, anon, authenticated';
end $mig$;

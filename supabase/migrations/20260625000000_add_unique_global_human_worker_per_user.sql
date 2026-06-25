-- A real (auth-linked) person should have at most one global human Worker row.
-- ensureSelfWorker() (web/src/hooks/useAuth.ts) and InviteUserDialog both do a
-- racy "select-then-insert", which let a duplicate slip in under concurrent
-- logins. This partial unique index is the backstop: competing inserts now fail
-- at the DB, and the app's fire-and-forget insert silently no-ops.
--
--   * user_id IS NOT NULL  -> manually-added members (name-only, no account) are exempt
--   * object_id IS NULL    -> any future object-scoped human worker is exempt
--   * type = 'human'       -> AI agents / robots are exempt
--
-- Guarded like the lead_id / agent_runs migrations: if public.workers isn't
-- present yet (a fresh preview branch replaying the migrations folder, where the
-- base schema lives outside the migrations history), this becomes a no-op
-- instead of erroring with 42P01 "relation public.workers does not exist".

do $$
begin
  if to_regclass('public.workers') is null then
    raise notice 'workers one-global-human index skipped: workers not present';
    return;
  end if;

  execute $ddl$
    create unique index if not exists workers_one_global_human_per_user
      on public.workers (user_id)
      where type = 'human' and user_id is not null and object_id is null
  $ddl$;
end
$$;

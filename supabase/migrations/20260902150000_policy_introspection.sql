-- A code review of 20260902140000 raised a serious, unverifiable-from-the-repo
-- question: does `strategy_children` still carry the wide-open policies its
-- table definition was created with (`strategy_children_select FOR SELECT
-- USING (true)`, `strategy_children_modify FOR ALL USING (auth.uid() IS NOT
-- NULL)`, per the historical `web/supabase/migrations/20260528_strategies_dag_
-- extend.sql`)? No migration in this folder has ever touched them — unlike
-- `strategies`/`strategy_objects`, which 20260830000007 explicitly closed.
--
-- If those two policies are still live, `strategy_children` is currently
-- readable and writable by any signed-in user regardless of what
-- 20260902140000 adds — a real, standing hole this session cannot see from
-- migration files alone, the same blind spot `20260901050000_trigger_
-- introspection.sql` hit for trigger definitions. Same fix, same reasoning:
-- PostgREST doesn't expose `pg_policies`, so there was no way to ask the
-- question directly. This is a third small, read-only, security-definer RPC
-- in that same family — not a new pattern.
--
-- Scoped to the same five tables `list_table_triggers`/`describe_function`
-- already cover, plus `strategy_children`/`strategy_objects`/`strategies`
-- (the tables this specific investigation needs). Widening the list is a
-- one-line change, same as the existing two RPCs.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database.

do $migration$
begin
  execute $fn$
    create or replace function public.list_table_policies(target_table text)
    returns table(
      policy_name text,
      cmd text,
      permissive text,
      roles text[],
      qual text,
      with_check text
    )
    language sql
    security definer
    set search_path = pg_catalog, public
    stable
    as $body$
      select
        pol.polname,
        case pol.polcmd
          when 'r' then 'select' when 'a' then 'insert'
          when 'w' then 'update' when 'd' then 'delete'
          else '*' end,
        case when pol.polpermissive then 'permissive' else 'restrictive' end,
        array(select rolname from pg_roles where oid = any(pol.polroles))::text[],
        pg_get_expr(pol.polqual, pol.polrelid),
        pg_get_expr(pol.polwithcheck, pol.polrelid)
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = target_table
        and target_table in (
          'objects', 'elements', 'subelements', 'workers', 'notifications',
          'strategies', 'strategy_objects', 'strategy_children'
        )
    $body$;
  $fn$;

  execute 'revoke all on function public.list_table_policies(text) from public';

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.list_table_policies(text) to authenticated';
  else
    raise notice 'list_table_policies grant skipped: role "authenticated" not present';
  end if;
end
$migration$;

-- One permissive policy per table and command.
--
-- Postgres ORs every permissive policy that applies to a command, and the
-- advisor flags tables where more than one applies (usually a FOR ALL
-- "_write" policy overlapping a "_select" one), since each is evaluated.
-- For every public table where that happens, this rebuilds its permissive
-- policies as one per command whose USING is the OR of the USINGs that
-- applied and whose WITH CHECK is the OR of the WITH CHECKs (a policy without
-- one checks with its USING, as Postgres does). A policy that was limited to
-- `authenticated` while others were open to `public` keeps that limit through
-- a role guard, so who can do what is unchanged. Restrictive policies are
-- left alone. Idempotent, and a no-op on an empty database.
do $$
declare
  t record;
  c text;
  using_expr text;
  check_expr text;
  all_auth boolean;
  roles_clause text;
  stmt text;
  p record;
begin
  for t in
    select distinct x.schemaname, x.tablename
    from (
      select schemaname, tablename,
        unnest(case when cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[cmd] end) as c
      from pg_policies
      where schemaname = 'public' and permissive = 'PERMISSIVE'
    ) x
    group by x.schemaname, x.tablename, x.c
    having count(*) > 1
  loop
    create temp table if not exists _merge_pol (cmd text, roles name[], qual text, with_check text) on commit drop;
    truncate _merge_pol;
    insert into _merge_pol
      select cmd, roles, qual, with_check from pg_policies
      where schemaname = t.schemaname and tablename = t.tablename and permissive = 'PERMISSIVE';

    for p in
      select policyname from pg_policies
      where schemaname = t.schemaname and tablename = t.tablename and permissive = 'PERMISSIVE'
    loop
      execute format('drop policy %I on %I.%I', p.policyname, t.schemaname, t.tablename);
    end loop;

    foreach c in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      select bool_and(roles = array['authenticated']::name[]) into all_auth
      from _merge_pol where cmd in (c, 'ALL');
      if all_auth is null then continue; end if;  -- nothing granted this command

      roles_clause := case when all_auth then 'authenticated' else 'public' end;

      select string_agg('(' || case when not all_auth and roles = array['authenticated']::name[]
                                    then '(select auth.role()) = ''authenticated'' and (' || qual || ')'
                                    else qual end || ')', ' or ')
        into using_expr
      from _merge_pol where cmd in (c, 'ALL') and qual is not null;

      select string_agg('(' || case when not all_auth and roles = array['authenticated']::name[]
                                    then '(select auth.role()) = ''authenticated'' and (' || coalesce(with_check, qual) || ')'
                                    else coalesce(with_check, qual) end || ')', ' or ')
        into check_expr
      from _merge_pol where cmd in (c, 'ALL') and coalesce(with_check, qual) is not null;

      stmt := format('create policy %I on %I.%I for %s to %s',
        t.tablename || '_' || lower(c), t.schemaname, t.tablename, c, roles_clause);
      if c in ('SELECT','UPDATE','DELETE') then
        stmt := stmt || format(' using (%s)', coalesce(using_expr, 'false'));
      end if;
      if c in ('INSERT','UPDATE') then
        stmt := stmt || format(' with check (%s)', coalesce(check_expr, 'false'));
      end if;
      execute stmt;
    end loop;
  end loop;
end $$;

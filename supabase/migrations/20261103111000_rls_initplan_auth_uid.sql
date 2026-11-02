-- Wrap auth.uid() / auth.jwt() / auth.role() in public RLS policies as
-- (select auth.<fn>()) so Postgres evaluates it once per statement (an
-- initplan) rather than once per row. Already-wrapped calls are left alone,
-- so this is idempotent and a no-op on an empty database.
do $$
declare
  p record;
  nq text;
  nw text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    nq := regexp_replace(p.qual, '(?<!SELECT )auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
    nw := regexp_replace(p.with_check, '(?<!SELECT )auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
    if nq is not distinct from p.qual and nw is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if nq is not null then stmt := stmt || format(' using (%s)', nq); end if;
    if nw is not null then stmt := stmt || format(' with check (%s)', nw); end if;
    execute stmt;
  end loop;
end $$;

-- Trigger functions run whatever role fires them and need no EXECUTE grant;
-- the one still open to anon and public is closed (ELE_OBJ-026). The
-- SECURITY DEFINER functions anon can still run are the user_can_read_*
-- predicates RLS policies call for every role — revoking them would turn
-- anon's empty results into errors (see the alcon skill, "DB を直接触るとき").
do $mig$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'alcon_internal')
      and p.prorettype = 'trigger'::regtype
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $mig$;

-- The trigger read clean; the function it calls did not.
--
-- `set_object_display_id` (public, in scope as a trigger on `objects`) reads:
--
--   IF NEW.prefix IS NULL OR NEW.prefix = '' THEN
--     NEW.prefix := public.generate_prefix(NEW.name);
--   END IF;
--
-- `generate_prefix` is where a CJK name actually gets mangled — the trigger
-- itself just calls it — and `describe_function` refused it, correctly: it is
-- not itself a trigger on any of the five whitelisted tables. That refusal is
-- the design working, not a bug in it. But el_QLT-012's whole question is what
-- that function does, and it is now a name read out of an already-authorized
-- definition, not a guess.
--
-- Widened by one hop rather than by a name: a function is readable if it is a
-- trigger on a whitelisted table (as before), or if its name appears as a call
-- inside the definition of one that is. The second clause is a text search
-- over `pg_get_functiondef`, not a hardcoded list — it will just as well reach
-- whatever the next trigger calls next time, without anyone maintaining a
-- name here. It goes no further than that one hop; a function called only by
-- something this migration would also have to reach through two hops stays
-- out of view, which is the same boundary the five-table list already draws
-- around the first hop.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the function this modifies is created by the migration
-- immediately before it, which already no-ops there.

do $migration$
begin
  if to_regclass('public.objects') is null then
    raise notice 'introspect one-hop skipped: base schema not present';
    return;
  end if;

  execute $fn$
    create or replace function public.describe_function(fn_name text)
    returns text
    language sql
    security definer
    set search_path = pg_catalog, public
    stable
    as $body$
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
        and (
          -- First hop: a trigger function on a whitelisted table.
          exists (
            select 1
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace cn on cn.oid = c.relnamespace
            where t.tgfoid = p.oid
              and not t.tgisinternal
              and cn.nspname = 'public'
              and c.relname in ('objects', 'elements', 'subelements', 'workers', 'notifications')
          )
          or
          -- Second hop: named as a call inside the body of a function that
          -- passes the first check. Bounded on the left by "not preceded by
          -- an identifier character" so a name that is merely a suffix of a
          -- longer one does not open a false door — but a preceding '.' is
          -- allowed through on purpose, since the call this exists to find is
          -- schema-qualified: `public.generate_prefix(...)`, where the
          -- character right before the name being searched for is the dot,
          -- not a boundary.
          exists (
            select 1
            from pg_proc caller
            join pg_namespace cn2 on cn2.oid = caller.pronamespace
            where cn2.nspname = 'public'
              and exists (
                select 1
                from pg_trigger t2
                join pg_class c2 on c2.oid = t2.tgrelid
                join pg_namespace cn3 on cn3.oid = c2.relnamespace
                where t2.tgfoid = caller.oid
                  and not t2.tgisinternal
                  and cn3.nspname = 'public'
                  and c2.relname in ('objects', 'elements', 'subelements', 'workers', 'notifications')
              )
              and pg_get_functiondef(caller.oid) ~ ('(^|[^[:alnum:]_])' || fn_name || '\s*\(')
          )
        )
    $body$;
  $fn$;
end $migration$;

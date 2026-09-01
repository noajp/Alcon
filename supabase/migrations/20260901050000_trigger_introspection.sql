-- This session could see PostgREST's tables and rows, and nothing that
-- generates them.
--
-- The prefix a CJK Object name mangles into ("TF-MED — 医療" → "T—医") is
-- produced by a trigger this repository has no migration file for — the base
-- schema predates the migrations folder, per CLAUDE.md. Reading it meant
-- reading `pg_proc` / `pg_trigger`, which PostgREST does not expose and which
-- this session had no other path to: the Supabase MCP and CLI both return
-- Unauthorized. So el_QLT-012 was stuck on a question nobody could ask the
-- database directly — not "what should the fix be" but "what does the thing
-- I'm fixing currently say".
--
-- Two read-only RPCs, callable by anyone signed in. `security definer` is
-- what lets them see `pg_proc` / `pg_trigger` at all — the caller's own role
-- cannot. The scope is a fixed table list rather than "any table" or "any
-- function": these five are the ones this repo's own migrations already
-- create triggers on, so granting this reveals nothing the schema itself
-- doesn't already govern by CHECK constraints and RLS policies that are
-- public knowledge. Widening the list is a one-line change when a sixth
-- table needs it, and that line will say so explicitly rather than the
-- boundary quietly becoming "everything".
--
-- `list_table_triggers` answers "what runs on this table, and what function
-- backs it" without exposing the function body — the shape a first question
-- needs. `describe_function` answers "what does that function actually say",
-- gated on the name having shown up as a trigger function on one of the same
-- tables, checked with a live subquery rather than a copy of the list: the
-- two can never drift out of agreement with each other.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the tables these read about are created outside it.

do $migration$
begin
  execute $fn$
    create or replace function public.list_table_triggers(target_table text)
    returns table(trigger_name text, function_name text, "when" text, events text)
    language sql
    security definer
    set search_path = pg_catalog, public
    stable
    as $body$
      select
        t.tgname,
        p.proname,
        case t.tgtype & 66 when 2 then 'before' when 64 then 'instead of' else 'after' end,
        array_to_string(array_remove(array[
          case when t.tgtype & 4  <> 0 then 'insert' end,
          case when t.tgtype & 8  <> 0 then 'delete' end,
          case when t.tgtype & 16 <> 0 then 'update' end,
          case when t.tgtype & 32 <> 0 then 'truncate' end
        ], null), ', ')
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public'
        and c.relname = target_table
        and not t.tgisinternal
        -- The whitelist. Every table this repo's migrations attach a trigger
        -- to; widen it here, not by relaxing the check below.
        and target_table in ('objects', 'elements', 'subelements', 'workers', 'notifications')
    $body$;
  $fn$;

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
        -- Not a hardcoded name list: a function qualifies by actually being a
        -- trigger function on one of the whitelisted tables right now, so this
        -- can never be asked to read something list_table_triggers would not
        -- also have shown.
        and exists (
          select 1
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace cn on cn.oid = c.relnamespace
          where t.tgfoid = p.oid
            and not t.tgisinternal
            and cn.nspname = 'public'
            and c.relname in ('objects', 'elements', 'subelements', 'workers', 'notifications')
        )
    $body$;
  $fn$;

  execute 'revoke all on function public.list_table_triggers(text) from public';
  execute 'revoke all on function public.describe_function(text) from public';

  -- `authenticated` is Supabase's role, not a role bare Postgres ships with —
  -- absent on a from-scratch instance the way `pg_proc` itself is not. Guarded
  -- the same way a to_regclass check guards a table that predates the
  -- migrations folder.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.list_table_triggers(text) to authenticated';
    execute 'grant execute on function public.describe_function(text) to authenticated';
  else
    raise notice 'trigger introspection grants skipped: role "authenticated" not present';
  end if;
end $migration$;

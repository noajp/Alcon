-- el_QLT-007: messages.author_kind allows 'human' | 'ai_agent' and author_id
-- is nullable — the schema clearly anticipates an ai_agent author with no
-- auth.users row. But the insert policy on messages (base schema, outside
-- this migrations folder per CLAUDE.md) requires author_id = auth.uid(),
-- which an ai_agent row (author_id IS NULL) can never satisfy. A pure
-- schema/policy mismatch, independent of whether Talk is actually adopted
-- as an agent channel yet — nothing in the repo posts to messages as an
-- agent today, so this doesn't unblock a broken feature, it just stops the
-- policy from silently contradicting what the schema already promises.
--
-- Additive, not a replacement: this adds a second permissive INSERT policy
-- scoped only to the ai_agent shape, alongside whatever the existing
-- human-authorship policy already does — Postgres OR's multiple permissive
-- policies for the same command together, so the human path is untouched.
--
-- Same reasoning as element_comments' existing ai_agent convention
-- (author_kind='ai_agent', author_id=NULL, no per-agent auth.users row):
-- any signed-in caller may write an ai_agent-authored row. This repo has no
-- other mechanism to distinguish "this signed-in session is acting as an
-- agent" from "this is a human typing" — the same trust boundary already
-- accepted for element_comments.
--
-- Guarded for preview replay: preview branches replay this folder against
-- an empty database; messages is base schema, created outside it.
do $$
begin
  if to_regclass('public.messages') is null then
    raise notice 'messages ai_agent insert policy skipped: messages not present';
    return;
  end if;
  execute 'drop policy if exists messages_insert_ai_agent on public.messages';
  execute $pol$
    create policy messages_insert_ai_agent on public.messages
      for insert
      with check (
        auth.uid() is not null
        and author_kind = 'ai_agent'
        and author_id is null
      )
  $pol$;
end
$$;

-- Widen the read-only policy-introspection RPC (20260902150000) to cover
-- messages, so the fix above (and the policy it sits beside) can actually
-- be read back and verified — the same blind spot that RPC exists to close,
-- now including this table.
do $$
begin
  if to_regclass('public.messages') is null then
    raise notice 'list_table_policies widen skipped: messages not present';
    return;
  end if;
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
          'strategies', 'strategy_objects', 'strategy_children', 'messages'
        )
    $body$;
  $fn$;
end
$$;

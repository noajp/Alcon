-- Server-side rollup for Element comment activity: one aggregated row per
-- Element instead of shipping every comment row to the client. Called from
-- useElementActivity via rpc (POST body), so large visible sets don't hit
-- URL-length limits, and the response is O(elements) — immune to the
-- PostgREST row cap that would silently truncate a raw comment-row fetch.
--
-- SECURITY INVOKER on purpose: element_comments RLS applies to the caller,
-- so the rollup can never leak counts for comments the user can't see.
-- Same "skip on preview replay" guard as the other element migrations.

do $$
begin
  if to_regclass('public.element_comments') is null then
    raise notice 'element activity rollup skipped: element_comments not present';
    return;
  end if;

  execute $fn$
    create or replace function public.get_element_activity(p_element_ids uuid[])
    returns table (element_id uuid, comment_count bigint, last_comment_at timestamptz)
    language sql
    stable
    security invoker
    set search_path = public
    as $body$
      select ec.element_id, count(*)::bigint, max(ec.created_at)
      from public.element_comments ec
      where ec.element_id = any(p_element_ids)
      group by ec.element_id
    $body$;
  $fn$;

  execute 'grant execute on function public.get_element_activity(uuid[]) to authenticated';
end
$$;

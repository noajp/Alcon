-- Memory search finds a short query inside a long memory.
--
-- search_memories ranked by similarity(search_text, query) and admitted
-- only rows over pg_trgm's similarity threshold. Similarity compares the
-- two texts whole, so a query a few words long against a memory's
-- title + gist + body scores far under the threshold even when the
-- memory's title is the query word for word: recall by query found
-- nothing, and a run's context load picked no bodies. The rank is now
-- how well either text is found inside the other:
--
--   word_similarity(query, search_text)    a short query inside the
--                                          memory — what the recall
--                                          tool sends
--   word_similarity(title + gist, query)   the memory's headline inside
--                                          a long query — what a run's
--                                          context load sends (the
--                                          work's own words)
--
-- and a row is admitted when the better of the two reaches 0.3. Scope
-- (RLS, the Space filter), the boosts, the order and the signature are
-- unchanged, so every caller keeps its call. The rank is computed per
-- visible row rather than through the trigram index: the store is small
-- by design (one durable per topic, episodes that expire).
--
-- Guarded for preview replay: the function reads public.memories.
do $$
begin
  if to_regclass('public.memories') is null then
    raise notice 'memory search skipped: memories not present';
    return;
  end if;

  execute $f$
  create or replace function public.search_memories(
    p_query text, p_space_id uuid default null, p_element_id uuid default null, p_limit integer default 20)
  returns table (
    id uuid, layer text, kind text, status text, scope text, activity_space_id uuid, user_id uuid,
    title text, gist text, body text, topic_key text, element_id uuid, domain_id uuid, strategy_id uuid,
    integration_name text, origin text, created_by uuid, pinned boolean, use_count integer,
    last_used_at timestamptz, created_at timestamptz, score real)
  language sql stable security invoker set search_path = public, extensions as $body$
    select m.id, m.layer, m.kind, m.status, m.scope, m.activity_space_id, m.user_id,
      m.title, m.gist, m.body, m.topic_key, m.element_id, m.domain_id, m.strategy_id,
      m.integration_name, m.origin, m.created_by, m.pinned, m.use_count,
      m.last_used_at, m.created_at,
      (found.rank
        + case when p_element_id is not null and m.element_id = p_element_id then 0.25 else 0 end
        + case when m.layer = 'durable' then 0.05 else 0 end)::real as score
    from public.memories m
    cross join lateral (
      select greatest(
        extensions.word_similarity(coalesce(p_query, ''), m.search_text),
        extensions.word_similarity(m.title || ' ' || coalesce(m.gist, ''), coalesce(p_query, ''))
      ) as rank
    ) found
    where m.status = 'active'
      and (p_space_id is null or m.activity_space_id = p_space_id or m.scope = 'personal')
      and (coalesce(p_query, '') = '' or found.rank >= 0.3)
    order by score desc, m.use_count desc, m.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  $body$
  $f$;
end $$;

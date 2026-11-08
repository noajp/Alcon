-- Memory: what one piece of work taught, kept so the next piece of
-- work does not have to learn it again. The audit (runs, steps,
-- verdicts) is the whole sealed record; memory is the curated layer
-- above it — distilled, editable, deletable, and always linked back
-- to where it came from. This migration lays down the store:
--
--   memories        one row is one memory. Two layers: 'episode' —
--                   written automatically after work, unreviewed,
--                   expiring after 90 days; 'durable' — promoted,
--                   curated, no expiry. kind says what sort of
--                   knowledge it is (event / procedure / fact).
--                   scope says whose it is: 'space' rows are read by
--                   the Space's members; 'personal' rows are their
--                   person's alone — a conversation's privacy
--                   boundary is inherited, never widened by memory
--                   (a personal memory reaches a Space only when its
--                   person shares it, an explicit act in the UI).
--                   status: active / superseded (replaced, kept as
--                   history through supersedes_id) / archived (a
--                   person folded it away) / expired (an episode the
--                   sweep retired). A durable memory's topic_key
--                   names its fact: one active durable per scope and
--                   topic_key, guaranteed by a partial unique index,
--                   so "one fact = one memory" is structural, not a
--                   promise. Provenance is mandatory in shape if not
--                   in columns: origin says who made it (athena =
--                   distilled by the engine, person = a person's own
--                   act), and source_run_id / source_session_id link
--                   back to the record it was distilled from.
--                   search_text is a generated derivative (title,
--                   gist, body) with a pg_trgm GIN index — the
--                   attachment_texts precedent: Japanese text is
--                   searched by trigram, never by tsvector. The
--                   index is a derivative; the row is the truth.
--   memory_uses     one row per (memory, run) that actually used the
--                   memory — its body entered the run's context, or a
--                   recall returned it. The index being *shown* is
--                   not a use. use_count on the memory is the
--                   denormalized count of these rows; at 3 uses an
--                   episode promotes to durable on its own.
--   search_memories security-invoker search over what the caller may
--                   read: RLS is the scope, trigram similarity is the
--                   rank. The engines and the recall tool share it.
--   activity_spaces.memory_auto_capture / profiles.memory_auto_capture
--                   the person's control over automatic capture: a
--                   settings toggle, not an approval. Memory is
--                   internal bookkeeping (like writing steps), so the
--                   approval modes do not govern it. Default on.
--
-- Writes from the app go through RLS: a person writes memories as
-- themselves (origin 'person'); Athena's distilled writes are the
-- service role's, which is also how a use is recorded and an episode
-- promoted — machine bookkeeping no policy grants to people.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_profiles boolean := to_regclass('public.profiles') is not null;
  has_runs boolean := to_regclass('public.agent_runs') is not null;
  has_sessions boolean := to_regclass('public.ai_sessions') is not null;
  has_elements boolean := to_regclass('public.elements') is not null;
  has_domains boolean := to_regclass('public.domains') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
begin
  -- The store's space scope hangs off activity_spaces; without it
  -- there is nothing to build (preview replays run in order, so this
  -- is a formality — the table it references is an early migration's).
  if not has_spaces then
    raise notice 'memory skipped: activity_spaces not present';
    return;
  end if;

  -- ── The store ───────────────────────────────────────────────────────
  create table if not exists public.memories (
    id uuid primary key default gen_random_uuid(),
    layer text not null default 'episode' check (layer in ('episode', 'durable')),
    kind text not null default 'event' check (kind in ('event', 'procedure', 'fact')),
    status text not null default 'active' check (status in ('active', 'superseded', 'archived', 'expired')),
    scope text not null check (scope in ('space', 'personal')),
    activity_space_id uuid references public.activity_spaces(id) on delete cascade,
    user_id uuid references auth.users(id) on delete cascade,
    title text not null,
    gist text not null default '',
    body text not null default '',
    topic_key text,
    fingerprint text,
    element_id uuid,
    domain_id uuid,
    strategy_id uuid,
    integration_name text,
    origin text not null default 'athena' check (origin in ('athena', 'person')),
    created_by uuid references auth.users(id) on delete set null,
    edited_by uuid references auth.users(id) on delete set null,
    source_run_id uuid,
    source_session_id uuid,
    supersedes_id uuid references public.memories(id) on delete set null,
    pinned boolean not null default false,
    use_count integer not null default 0,
    last_used_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_text text generated always as (title || ' ' || gist || ' ' || body) stored,
    check ((scope = 'space' and activity_space_id is not null) or (scope = 'personal' and user_id is not null))
  );
  -- The target links keep no foreign key of their own in this guarded
  -- form; add them when their tables are present (targets may vanish
  -- while the memory stays — what was learned outlives its Element).
  if has_runs then
    execute 'alter table public.memories drop constraint if exists memories_source_run_fk';
    execute 'alter table public.memories add constraint memories_source_run_fk foreign key (source_run_id) references public.agent_runs(id) on delete set null';
  end if;
  if has_sessions then
    execute 'alter table public.memories drop constraint if exists memories_source_session_fk';
    execute 'alter table public.memories add constraint memories_source_session_fk foreign key (source_session_id) references public.ai_sessions(id) on delete set null';
  end if;
  if has_elements then
    execute 'alter table public.memories drop constraint if exists memories_element_fk';
    execute 'alter table public.memories add constraint memories_element_fk foreign key (element_id) references public.elements(id) on delete set null';
  end if;
  if has_domains then
    execute 'alter table public.memories drop constraint if exists memories_domain_fk';
    execute 'alter table public.memories add constraint memories_domain_fk foreign key (domain_id) references public.domains(id) on delete set null';
  end if;
  if has_strategies then
    execute 'alter table public.memories drop constraint if exists memories_strategy_fk';
    execute 'alter table public.memories add constraint memories_strategy_fk foreign key (strategy_id) references public.strategies(id) on delete set null';
  end if;

  -- One fact = one memory: at most one active durable per topic in a
  -- scope — a Space's topics, and each person's own topics.
  execute 'create unique index if not exists memories_one_active_durable_space on public.memories (activity_space_id, topic_key) where layer = ''durable'' and status = ''active'' and scope = ''space'' and topic_key is not null';
  execute 'create unique index if not exists memories_one_active_durable_personal on public.memories (user_id, topic_key) where layer = ''durable'' and status = ''active'' and scope = ''personal'' and topic_key is not null';
  -- The same episode is never distilled twice from the same work.
  execute 'create unique index if not exists memories_episode_fingerprint on public.memories (fingerprint) where fingerprint is not null';
  execute 'create index if not exists memories_scope_recent_idx on public.memories (scope, activity_space_id, user_id, layer, status, created_at desc)';
  execute 'create index if not exists memories_element_idx on public.memories (element_id, created_at desc) where element_id is not null';
  execute 'create index if not exists memories_expiry_idx on public.memories (expires_at) where layer = ''episode'' and status = ''active'' and expires_at is not null';
  execute 'create extension if not exists pg_trgm with schema extensions';
  execute 'create index if not exists memories_search_trgm on public.memories using gin (search_text extensions.gin_trgm_ops)';

  create table if not exists public.memory_uses (
    id uuid primary key default gen_random_uuid(),
    memory_id uuid not null references public.memories(id) on delete cascade,
    run_id uuid not null,
    created_at timestamptz not null default now()
  );
  if has_runs then
    execute 'alter table public.memory_uses drop constraint if exists memory_uses_run_fk';
    execute 'alter table public.memory_uses add constraint memory_uses_run_fk foreign key (run_id) references public.agent_runs(id) on delete cascade';
  end if;
  execute 'create unique index if not exists memory_uses_once_per_run on public.memory_uses (memory_id, run_id)';
  execute 'create index if not exists memory_uses_memory_idx on public.memory_uses (memory_id, created_at desc)';

  -- ── Who may read and write ──────────────────────────────────────────
  alter table public.memories enable row level security;
  alter table public.memory_uses enable row level security;
  drop policy if exists memories_select on public.memories;
  execute $p$
    create policy memories_select on public.memories for select to authenticated using (
      (scope = 'space' and public.is_activity_space_member(activity_space_id))
      or (scope = 'personal' and user_id = (select auth.uid()))
    )
  $p$;
  drop policy if exists memories_insert on public.memories;
  execute $p$
    create policy memories_insert on public.memories for insert to authenticated with check (
      origin = 'person' and created_by = (select auth.uid())
      and ((scope = 'space' and public.is_activity_space_member(activity_space_id))
        or (scope = 'personal' and user_id = (select auth.uid())))
    )
  $p$;
  -- A Space's memories are corrected by its owner, and by the person
  -- who wrote a memory of their own; what Athena distilled (no human
  -- creator) is the owner's to correct. Personal memories are their
  -- person's alone, whoever distilled them.
  drop policy if exists memories_update on public.memories;
  execute $p$
    create policy memories_update on public.memories for update to authenticated
      using (
        (scope = 'space' and (public.is_activity_space_owner(activity_space_id)
          or (origin = 'person' and created_by = (select auth.uid()))))
        or (scope = 'personal' and user_id = (select auth.uid()))
      )
      with check (
        (scope = 'space' and (public.is_activity_space_owner(activity_space_id)
          or (origin = 'person' and created_by = (select auth.uid()))))
        or (scope = 'personal' and user_id = (select auth.uid()))
      )
  $p$;
  drop policy if exists memories_delete on public.memories;
  execute $p$
    create policy memories_delete on public.memories for delete to authenticated
      using (
        (scope = 'space' and (public.is_activity_space_owner(activity_space_id)
          or (origin = 'person' and created_by = (select auth.uid()))))
        or (scope = 'personal' and user_id = (select auth.uid()))
      )
  $p$;
  -- Uses are the engine's bookkeeping (service role writes them);
  -- people read them where they can read the memory itself.
  drop policy if exists memory_uses_select on public.memory_uses;
  execute $p$
    create policy memory_uses_select on public.memory_uses for select to authenticated using (
      exists (select 1 from public.memories m where m.id = memory_uses.memory_id)
    )
  $p$;

  -- ── Search: the caller's scope is RLS, the rank is trigram ──────────
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
      (extensions.similarity(m.search_text, coalesce(p_query, ''))
        + case when p_element_id is not null and m.element_id = p_element_id then 0.25 else 0 end
        + case when m.layer = 'durable' then 0.05 else 0 end)::real as score
    from public.memories m
    where m.status = 'active'
      and (p_space_id is null or m.activity_space_id = p_space_id or m.scope = 'personal')
      and (coalesce(p_query, '') = '' or m.search_text % coalesce(p_query, ''))
    order by score desc, m.use_count desc, m.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  $body$
  $f$;
  execute 'revoke all on function public.search_memories(text, uuid, uuid, integer) from public';
  execute 'grant execute on function public.search_memories(text, uuid, uuid, integer) to authenticated';

  -- ── The capture toggles ─────────────────────────────────────────────
  if has_spaces then
    execute 'alter table public.activity_spaces add column if not exists memory_auto_capture boolean not null default true';
    execute 'grant select (memory_auto_capture) on public.activity_spaces to authenticated';
    execute 'grant update (memory_auto_capture) on public.activity_spaces to authenticated';
  end if;
  if has_profiles then
    execute 'alter table public.profiles add column if not exists memory_auto_capture boolean not null default true';
    execute 'grant select (memory_auto_capture) on public.profiles to authenticated';
    execute 'grant update (memory_auto_capture) on public.profiles to authenticated';
  end if;
end
$$;

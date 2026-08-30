-- A Campaign had nowhere to say anything.
--
-- Everything below a Campaign can be discussed — an Element has a comment
-- thread, so does a Note, so does a channel — but the Campaign itself, the
-- place where the intent lives, could only be edited. The consequence is that
-- the intent silently rots: the only way to record "this assumption is no
-- longer true" was to rewrite the description and destroy what it used to say.
--
-- strategy_comments is the Campaign's thread. Same shape as element_comments
-- (author_id nullable because the FK points at auth.users and an ai_agent has
-- no auth user; author_kind + author_name carry who wrote it instead), so both
-- threads can be read and rendered by the same code.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database and `strategies` is created outside it.

do $migration$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'strategy_comments skipped: strategies not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.strategy_comments (
      id          uuid primary key default gen_random_uuid(),
      strategy_id uuid not null references public.strategies(id) on delete cascade,
      parent_id   uuid references public.strategy_comments(id) on delete cascade,
      author_id   uuid references auth.users(id) on delete set null,
      author_kind text not null default 'human' check (author_kind in ('human', 'ai_agent')),
      author_name text,
      content     text not null,
      mentions    uuid[] not null default '{}',
      is_pinned   boolean not null default false,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now()
    )
  $ddl$;

  execute 'create index if not exists strategy_comments_thread_idx
           on public.strategy_comments (strategy_id, created_at)';

  -- ── RLS ────────────────────────────────────────────────────────────────────
  -- One policy per operation, and every one of them defers the visibility
  -- question to `strategies` instead of answering it here.
  --
  -- `strategies` currently carries a policy that grants ALL to any signed-in
  -- user, which swallows its own owner-scoped policies (el_STR-008). Writing
  -- `auth.uid() is not null` here as well would copy that hole into a second
  -- table, and fixing the boundary later would then have to be done twice.
  -- An `exists (select 1 from strategies …)` subquery is evaluated under the
  -- caller's own RLS, so the comment thread is exactly as visible as the
  -- Campaign it hangs off — today that is wide, and the day el_STR-008 tightens
  -- `strategies` these tighten with it, with nothing to change here.
  --
  -- Writes are narrower than reads on purpose:
  --   insert — you may only sign a comment as yourself. author_id null is the
  --            ai_agent path (no auth user exists to point at), which is how
  --            agents report from the API.
  --   update/delete — the author, or the Campaign's owner. Someone has to be
  --            able to clear an agent's comment, and the owner is the only
  --            party the schema knows is accountable for the Campaign.
  execute 'alter table public.strategy_comments enable row level security';

  execute 'drop policy if exists strategy_comments_select on public.strategy_comments';
  execute $sql$
    create policy strategy_comments_select on public.strategy_comments
      for select using (
        exists (select 1 from public.strategies s where s.id = strategy_id)
      )
  $sql$;

  execute 'drop policy if exists strategy_comments_insert on public.strategy_comments';
  execute $sql$
    create policy strategy_comments_insert on public.strategy_comments
      for insert with check (
        auth.uid() is not null
        and (author_id is null or author_id = auth.uid())
        and exists (select 1 from public.strategies s where s.id = strategy_id)
      )
  $sql$;

  execute 'drop policy if exists strategy_comments_update on public.strategy_comments';
  execute $sql$
    create policy strategy_comments_update on public.strategy_comments
      for update using (
        author_id = auth.uid()
        or exists (
          select 1 from public.strategies s
          where s.id = strategy_id and s.created_by = auth.uid()
        )
      ) with check (
        (author_id is null or author_id = auth.uid())
        or exists (
          select 1 from public.strategies s
          where s.id = strategy_id and s.created_by = auth.uid()
        )
      )
  $sql$;

  execute 'drop policy if exists strategy_comments_delete on public.strategy_comments';
  execute $sql$
    create policy strategy_comments_delete on public.strategy_comments
      for delete using (
        author_id = auth.uid()
        or exists (
          select 1 from public.strategies s
          where s.id = strategy_id and s.created_by = auth.uid()
        )
      )
  $sql$;

  -- ── Realtime ───────────────────────────────────────────────────────────────
  -- The board pushes; it is not polled. A comment written from the API has to
  -- reach an open Campaign the moment it lands, same as element_comments.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'strategy_comments'
     ) then
    execute 'alter publication supabase_realtime add table public.strategy_comments';
  end if;
end
$migration$;

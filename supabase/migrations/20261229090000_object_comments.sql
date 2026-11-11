-- An Object's own thread: what people say about the Object itself, on its
-- Overview, under its files. An Element has one (element_comments), a
-- Strategy has one (strategy_comments); the Object between them had none.
--
-- object_comments is the same shape as both, so one panel reads and renders
-- all three.
--
--   select   whoever can read the Object (user_can_read_object — viewers too)
--   insert   whoever can work in the Object (user_can_see_object), and only a
--            row signed as themselves (author_id = auth.uid()). Agents that
--            write with a person's session stamp that person; the service
--            role is not touched by RLS
--   update   whoever can work in the Object; a trigger keeps the author, the
--            Object and the time as they were, and lets anyone but the author
--            change nothing except the pin
--   delete   the author only
--   reply    parent_id names a comment on the same Object
--
-- Inbox: a trigger writes the notifications (ADR 0003 — a comment written
-- over the API has to notify too). Named people get a 'mention'; when a
-- person wrote it, the Object's lead, its members and everyone already in the
-- thread get a 'comment'. An agent's comment reaches only the people it
-- names. Nobody is told about an Object they cannot read. The row carries
-- object_id, which the Inbox already opens.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `objects`, `notifications` and the visibility helpers
-- are created outside it.

do $migration$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.object_members') is null
     or to_regprocedure('public.user_can_read_object(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('alcon_internal.user_can_read_object_as(uuid, uuid)') is null then
    raise notice 'object_comments skipped: objects, notifications or the Object visibility helpers not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.object_comments (
      id          uuid primary key default gen_random_uuid(),
      object_id   uuid not null references public.objects(id) on delete cascade,
      parent_id   uuid references public.object_comments(id) on delete cascade,
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

  execute 'create index if not exists object_comments_thread_idx
           on public.object_comments (object_id, created_at)';

  -- ── RLS ────────────────────────────────────────────────────────────────
  execute 'alter table public.object_comments enable row level security';

  execute 'drop policy if exists object_comments_select on public.object_comments';
  execute $p$create policy object_comments_select on public.object_comments
    for select to authenticated using (public.user_can_read_object(object_id))$p$;

  execute 'drop policy if exists object_comments_insert on public.object_comments';
  execute $p$create policy object_comments_insert on public.object_comments
    for insert to authenticated
    with check (author_id = auth.uid() and public.user_can_see_object(object_id))$p$;

  execute 'drop policy if exists object_comments_update on public.object_comments';
  execute $p$create policy object_comments_update on public.object_comments
    for update to authenticated
    using (public.user_can_see_object(object_id))
    with check (public.user_can_see_object(object_id))$p$;

  execute 'drop policy if exists object_comments_delete on public.object_comments';
  execute $p$create policy object_comments_delete on public.object_comments
    for delete to authenticated using (author_id = auth.uid())$p$;

  execute 'grant select, insert, update, delete on public.object_comments to authenticated';
  execute 'grant all on public.object_comments to service_role';

  -- Who wrote it, where, and when never change from a browser; someone
  -- else's comment can only be pinned or unpinned.
  execute $f$create or replace function public.object_comments_guard_update()
  returns trigger language plpgsql set search_path = public as $g$
  begin
    new.updated_at := now();
    if auth.uid() is null then return new; end if;  -- service role
    if new.object_id is distinct from old.object_id
       or new.author_id is distinct from old.author_id
       or new.author_kind is distinct from old.author_kind
       or new.author_name is distinct from old.author_name
       or new.created_at is distinct from old.created_at then
      raise exception 'a comment''s author, Object and time cannot be changed' using errcode = '42501';
    end if;
    if old.author_id is distinct from auth.uid()
       and (new.content is distinct from old.content
            or new.mentions is distinct from old.mentions
            or new.parent_id is distinct from old.parent_id) then
      raise exception 'only the author can edit a comment' using errcode = '42501';
    end if;
    return new;
  end
  $g$
  $f$;
  execute 'drop trigger if exists trg_object_comments_guard_update on public.object_comments';
  execute 'create trigger trg_object_comments_guard_update before update on public.object_comments
    for each row execute function public.object_comments_guard_update()';

  -- A reply stays in its Object's thread: parent_id names a comment on the
  -- same Object (the FK alone would accept any comment id).
  execute $f$create or replace function public.object_comments_parent_same_object()
  returns trigger language plpgsql set search_path = public as $g$
  begin
    if new.parent_id is not null and not exists (
      select 1 from public.object_comments c where c.id = new.parent_id and c.object_id = new.object_id
    ) then
      raise exception 'a reply must answer a comment on the same Object' using errcode = '23514';
    end if;
    return new;
  end
  $g$
  $f$;
  execute 'drop trigger if exists trg_object_comments_parent_same_object on public.object_comments';
  execute 'create trigger trg_object_comments_parent_same_object before insert or update of parent_id, object_id
    on public.object_comments for each row execute function public.object_comments_parent_same_object()';

  -- ── Inbox ──────────────────────────────────────────────────────────────
  -- SECURITY DEFINER because under RLS the commenting role cannot insert
  -- notifications addressed to other users; search_path pinned.
  execute $f$create or replace function public.notify_object_comment()
  returns trigger language plpgsql security definer set search_path = public as $g$
  declare
    v_object text;
    v_author text := coalesce(nullif(new.author_name, ''), 'Someone');
  begin
    select o.name into v_object from objects o where o.id = new.object_id;
    if v_object is null then return new; end if; -- Object gone; nothing to say

    -- Named people, whoever wrote the comment. For an agent this is the
    -- whole delivery path. Only people who can read the Object.
    insert into notifications
      (recipient_id, actor_id, actor_name, kind, object_id, title, body)
    select distinct m, new.author_id, new.author_name, 'mention', new.object_id,
           v_author || ' mentioned you in ' || v_object, left(new.content, 140)
    from unnest(new.mentions) as m
    where (new.author_id is null or m <> new.author_id)
      and alcon_internal.user_can_read_object_as(new.object_id, m);

    if new.author_kind = 'ai_agent' then
      return new;
    end if;

    -- Written by a person: the Object's lead, its members and everyone
    -- already in the thread — minus the author, minus anyone named above,
    -- and minus anyone who can no longer read the Object.
    insert into notifications
      (recipient_id, actor_id, actor_name, kind, object_id, title, body)
    select distinct r.user_id, new.author_id, new.author_name, 'comment', new.object_id,
           v_author || ' commented on ' || v_object, left(new.content, 140)
    from (
      select w.user_id
      from objects o
      join workers w on w.id = o.lead_id
      where o.id = new.object_id
      union
      select m.user_id from object_members m where m.object_id = new.object_id
      union
      select c.author_id
      from object_comments c
      where c.object_id = new.object_id
        and c.author_kind = 'human'
    ) r
    where r.user_id is not null
      and (new.author_id is null or r.user_id <> new.author_id)
      and not (r.user_id = any (new.mentions))
      and alcon_internal.user_can_read_object_as(new.object_id, r.user_id);

    return new;
  end
  $g$
  $f$;
  execute 'drop trigger if exists trg_object_comment_notify on public.object_comments';
  execute 'create trigger trg_object_comment_notify after insert on public.object_comments
    for each row execute function public.notify_object_comment()';

  -- ── Realtime ───────────────────────────────────────────────────────────
  -- The thread is pushed, not polled: a comment reaches an open Overview the
  -- moment it lands, the way an Element's and a Strategy's do.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'object_comments'
     ) then
    execute 'alter publication supabase_realtime add table public.object_comments';
  end if;
end
$migration$;

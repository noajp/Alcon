-- The Inbox carried 54 rows and none of them were news.
--
-- Every one of the 98 element comments in this database was written by an
-- ai_agent, and notify_element_comment() fanned each one out to the Domain's
-- owner. So an agent reporting "● 進捗" on its own work produced a personal
-- notification, once per report, for the one human who already knew. The
-- signal that did matter — the Element reaching done, or hitting blocked —
-- had no notification of its own at all: it arrived as prose inside a comment
-- body, truncated at 140 characters.
--
-- Two changes, and they are the same change seen from both ends.
--
-- 1. An agent's comment notifies only the users it names in `mentions`.
--    Broadcasting a report nobody asked for is not delivery, it is burial.
--    An agent that wants a person has to say which person. This is exactly
--    what notify_strategy_comment() already does for the Campaign thread
--    (20260830000006); the element side was the odd one out.
--
--    Humans are untouched: the fan-out stays owner + assignees + Domain
--    owner, widened with everyone already in the thread — "you wrote here"
--    is a better stand-in for a subscription than the container alone.
--
-- 2. Reaching done or blocked becomes a notification in its own right, of
--    the kind ('status_change') that has been declared in the client's
--    NotificationKind union since the Inbox was built and that no write path
--    has ever produced.
--
--    The trigger reads `status`, not the comment prose that describes it.
--    Grepping a body for "✔" or "■" would put the interpretation of English
--    sentences inside a SQL trigger, which is the condition ADR 0003 itself
--    names for splitting the layer apart. The state is the fact; the comment
--    is a copy of it.
--
--    Status changes keep the Domain owner in the recipient set where comments
--    now don't: the accountable human for a container wants to know the board
--    moved, and unlike a progress report the board moves rarely.
--
-- `kind` finally gets its CHECK. The client renders from a closed union and
-- until now nothing stopped a sixth value from reaching it; the constraint is
-- (re)created by name so it converges whether or not one was already there.
--
-- SECURITY DEFINER because under RLS the writing role cannot INSERT
-- notifications addressed to other users; search_path pinned. Guarded for
-- preview replay like its siblings.

do $migration$
begin
  if to_regclass('public.element_comments') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.elements') is null then
    raise notice 'inbox signal migration skipped: base tables not present';
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- kind is a closed set
  -- ---------------------------------------------------------------------
  execute 'alter table public.notifications
           drop constraint if exists notifications_kind_check';
  execute $ck$
    alter table public.notifications
      add constraint notifications_kind_check
      check (kind in (
        'mention', 'assigned', 'comment', 'status_change',
        'approval_requested', 'approval_decided', 'due_soon'
      ))
  $ck$;

  -- ---------------------------------------------------------------------
  -- Comments: an agent must name who it is talking to
  -- ---------------------------------------------------------------------
  execute $fn$
    create or replace function public.notify_element_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_element text;
      v_author  text := coalesce(nullif(new.author_name, ''), 'Someone');
    begin
      select e.title into v_element from elements e where e.id = new.element_id;
      if v_element is null then return new; end if; -- element gone; nothing to say

      -- Named people, whoever wrote the comment. For an agent this is the
      -- whole delivery path.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct m, new.author_id, new.author_name, 'mention',
             new.element_id, new.id,
             v_author || ' mentioned you in ' || v_element, left(new.content, 140)
      from unnest(new.mentions) as m
      where new.author_id is null or m <> new.author_id;

      if new.author_kind = 'ai_agent' then
        return new;
      end if;

      -- Written by a person: the users behind assigned Workers, the Element's
      -- owner, the owner of the Domain it lives in, and everyone already in
      -- the thread — minus the author and minus anyone named above.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct r.user_id, new.author_id, new.author_name, 'comment',
             new.element_id, new.id,
             v_author || ' commented on ' || v_element, left(new.content, 140)
      from (
        select w.user_id
        from element_assignees ea
        join workers w on w.id = ea.worker_id
        where ea.element_id = new.element_id and w.user_id is not null
        union
        select e.owner_id from elements e
        where e.id = new.element_id and e.owner_id is not null
        union
        select d.user_id
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        where e.id = new.element_id and d.user_id is not null
        union
        select c.author_id
        from element_comments c
        where c.element_id = new.element_id
          and c.author_kind = 'human'
          and c.author_id is not null
      ) r
      where r.user_id is not null
        and (new.author_id is null or r.user_id <> new.author_id)
        and not (r.user_id = any (new.mentions));

      return new;
    end
    $body$;
  $fn$;

  -- ---------------------------------------------------------------------
  -- Status: the board moving is the news
  -- ---------------------------------------------------------------------
  execute $fn$
    create or replace function public.notify_element_status()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_actor  uuid := auth.uid();   -- null when written by an agent / service role
      v_suffix text := case new.status when 'done' then ' is done'
                                       else ' is blocked' end;
    begin
      insert into notifications
        (recipient_id, actor_id, kind, element_id, title, body)
      select distinct r.user_id, v_actor, 'status_change',
             new.id,
             new.title || v_suffix,
             coalesce(old.status, '—') || ' → ' || new.status
      from (
        select w.user_id
        from element_assignees ea
        join workers w on w.id = ea.worker_id
        where ea.element_id = new.id and w.user_id is not null
        union
        select new.owner_id where new.owner_id is not null
        union
        select d.user_id
        from objects o
        join domains d on d.id = o.domain_id
        where o.id = new.object_id and d.user_id is not null
      ) r
      where r.user_id is not null
        and (v_actor is null or r.user_id <> v_actor);

      return new;
    end
    $body$;
  $fn$;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_element_status_notify' and c.relname = 'elements'
  ) then
    -- The WHEN clause is the filter: the trigger body never runs for an edit
    -- that isn't a move into done or blocked.
    execute $tg$
      create trigger trg_element_status_notify
      after update of status on public.elements
      for each row
      when (new.status is distinct from old.status
            and new.status in ('done', 'blocked'))
      execute function public.notify_element_status()
    $tg$;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_element_comment_notify' and c.relname = 'element_comments'
  ) then
    execute 'create trigger trg_element_comment_notify
             after insert on public.element_comments
             for each row execute function public.notify_element_comment()';
  end if;
end
$migration$;

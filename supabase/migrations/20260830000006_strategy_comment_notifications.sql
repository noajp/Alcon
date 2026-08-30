-- Campaign comments reach the Inbox, and the trigger is what guarantees it —
-- same reasoning as element comments (ADR 0003): notifications built in app
-- code are missed by every write path that isn't app code, and the path most
-- used here (an agent INSERTing over the API) is exactly that.
--
-- notifications gains strategy_id + strategy_comment_id: `comment_id`'s FK
-- points at element_comments, so a Campaign comment has nowhere to hang. The
-- `kind` CHECK needs no change — 'comment' and 'mention' are already in it.
--
-- Recipients differ from the element trigger on one point, deliberately:
--
--   an ai_agent's comment notifies only the users it names in `mentions`.
--
-- element_comments fans an agent's comment out to the container's owner, and
-- the result is an Inbox that is 54 rows of the same sentence — every one of
-- those 70 comments was written by an agent and none by a human. Broadcasting
-- a report nobody asked for is not delivery, it is burial: the one message
-- that did need a human is now indistinguishable from the noise. An agent that
-- wants a person has to say which person.
--
-- Humans keep the wider fan-out, but built from participation rather than from
-- the container alone: the Campaign's owner and whoever has already commented
-- there. "You wrote in this thread" is a better stand-in for a subscription
-- than "you own the box this lives in".
--
-- SECURITY DEFINER because under RLS the commenting role cannot INSERT
-- notifications addressed to other users; search_path pinned. Guarded for
-- preview replay like its siblings.

do $migration$
begin
  if to_regclass('public.strategy_comments') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.strategies') is null then
    raise notice 'strategy comment notifications skipped: base tables not present';
    return;
  end if;

  execute 'alter table public.notifications
           add column if not exists strategy_id uuid
           references public.strategies(id) on delete cascade';
  execute 'alter table public.notifications
           add column if not exists strategy_comment_id uuid
           references public.strategy_comments(id) on delete cascade';

  execute $fn$
    create or replace function public.notify_strategy_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_campaign text;
      v_author   text := coalesce(nullif(new.author_name, ''), 'Someone');
    begin
      select s.name into v_campaign from strategies s where s.id = new.strategy_id;
      if v_campaign is null then return new; end if; -- Campaign gone; nothing to say

      -- Named people, whoever wrote the comment. This is the whole delivery
      -- path for an agent.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, strategy_id, strategy_comment_id, title, body)
      select distinct m, new.author_id, new.author_name, 'mention',
             new.strategy_id, new.id,
             v_author || ' mentioned you in ' || v_campaign, left(new.content, 140)
      from unnest(new.mentions) as m
      where new.author_id is null or m <> new.author_id;

      if new.author_kind = 'ai_agent' then
        return new;
      end if;

      -- Written by a person: also the Campaign's owner and everyone already
      -- in the thread, minus the author and minus anyone already told above.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, strategy_id, strategy_comment_id, title, body)
      select distinct r.user_id, new.author_id, new.author_name, 'comment',
             new.strategy_id, new.id,
             v_author || ' commented on ' || v_campaign, left(new.content, 140)
      from (
        select s.created_by as user_id
        from strategies s
        where s.id = new.strategy_id and s.created_by is not null
        union
        select c.author_id
        from strategy_comments c
        where c.strategy_id = new.strategy_id
          and c.author_kind = 'human'
          and c.author_id is not null
      ) r
      where (new.author_id is null or r.user_id <> new.author_id)
        and not (r.user_id = any (new.mentions));

      return new;
    end
    $body$;
  $fn$;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_strategy_comment_notify' and c.relname = 'strategy_comments'
  ) then
    execute 'create trigger trg_strategy_comment_notify
             after insert on public.strategy_comments
             for each row execute function public.notify_strategy_comment()';
  end if;
end
$migration$;

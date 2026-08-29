-- Comments never reached the Inbox: notifications were only created by
-- in-app code paths, so a comment INSERT'd from outside (agent via API/MCP)
-- was invisible until the Element was opened. Create them in the database
-- instead — every write path notifies, present and future.
--
-- Recipients: users behind assigned Workers, the Element owner, and the
-- owner of the Domain the Element's Object belongs to (the accountable
-- human for the container — today's stand-in for a real subscription
-- model), minus the comment author.
--
-- SECURITY DEFINER: under RLS the commenting role can't INSERT
-- notifications for other users; the trigger runs as the function owner,
-- search_path pinned. Guarded for preview replay like the siblings.

do $$
begin
  if to_regclass('public.element_comments') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.elements') is null then
    raise notice 'comment notifications skipped: base tables not present';
    return;
  end if;

  execute $fn$
    create or replace function public.notify_element_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_title text;
    begin
      select coalesce(nullif(new.author_name, ''), 'Someone') || ' commented on ' || e.title
        into v_title
      from elements e where e.id = new.element_id;
      if v_title is null then return new; end if; -- element gone; nothing to say

      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct r.user_id, new.author_id, new.author_name, 'comment',
             new.element_id, new.id, v_title, left(new.content, 140)
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
      ) r
      where new.author_id is null or r.user_id <> new.author_id;

      return new;
    end
    $body$;
  $fn$;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_element_comment_notify' and c.relname = 'element_comments'
  ) then
    execute 'create trigger trg_element_comment_notify
             after insert on public.element_comments
             for each row execute function public.notify_element_comment()';
  end if;
end
$$;

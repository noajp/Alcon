-- An Element's comments, reactions and Subelements are visible to exactly
-- the people who can see the Element (user_can_see_element), like
-- element_activity already is. Until now any signed-in user could read and
-- write them across Spaces by naming an element_id.
--
-- element_comments
--   select / insert  the Element is visible; a new row is the caller's own
--                    (author_id = auth.uid()) — agents writing with a
--                    person's session (MCP, Copilot) already stamp that
--                    person; run-agent and the friction board write with the
--                    service role, which RLS does not touch
--   update           the Element is visible; the author may edit their own
--                    comment, anyone else may only pin or unpin it (trigger)
--   delete           the author only
-- element_reactions  visible through the Element or the comment it is on;
--                    each person adds and removes only their own
-- subelements        everything follows the Element's visibility
--
-- Guarded for preview replay.
do $$
begin
  if to_regclass('public.element_comments') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'comment visibility skipped: element_comments or user_can_see_element not present';
    return;
  end if;

  execute 'drop policy if exists element_comments_rw on public.element_comments';
  execute 'drop policy if exists element_comments_select on public.element_comments';
  execute 'drop policy if exists element_comments_insert on public.element_comments';
  execute 'drop policy if exists element_comments_update on public.element_comments';
  execute 'drop policy if exists element_comments_delete on public.element_comments';
  execute $p$create policy element_comments_select on public.element_comments
    for select to authenticated using (public.user_can_see_element(element_id))$p$;
  execute $p$create policy element_comments_insert on public.element_comments
    for insert to authenticated
    with check (author_id = auth.uid() and public.user_can_see_element(element_id))$p$;
  execute $p$create policy element_comments_update on public.element_comments
    for update to authenticated
    using (public.user_can_see_element(element_id))
    with check (public.user_can_see_element(element_id))$p$;
  execute $p$create policy element_comments_delete on public.element_comments
    for delete to authenticated using (author_id = auth.uid())$p$;

  -- Who wrote it, where, and when never change from a browser; someone
  -- else's comment can only be pinned or unpinned.
  execute $f$create or replace function public.element_comments_guard_update()
  returns trigger language plpgsql set search_path = public as $g$
  begin
    if auth.uid() is null then return new; end if;  -- service role
    if new.element_id is distinct from old.element_id
       or new.author_id is distinct from old.author_id
       or new.author_kind is distinct from old.author_kind
       or new.author_name is distinct from old.author_name
       or new.holder is distinct from old.holder
       or new.created_at is distinct from old.created_at then
      raise exception 'a comment''s author, Element and time cannot be changed' using errcode = '42501';
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
  execute 'drop trigger if exists trg_element_comments_guard_update on public.element_comments';
  execute 'create trigger trg_element_comments_guard_update before update on public.element_comments
    for each row execute function public.element_comments_guard_update()';

  if to_regclass('public.element_reactions') is not null then
    execute 'drop policy if exists element_reactions_rw on public.element_reactions';
    execute 'drop policy if exists element_reactions_select on public.element_reactions';
    execute 'drop policy if exists element_reactions_insert on public.element_reactions';
    execute 'drop policy if exists element_reactions_delete on public.element_reactions';
    execute $p$create policy element_reactions_select on public.element_reactions
      for select to authenticated using (
        case when element_id is not null then public.user_can_see_element(element_id)
             else exists (select 1 from public.element_comments c where c.id = comment_id) end)$p$;
    execute $p$create policy element_reactions_insert on public.element_reactions
      for insert to authenticated with check (
        user_id = auth.uid() and
        case when element_id is not null then public.user_can_see_element(element_id)
             else exists (select 1 from public.element_comments c where c.id = comment_id) end)$p$;
    execute $p$create policy element_reactions_delete on public.element_reactions
      for delete to authenticated using (user_id = auth.uid())$p$;
  end if;

  if to_regclass('public.subelements') is not null then
    execute 'drop policy if exists "Authenticated full access" on public.subelements';
    execute 'drop policy if exists subelements_follow_element on public.subelements';
    execute $p$create policy subelements_follow_element on public.subelements
      for all to authenticated
      using (public.user_can_see_element(element_id))
      with check (public.user_can_see_element(element_id))$p$;
  end if;
end
$$;

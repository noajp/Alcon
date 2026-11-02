-- element_objects and elements.object_id describe the same thing — where an
-- Element lives, with object_id as its primary home — but only one direction
-- was kept: changing elements.object_id rewrites the junction (trigger
-- sync_element_primary_object), while changing the junction left object_id
-- behind. Now:
--   * at most one primary row per Element (partial unique index);
--   * marking a row primary moves elements.object_id there; the old primary
--     stays as a secondary home;
--   * the primary row cannot be deleted on its own: deleting it would leave
--     object_id pointing at an Object the junction no longer records, and
--     deleting an Element's only home would leave it with none. Move the
--     Element (update elements.object_id) first; the trigger then removes
--     the old primary row itself.
-- Writes the elements trigger makes (pg_trigger_depth() > 1) pass through.
do $mig$
begin
  if to_regclass('public.element_objects') is null or to_regclass('public.elements') is null then
    raise notice 'element_objects_both_ways skipped: base schema not present'; return;
  end if;

  execute 'create unique index if not exists element_objects_one_primary
    on public.element_objects (element_id) where is_primary';

  execute $f$
    create or replace function public.element_objects_follow_primary()
    returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
    begin
      if pg_trigger_depth() > 1 then
        return coalesce(new, old);
      end if;
      if tg_op = 'DELETE' then
        if old.is_primary and exists (
          select 1 from public.elements e where e.id = old.element_id and e.object_id = old.object_id
        ) then
          raise exception 'move the Element to another Object before removing its primary home'
            using errcode = '23514';
        end if;
        return old;
      end if;
      -- INSERT / UPDATE marking this row primary. Before the write, the
      -- other primary steps down (it stays as a secondary home) so the
      -- unique index holds; after it, the Element moves here.
      if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
        if tg_when = 'BEFORE' then
          update public.element_objects set is_primary = false
           where element_id = new.element_id and is_primary and id is distinct from new.id;
        else
          update public.elements set object_id = new.object_id
           where id = new.element_id and object_id is distinct from new.object_id;
        end if;
      end if;
      return new;
    end;
    $b$
  $f$;
  execute 'revoke execute on function public.element_objects_follow_primary() from public, anon, authenticated';

  execute 'drop trigger if exists element_objects_guard_primary on public.element_objects';
  execute 'create trigger element_objects_guard_primary
    before insert or update of is_primary or delete on public.element_objects
    for each row execute function public.element_objects_follow_primary()';
  execute 'drop trigger if exists element_objects_follow_primary on public.element_objects';
  execute 'create trigger element_objects_follow_primary
    after insert or update of is_primary on public.element_objects
    for each row execute function public.element_objects_follow_primary()';
end $mig$;

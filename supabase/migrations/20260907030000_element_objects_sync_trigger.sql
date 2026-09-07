-- elements.object_id and the element_objects junction are one fact written
-- twice, and until now only the app wrote both. A row inserted by SQL with
-- an object_id and no junction row is invisible to every list — that
-- happened on 2026-08-30, and seven such rows were still on the board when
-- this landed (five real Elements, two cancelled duplicates).
--
-- The trigger makes the invariant the database's: whenever an Element gains
-- or changes its primary Object, the junction row exists. It only adds —
-- a changed object_id does not remove the old junction row, because an
-- Element may deliberately live in several Objects (multi-homing) and the
-- junction, not object_id, is the record of that. The same statement
-- backfills the rows the invariant had already failed for.
-- Guarded for preview/shadow-DB replay.
do $m$
begin
  if to_regclass('public.elements') is null or to_regclass('public.element_objects') is null then
    raise notice 'element_objects sync skipped: tables not present'; return;
  end if;

  execute $fn$
    create or replace function public.sync_element_primary_object()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    begin
      if new.object_id is not null then
        insert into element_objects (element_id, object_id, is_primary)
        values (new.id, new.object_id, true)
        on conflict (element_id, object_id) do nothing;
      end if;
      return new;
    end
    $body$
  $fn$;
  execute $trg$ drop trigger if exists trg_element_primary_object on public.elements $trg$;
  execute $trg$
    create trigger trg_element_primary_object
      after insert or update of object_id on public.elements
      for each row when (new.object_id is not null)
      execute function public.sync_element_primary_object()
  $trg$;

  -- The rows the invariant already failed for: an Element whose object_id
  -- names an Object it has no junction row with is invisible to every list.
  execute $sql$
    insert into element_objects (element_id, object_id, is_primary)
    select e.id, e.object_id, true
      from elements e
     where e.object_id is not null
       and not exists (select 1 from element_objects eo where eo.element_id = e.id and eo.object_id = e.object_id)
    on conflict (element_id, object_id) do nothing
  $sql$;
end
$m$;

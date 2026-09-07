-- Two ways a primary junction row could go missing are closed here. The
-- trigger now also fires when object_id is cleared, dropping the old primary
-- row so the Element appears directly under its Domain (get_explorer_data's
-- rootElements requires zero junction rows). And every Element whose
-- junction row matching elements.object_id lacked is_primary is repaired.
-- Idempotent; safe to replay.
do $m$
begin
  if to_regclass('public.elements') is null or to_regclass('public.element_objects') is null then
    raise notice 'element primary sync skipped: tables not present'; return;
  end if;

  execute $f$
    create or replace function public.sync_element_primary_object()
    returns trigger language plpgsql security definer set search_path = public as $$
    begin
      -- object_id cleared: the Element now lives directly under its Domain.
      -- The row that recorded the old primary home goes; homes it was given
      -- besides (is_primary false) stay, the junction being their record.
      if new.object_id is null then
        if tg_op = 'UPDATE' and old.object_id is not null then
          delete from element_objects
           where element_id = new.id and object_id = old.object_id and is_primary;
        end if;
        return new;
      end if;
      -- A changed object_id is a move: the Element leaves the Object that was
      -- its primary home. Homes it was deliberately given besides stay.
      if tg_op = 'UPDATE' and old.object_id is distinct from new.object_id and old.object_id is not null then
        delete from element_objects
         where element_id = new.id and object_id = old.object_id and is_primary;
      end if;
      -- Exactly one primary: whatever else was marked primary steps down.
      update element_objects set is_primary = false
       where element_id = new.id and object_id <> new.object_id and is_primary;
      insert into element_objects (element_id, object_id, is_primary)
      values (new.id, new.object_id, true)
      on conflict (element_id, object_id) do update set is_primary = true;
      return new;
    end
    $$;
  $f$;

  -- The trigger must also fire when object_id becomes null.
  execute 'drop trigger if exists trg_element_primary_object on public.elements';
  execute $t$
    create trigger trg_element_primary_object
      after insert or update of object_id on public.elements
      for each row execute function public.sync_element_primary_object()
  $t$;

  -- Backfill: the junction row that matches elements.object_id is the primary.
  execute $b$
    update element_objects eo set is_primary = true
      from elements e
     where eo.element_id = e.id and eo.object_id = e.object_id and not eo.is_primary
  $b$;
  execute $b$
    insert into element_objects (element_id, object_id, is_primary)
    select e.id, e.object_id, true from elements e
     where e.object_id is not null
       and not exists (select 1 from element_objects eo where eo.element_id = e.id and eo.object_id = e.object_id)
    on conflict do nothing
  $b$;
end
$m$;

-- Being added to an Element, or made Lead of an Object, notifies that person.
--
-- Element: 20260904160000_element_assignment_notification.sql defined this
-- trigger but was never applied to the live database (no `assigned`
-- notification had ever been written), so it is defined again here, the same.
--
-- Object: being made Lead of an Object (the Lead set in a Strategy's Objects list,
-- or on the Object itself) notifies that person, as being added to an
-- Element does: kind `assigned`, pointing at the Object, so the Inbox opens
-- it and the person's email choice for assignments covers it too.
--
-- The recipient is the user behind the new Lead Worker — none for an AI
-- Worker or a person not yet invited. Making yourself Lead says nothing.
do $migration$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.notifications') is null then
    raise notice 'object lead notification skipped: base tables not present';
    return;
  end if;

  if to_regclass('public.element_assignees') is not null and to_regclass('public.elements') is not null then
    execute $fn$
      create or replace function public.notify_element_assignment()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_recipient uuid;
        v_actor     uuid := auth.uid();
        v_title     text;
      begin
        -- Restoring a deleted Element puts its people back; nobody is newly assigned.
        if public.alcon_restoring() then return new; end if;
        select user_id into v_recipient from workers where id = new.worker_id;
        if v_recipient is null then return new; end if;
        if v_actor is not null and v_recipient = v_actor then return new; end if;
        select title into v_title from elements where id = new.element_id;
        if v_title is null then return new; end if;
        insert into notifications (recipient_id, actor_id, kind, element_id, title)
        values (v_recipient, v_actor, 'assigned', new.element_id, 'You were added to ' || v_title);
        return new;
      end
      $body$;
    $fn$;
    execute 'revoke all on function public.notify_element_assignment() from public, anon, authenticated';
    execute 'drop trigger if exists trg_element_assignee_notify on public.element_assignees';
    execute 'create trigger trg_element_assignee_notify
             after insert on public.element_assignees
             for each row execute function public.notify_element_assignment()';
  end if;

  execute $fn$
    create or replace function public.notify_object_lead()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_recipient uuid;
      v_actor     uuid := auth.uid();
    begin
      if public.alcon_restoring() then return new; end if;
      if new.lead_id is null then return new; end if;
      if tg_op = 'UPDATE' and new.lead_id is not distinct from old.lead_id then return new; end if;
      select user_id into v_recipient from workers where id = new.lead_id;
      if v_recipient is null then return new; end if;
      if v_actor is not null and v_recipient = v_actor then return new; end if;

      insert into notifications (recipient_id, actor_id, kind, object_id, title)
      values (v_recipient, v_actor, 'assigned', new.id, 'You were made Lead of ' || new.name);
      return new;
    end
    $body$;
  $fn$;
  execute 'revoke all on function public.notify_object_lead() from public, anon, authenticated';

  execute 'drop trigger if exists trg_object_lead_notify on public.objects';
  execute 'create trigger trg_object_lead_notify
           after insert or update of lead_id on public.objects
           for each row execute function public.notify_object_lead()';
end
$migration$;

-- The Inbox reads as "only Agent comments" because two of NotificationKind's
-- seven kinds have never had a write path (confirmed live: kind counts on
-- production are comment 374, mention 25, approval_requested 4,
-- approval_decided 2 — assigned and status_change sit at zero), and a third
-- (status_change) has a write path sitting in this repo
-- (20260831000001_inbox_carries_board_changes.sql) that isn't actually
-- attached in production: notifications_kind_check is live (confirmed by
-- probing an insert with a bogus kind), but list_table_triggers('elements')
-- shows only trg_element_display_id — trg_element_status_notify was never
-- created. Re-applying that file (it's idempotent — create-or-replace
-- functions, drop-then-add the constraint, guarded trigger creation) closes
-- that half; this migration closes the other half, `assigned`, which has no
-- function or trigger anywhere in this repo's history at all.
--
-- Same shape as notify_element_status: SECURITY DEFINER (under RLS the
-- writing role can't insert a notification addressed to someone else),
-- search_path pinned, guarded for preview replay.
--
-- Recipients: whoever the newly-inserted element_assignees row points at,
-- via workers.user_id — null for a Worker with no account (an ai_agent, or
-- a human not yet invited), which is also how el_QLT-008's "unreachable"
-- concept works elsewhere; nothing to notify, so skip rather than error.
-- Self-assignment (the acting user assigning themselves) is skipped too —
-- v_actor is null when the writer is an agent/service role, so that guard
-- only applies to a real authenticated session assigning themselves.
--
-- One notification per row inserted, regardless of role (assignee/reviewer/
-- collaborator) — "you were added to this Element" is true for all three,
-- and branching the wording per role is complexity this feature doesn't
-- need yet.
do $migration$
begin
  if to_regclass('public.element_assignees') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.notifications') is null then
    raise notice 'element assignment notification migration skipped: base tables not present';
    return;
  end if;

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
      select user_id into v_recipient from workers where id = new.worker_id;
      if v_recipient is null then return new; end if;
      if v_actor is not null and v_recipient = v_actor then return new; end if;

      select title into v_title from elements where id = new.element_id;
      if v_title is null then return new; end if;

      insert into notifications
        (recipient_id, actor_id, kind, element_id, title)
      values
        (v_recipient, v_actor, 'assigned', new.element_id,
         'You were added to ' || v_title);

      return new;
    end
    $body$;
  $fn$;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_element_assignee_notify' and c.relname = 'element_assignees'
  ) then
    execute 'create trigger trg_element_assignee_notify
             after insert on public.element_assignees
             for each row execute function public.notify_element_assignment()';
  end if;
end
$migration$;

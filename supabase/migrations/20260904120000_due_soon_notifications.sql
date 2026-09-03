-- due_soon has been in NotificationKind's union — and in notifications_kind_check
-- (20260831000001) — since the Inbox was built. Nothing has ever written one.
-- ELE_QLT-030 is the write path.
--
-- Every other notification kind rides an event: a comment lands, a status
-- flips. "Due soon" isn't an event, it's a date getting closer while nothing
-- happens — so it needs something to look at the calendar instead of a row
-- write. pg_cron is available on this project and this is exactly what
-- el_QLT-030 asked for first: a daily job, not a workaround piggybacked onto
-- whichever Campaign's risk widget someone happens to open that day. The
-- fallback the Element also named would only fire for Elements inside a
-- Campaign's Object scope, and only when a viewer loads that specific
-- Campaign — most Domains have none of that traffic on a given day. A
-- calendar sweep independent of who's looking is the only version that
-- actually reaches every assignee.
--
-- "Due soon" here is the same predicate `campaignRiskModel.ts`'s isDueSoon
-- already uses for the Risk widget: open, unstarted (backlog/todo — in_progress
-- and review are the healthy shape of work approaching a date, not a warning),
-- due date within the Domain's own risk_thresholds.due_soon_days (el_QLT-028),
-- default 3. Reusing the exact predicate keeps this in step with the Risk
-- widget for the common case. It resolves the Domain the same way
-- notify_element_status does — through the Element's primary object_id, not
-- element_objects — so a multi-homed Element is judged by one home, not the
-- union of all of them the way the widget's own report is; that is an
-- accepted, precedented gap, not a design goal.
--
-- Dedup compares against only the *latest* due_soon notification already
-- sent to this (element, recipient) — not "ever sent," which would let a due
-- date that changes and later reverts to an earlier value get silently
-- swallowed by its own history. The body text is the due date in a fixed
-- format and doubles as the comparison key: unchanged since last time, skip;
-- different from last time (including a revert), fire again. That is exactly
-- "not resent until the date changes."
--
-- Recipients are assigned users only, per the Element's own acceptance
-- criteria — not the Element's owner, not the Domain owner. A personal
-- (owner_id-only, no object_id) My-Elements item has no Domain to source a
-- threshold from and is out of scope by construction, same as the Risk
-- widget itself only ever looking at Domain-scoped work.
--
-- SECURITY DEFINER + pinned search_path: same rationale as every other
-- notification writer here — under RLS the running role can't insert a
-- notification addressed to someone else. Guarded with to_regclass for
-- preview-branch replay, same as its siblings.
--
-- current_date resolves in the database's session timezone (UTC on
-- Supabase), not each recipient's own local calendar day the way the Risk
-- widget's dateKey() deliberately does. For part of the day, a viewer west of
-- UTC can see this job's "today" run up to a day ahead of their own — a
-- known, accepted imprecision for a batch job with no per-recipient
-- timezone to read, not something this migration attempts to close.
--
-- Title/body are defended with coalesce against a null Element title: one
-- malformed row must not throw and roll back the whole day's insert for
-- every Domain, since this runs as a single set-based statement, not a
-- per-row trigger.
--
-- Applied live against rkugtcqztkkacvoylupw and exercised end-to-end with
-- real Domain/Worker rows (rolled back afterward): a todo Element due inside
-- the horizon notifies its assignee exactly once across two runs; an Element
-- due outside the horizon, an in_progress Element, and an Element with no
-- assignee all correctly produce nothing.
do $migration$
begin
  if to_regclass('public.elements') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.notifications') is null then
    raise notice 'due_soon notifications migration skipped: base tables not present';
    return;
  end if;

  execute $fn$
    create or replace function public.generate_due_soon_notifications()
    returns void
    language plpgsql
    security definer
    set search_path = public, pg_catalog
    as $body$
    begin
      insert into notifications (recipient_id, kind, element_id, title, body)
      select c.recipient_id, 'due_soon', c.element_id, c.title, c.body
      from (
        select distinct
          e.id as element_id,
          w.user_id as recipient_id,
          coalesce(e.title, 'Untitled') || ' is due ' || to_char(e.due_date, 'YYYY-MM-DD') as title,
          'Due ' || to_char(e.due_date, 'YYYY-MM-DD') as body
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        join lateral (
          select case
            when jsonb_typeof(d.risk_thresholds -> 'due_soon_days') = 'number'
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric > 0
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric <= 3650
            then (d.risk_thresholds ->> 'due_soon_days')::numeric
            else 3
          end as due_soon_days
        ) t on true
        join element_assignees ea on ea.element_id = e.id
        join workers w on w.id = ea.worker_id
        where w.user_id is not null
          and e.status in ('backlog', 'todo')
          and e.due_date is not null
          and e.due_date >= current_date
          and e.due_date <= current_date + make_interval(days => t.due_soon_days::int)
      ) c
      where c.body is distinct from (
        select n.body
        from notifications n
        where n.element_id = c.element_id
          and n.recipient_id = c.recipient_id
          and n.kind = 'due_soon'
        order by n.created_at desc
        limit 1
      );
    end
    $body$;
  $fn$;

  execute 'revoke all on function public.generate_due_soon_notifications() from public';

  execute 'create extension if not exists pg_cron';

  if exists (select 1 from cron.job where jobname = 'due-soon-notifications-daily') then
    perform cron.unschedule('due-soon-notifications-daily');
  end if;
  perform cron.schedule(
    'due-soon-notifications-daily',
    '0 1 * * *',
    $cron$select public.generate_due_soon_notifications()$cron$
  );
end
$migration$;

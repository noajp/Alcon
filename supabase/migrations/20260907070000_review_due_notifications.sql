-- A decision carries the day it should be looked at again (`intents.horizon`),
-- and until now nothing said so out loud. The Initiative's Decisions section
-- marks an unanswered horizon as overdue, but only for whoever opens that
-- Initiative; the day itself passed in silence for the person who made the
-- decision. In the exercise that produced this, the review happened because a
-- human remembered — and the thing it found (a 24-hour gap between supply
-- running out and transport arriving) was the most valuable line in the plan.
--
-- Modelled on generate_due_soon_notifications: a date getting closer is not an
-- event, so it needs a calendar sweep rather than a row trigger, and a sweep
-- that runs whether or not anyone opens the Initiative that day.
--
-- Owed, not merely past: a decision reviewed on or after its horizon is
-- answered and says nothing. That mirrors reviewState() in
-- initiativeDecisionModel.ts, which treats a review dated on or after the
-- horizon as the horizon having been met. A review is an intent_lineage row
-- with action_kind 'revision' (initiativeReviewModel.ts writes exactly that).
--
-- Recipients are the person who recorded the decision and the Initiative's
-- owner — the two people who can act on it. Both come from created_by, so a
-- decision written by someone since removed simply notifies the owner.
--
-- Dedup follows due_soon's rule and its reason: compare against the latest
-- notification of this kind for this recipient AND this decision, not "ever
-- sent". The decision's id is in the body next to the horizon, which makes the
-- body both the dedup key and the reason it changed — a horizon moved and then
-- moved back still notifies again.
--
-- current_date is the database's day (UTC on Supabase), not each recipient's
-- own — the same accepted imprecision the due_soon sweep carries.
do $migration$
begin
  if to_regclass('public.intents') is null
     or to_regclass('public.intent_lineage') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.notifications') is null then
    raise notice 'review_due notifications migration skipped: base tables not present';
    return;
  end if;

  -- 'review_due' joins the kinds the Inbox accepts. Rebuilt rather than
  -- altered: the constraint is a list, and restating it whole is the only
  -- form that reads as the list.
  if exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check') then
    execute 'alter table public.notifications drop constraint notifications_kind_check';
  end if;
  execute $chk$
    alter table public.notifications add constraint notifications_kind_check
      check (kind = any (array['mention','assigned','comment','status_change','approval_requested','approval_decided','due_soon','review_due']))
  $chk$;

  execute $fn$
    create or replace function public.generate_review_due_notifications()
    returns void
    language plpgsql
    security definer
    set search_path = public, pg_catalog
    as $body$
    begin
      insert into notifications (recipient_id, kind, strategy_id, title, body)
      select c.recipient_id, 'review_due', c.strategy_id, c.title, c.body
      from (
        select distinct
          i.id as intent_id,
          i.strategy_id,
          r.recipient_id,
          coalesce(i.title, 'Untitled decision') || ' is due for review' as title,
          'Review due ' || to_char(i.horizon, 'YYYY-MM-DD') || ' · ' || i.id::text as body
        from intents i
        join strategies s on s.id = i.strategy_id
        cross join lateral (values (i.created_by), (s.created_by)) as r(recipient_id)
        where i.kind = 'decision'
          and i.horizon is not null
          and i.horizon <= current_date
          and r.recipient_id is not null
          and not exists (
            select 1 from intent_lineage l
            where l.intent_id = i.id
              and l.action_kind = 'revision'
              and (l.occurred_at at time zone 'UTC')::date >= i.horizon
          )
      ) c
      where c.body is distinct from (
        select n.body
        from notifications n
        where n.recipient_id = c.recipient_id
          and n.kind = 'review_due'
          and n.strategy_id is not distinct from c.strategy_id
          and n.body like '%' || c.intent_id::text
        order by n.created_at desc
        limit 1
      );
    end
    $body$;
  $fn$;

  execute 'revoke all on function public.generate_review_due_notifications() from public';

  execute 'create extension if not exists pg_cron';

  if exists (select 1 from cron.job where jobname = 'review-due-notifications-daily') then
    perform cron.unschedule('review-due-notifications-daily');
  end if;
  -- An hour after the due_soon sweep, so two set-based writes never contend
  -- for the same notifications pages.
  perform cron.schedule(
    'review-due-notifications-daily',
    '0 2 * * *',
    $cron$select public.generate_review_due_notifications()$cron$
  );
end
$migration$;

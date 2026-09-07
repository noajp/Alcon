-- A decision carries the day it should be looked at again (`intents.horizon`),
-- and until now only whoever opened that Initiative could see the day had
-- passed. In the exercise that produced this, the review happened because a
-- person remembered — and what it found (a 24-hour gap between supply running
-- out and transport arriving) was the most valuable line in the plan.
--
-- Modelled on generate_due_soon_notifications: a date arriving is not an
-- event, so it needs a calendar sweep rather than a row trigger, and one that
-- runs whether or not anyone opens the Initiative that day.
--
-- Still in force, and owed. `isDueForReview` in initiativeDecisionModel.ts is
-- `status <> 'done' and the horizon has arrived`, and this matches it: a
-- decision closed as done is not waiting on anyone. Answered means a review —
-- an intent_lineage row with action_kind 'revision', which is what
-- initiativeReviewModel.ts writes — dated on or after the horizon.
--
-- The date comparison carries a day of slack, and that direction is chosen.
-- The sweep reads UTC; the Decisions section reads the viewer's own calendar
-- (answeredOnOrAfter). A reviewer in Tokyo answering at 08:00 on the horizon
-- has done it at 23:00 UTC the day before, and a strict UTC compare would
-- notify someone the surface already shows as reviewed — the Inbox
-- contradicting the page it links to. Erring the other way costs a reminder
-- to someone who reviewed a day early, which is a person who has already
-- looked at the decision.
--
-- Recipients are the person who recorded the decision and the Initiative's
-- owner — the two who can act on it. `intents.created_by` carries no foreign
-- key, so a deleted user leaves a dangling uuid behind; the join to auth.users
-- is what keeps one such row from failing the whole day's insert for everyone,
-- since this is a single set-based statement.
--
-- `notifications.intent_id` is what makes a notification about a decision
-- addressable: the dedup key belongs in a column, not smuggled through the
-- text a person reads. Dedup follows the due_soon rule — compare against the
-- latest of this kind for this recipient and this decision, not "ever sent" —
-- so a horizon that moves and moves back still notifies again.
do $migration$
begin
  if to_regclass('public.intents') is null
     or to_regclass('public.intent_lineage') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.notifications') is null then
    raise notice 'review_due notifications migration skipped: base tables not present';
    return;
  end if;

  execute 'alter table public.notifications add column if not exists intent_id uuid references public.intents(id) on delete cascade';
  execute 'create index if not exists idx_notifications_intent on public.notifications (recipient_id, intent_id, created_at desc)';

  -- 'review_due' joins the kinds the Inbox accepts. The list is restated whole
  -- because it is a list; the new value is a superset, so no existing row can
  -- fail the rebuilt constraint.
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
      insert into notifications (recipient_id, kind, strategy_id, intent_id, title, body)
      select c.recipient_id, 'review_due', c.strategy_id, c.intent_id, c.title, c.body
      from (
        select distinct
          i.id as intent_id,
          i.strategy_id,
          r.recipient_id,
          coalesce(i.title, 'Untitled decision') || ' is due for review' as title,
          'Review due ' || to_char(i.horizon, 'YYYY-MM-DD') as body
        from intents i
        join strategies s on s.id = i.strategy_id
        cross join lateral (values (i.created_by), (s.created_by)) as r(recipient_id)
        join auth.users u on u.id = r.recipient_id
        where i.kind = 'decision'
          and i.horizon is not null
          and i.horizon <= current_date
          and coalesce(i.status, '') <> 'done'
          and i.abandoned is null
          and not exists (
            select 1 from intent_lineage l
            where l.intent_id = i.id
              and l.action_kind = 'revision'
              and (l.occurred_at at time zone 'UTC')::date >= i.horizon - 1
          )
      ) c
      where c.body is distinct from (
        select n.body
        from notifications n
        where n.recipient_id = c.recipient_id
          and n.kind = 'review_due'
          and n.intent_id = c.intent_id
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

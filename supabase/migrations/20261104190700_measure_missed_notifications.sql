-- A success condition that stops being met reaches the Initiative's owner
-- through the Inbox (ELE_OBJ2-007).
--
-- Until now a measure could go from met to missed — a CRM stage moving, an
-- agent reporting a number, somebody typing this week's reading — and the
-- only person who would know was whoever next opened that Initiative.
-- "Ask a person when the premise no longer holds" only held when the person
-- happened to look.
--
-- One AFTER INSERT trigger on intent_measure_readings decides it. Every
-- change to a measure's value already lands there (ELE_OBJ2-005), whoever
-- wrote it, so no writer can skip the check. Each row carries the value, the
-- value it replaced, and the target / direction in force at that moment, so
-- the transition is judged from the row alone:
--
--   state(previous_value) in (met, unmeasured)  and  state(value) = missed
--
-- The judgement mirrors measureState in initiativeMeasureModel.ts exactly,
-- and is three-valued on purpose: no target or no direction is unstated and
-- never notifies; no reading (or a non-finite one) is unmeasured, which is
-- not a miss; only a reading on the wrong side of the target is missed.
-- 'at_most' means actual <= target and every other direction means
-- actual >= target, as meetsTarget has it. Both values are judged against the
-- row's own target snapshot, so the question is always "did this reading
-- turn the condition, as it stands now, from not-failing to failing".
--
-- Changing only the target or the direction does not notify. intents'
-- reading trigger fires on actual_value / measured_at, and is left that way:
-- rewriting the condition is not a reading, and putting such rows in the
-- history would make it say a number was read when none was. The person who
-- moves a target is looking at the Measures section as they do it, which
-- shows the miss. The next reading after such a change is judged against the
-- new target for both its previous and its new value, so it does not
-- re-announce a miss the target change already caused.
--
-- `source` is a label for people reading the history, not an authorization
-- claim, and plays no part here: a value written by an AI agent, by the CRM
-- binding, by Copilot or by hand is judged the same way.
--
-- Recipient is the Initiative's owner, strategies.created_by — the same
-- person generate_review_due_notifications treats as the owner. The join to
-- auth.users skips a dangling uuid (strategies.created_by carries no foreign
-- key). A muted kind is dropped by filter_muted_notification, as for every
-- other kind.
--
-- Dedup: while an earlier measure_missed for the same measure is still unread
-- (and not archived), another one is not added. Lowering the value further is
-- missed -> missed and never notifies anyway; this covers a measure that
-- flaps missed -> met -> missed before the owner has looked.
--
-- intent_escalations is not written. It was laid down for divergence / audit
-- drops with an awaiting -> decided workflow, but no surface reads it today
-- (strategyData loads it and nothing renders it), its trigger_kind check has
-- no measure kind, and an escalation nobody can see or close would only
-- accumulate as 'awaiting'. The notification is the part a person acts on.
--
-- The text is built to read in any language: the title is the condition as
-- its author wrote it, the body is numbers and symbols plus the Initiative's
-- name — `62% (≥ 80%) · Accreditation review` — and the kind's label
-- ("Success condition missed") is translated in the Inbox. Values follow
-- formatMeasureValue: a unit starting with a Latin letter takes a space.
--
-- Guarded for preview replay: intents, strategies and notifications are
-- created outside this folder, and intent_measure_readings depends on them.
do $migration$
begin
  if to_regclass('public.intent_measure_readings') is null
     or to_regclass('public.intents') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.notifications') is null then
    raise notice 'measure_missed notifications skipped: base tables not present';
    return;
  end if;

  -- 'measure_missed' joins the kinds the Inbox accepts. The list is restated
  -- whole; it is a superset, so no existing row fails the rebuilt constraint.
  execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
    ''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'',
    ''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced'',
    ''measure_missed''
  ]::text[]))';

  -- measureState, in SQL. Immutable and pure: same inputs, same answer.
  execute $ddl$
    create or replace function public.intent_measure_state(p_value numeric, p_target numeric, p_direction text)
    returns text
    language sql
    immutable
    set search_path = pg_catalog
    as $fn$
      select case
        when p_target is null or p_target::text in ('NaN', 'Infinity', '-Infinity') or p_direction is null
          then 'unstated'
        when p_value is null or p_value::text in ('NaN', 'Infinity', '-Infinity')
          then 'unmeasured'
        when (case when p_direction = 'at_most' then p_value <= p_target else p_value >= p_target end)
          then 'met'
        else 'missed'
      end
    $fn$
  $ddl$;

  -- formatMeasureValue, in SQL.
  execute $ddl$
    create or replace function public.intent_measure_format(p_value numeric, p_unit text)
    returns text
    language sql
    immutable
    set search_path = pg_catalog
    as $fn$
      select case
        when nullif(btrim(coalesce(p_unit, '')), '') is null then trim_scale(p_value)::text
        when btrim(p_unit) ~ '^[A-Za-z]' then trim_scale(p_value)::text || ' ' || btrim(p_unit)
        else trim_scale(p_value)::text || btrim(p_unit)
      end
    $fn$
  $ddl$;

  execute $ddl$
    create or replace function public.notify_measure_missed() returns trigger
    language plpgsql security definer set search_path = public, pg_catalog as $fn$
    declare
      v_title text;
      v_strategy uuid;
      v_strategy_name text;
      v_owner uuid;
    begin
      if public.intent_measure_state(new.value, new.target_value, new.direction) <> 'missed' then
        return new;
      end if;
      if public.intent_measure_state(new.previous_value, new.target_value, new.direction) = 'missed' then
        return new;
      end if;

      select i.title, i.strategy_id, s.name, s.created_by
        into v_title, v_strategy, v_strategy_name, v_owner
        from public.intents i
        join public.strategies s on s.id = i.strategy_id
        where i.id = new.intent_id and i.kind = 'measure';
      if v_owner is null or not exists (select 1 from auth.users u where u.id = v_owner) then
        return new;
      end if;
      -- The owner who entered the reading is looking at it; telling them
      -- would also leave an unread row that silences the next real alert.
      if new.recorded_by is not null and new.recorded_by = v_owner then
        return new;
      end if;

      if exists (
        select 1 from public.notifications n
        where n.recipient_id = v_owner
          and n.kind = 'measure_missed'
          and n.intent_id = new.intent_id
          and not n.is_read
          and not n.is_archived
      ) then
        return new;
      end if;

      insert into public.notifications
        (recipient_id, actor_id, actor_name, kind, strategy_id, intent_id, title, body)
      values (
        v_owner, new.recorded_by, new.recorded_by_name, 'measure_missed', v_strategy, new.intent_id,
        coalesce(nullif(btrim(v_title), ''), 'Untitled condition'),
        public.intent_measure_format(new.value, new.unit)
          || ' (' || case when new.direction = 'at_most' then '≤' else '≥' end || ' '
          || public.intent_measure_format(new.target_value, new.unit) || ')'
          || coalesce(' · ' || nullif(btrim(v_strategy_name), ''), '')
      );
      return new;
    end $fn$
  $ddl$;
  execute 'revoke execute on function public.notify_measure_missed() from public, anon, authenticated';

  execute 'drop trigger if exists intent_measure_readings_notify_missed on public.intent_measure_readings';
  execute 'create trigger intent_measure_readings_notify_missed after insert on public.intent_measure_readings
             for each row execute function public.notify_measure_missed()';
end $migration$;

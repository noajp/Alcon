-- The seven tables that hang off an intent (lineage, audits, predictions,
-- resources, alignments, escalations, next actions) follow the same rule as
-- intents themselves (ADR 0022): anyone who can see the Initiative can read
-- them, and only the Initiative's owner can write them. Before this, a
-- viewer could read a decision but not its reviews, so a reviewed decision
-- looked overdue to everyone but its author.
do $m$
declare t text;
begin
  if to_regclass('public.intents') is null
     or to_regprocedure('public.user_can_see_strategy(uuid)') is null
     or to_regprocedure('public.user_owns_intent(uuid)') is null then
    raise notice 'intent family visibility skipped: dependencies not present'; return;
  end if;
  foreach t in array array['intent_lineage','intent_audits','intent_predictions','intent_resources','intent_alignments','intent_escalations','intent_next_actions'] loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$
      create policy %I on public.%I
        for select using (exists (select 1 from public.intents i where i.id = %I.intent_id and public.user_can_see_strategy(i.strategy_id)))
    $p$, t || '_select', t, t);
    execute format($p$
      create policy %I on public.%I
        for all using (public.user_owns_intent(intent_id)) with check (public.user_owns_intent(intent_id))
    $p$, t || '_write', t);
  end loop;
end
$m$;

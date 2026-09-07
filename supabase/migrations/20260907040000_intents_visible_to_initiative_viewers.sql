-- Intents follow their Initiative's visibility; writing them stays with its owner.
--
-- el_STR-008 let a Space member see an Initiative through its Objects, but
-- intents and intent_bindings kept a single owner-only ALL policy — so a
-- viewer opened an Initiative and found Measures, Decisions and Assumptions
-- empty. Not read-only: absent. Worse, every widget then offered its empty-
-- state composer, whose first submit the database refused (ELE_STR-025).
--
-- SELECT now reads through user_can_see_strategy(), the same predicate the
-- strategies SELECT uses, so a viewer sees the Initiative and its intent
-- together or not at all. INSERT / UPDATE / DELETE keep the owner test they
-- had. Guarded for preview/shadow-DB replay; ADR 0022.
do $m$
begin
  if to_regclass('public.intents') is null or to_regclass('public.intent_bindings') is null
     or to_regprocedure('public.user_can_see_strategy(uuid)') is null
     or to_regprocedure('public.user_owns_intent(uuid)') is null then
    raise notice 'intents visibility skipped: dependencies not present'; return;
  end if;

  execute 'drop policy if exists intents_all on public.intents';
  execute 'drop policy if exists intents_select on public.intents';
  execute 'drop policy if exists intents_write on public.intents';
  execute $p$
    create policy intents_select on public.intents
      for select using (public.user_can_see_strategy(strategy_id))
  $p$;
  execute $p$
    create policy intents_write on public.intents
      for all using (exists (select 1 from public.strategies s where s.id = intents.strategy_id and s.created_by = auth.uid()))
      with check (exists (select 1 from public.strategies s where s.id = intents.strategy_id and s.created_by = auth.uid()))
  $p$;

  execute 'drop policy if exists intent_bindings_all on public.intent_bindings';
  execute 'drop policy if exists intent_bindings_select on public.intent_bindings';
  execute 'drop policy if exists intent_bindings_write on public.intent_bindings';
  execute $p$
    create policy intent_bindings_select on public.intent_bindings
      for select using (exists (select 1 from public.intents i where i.id = intent_bindings.intent_id and public.user_can_see_strategy(i.strategy_id)))
  $p$;
  execute $p$
    create policy intent_bindings_write on public.intent_bindings
      for all using (public.user_owns_intent(intent_id))
      with check (public.user_owns_intent(intent_id))
  $p$;
end
$m$;

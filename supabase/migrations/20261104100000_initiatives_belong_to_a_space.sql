-- An Initiative belongs to a Space (ELE_DB-009).
--
-- strategies had no activity_space_id, so only its creator, or someone who
-- could see an Object linked to it, could read an Initiative, and only its
-- creator could write its intents. An Initiative with no Objects yet could
-- not be shared with the team.
--
-- Now: an Initiative has a Space — its Portfolio's, else its Vision's, else
-- the one it was created in. Existing ones with neither keep none (and stay
-- private to their creator) rather than being shown to a guessed Space. Everyone in that Space reads it (with its
-- intents, links and nesting); its creator and the Space's owners change it.
-- The Space follows the Portfolio / Vision when those are set, so the three
-- cannot disagree. alcon_internal.user_can_edit_strategy is the one write
-- rule; user_owns_intent (used by every intent_* table) now asks it too.
do $mig$
begin
  if to_regclass('public.strategies') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.intents') is null
     or to_regclass('public.strategy_objects') is null
     or to_regclass('public.strategy_children') is null
     or to_regprocedure('public.user_can_read_strategy(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'initiatives_belong_to_a_space skipped: base schema not present';
    return;
  end if;

  -- ── Column and backfill ────────────────────────────────────────────────
  execute 'alter table public.strategies add column if not exists activity_space_id uuid
    references public.activity_spaces(id) on delete cascade';
  execute 'create index if not exists strategies_activity_space_id_idx on public.strategies (activity_space_id)';

  execute $sql$
    update public.strategies s set activity_space_id = coalesce(
      (select p.activity_space_id from public.portfolios p where p.id = s.portfolio_id),
      (select v.activity_space_id from public.visions v where v.id = s.vision_id))
    where s.activity_space_id is null
  $sql$;

  -- The Space follows the Portfolio, else the Vision; otherwise whatever the
  -- writer gave, which must be a Space they belong to (checked by RLS). Once
  -- set it is never cleared: an editor who could empty it would take it out
  -- of the Space whose owners may change it.
  execute $f$
    create or replace function public.strategies_follow_space()
    returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
    declare
      v_space uuid;
    begin
      if new.portfolio_id is not null then
        select activity_space_id into v_space from public.portfolios where id = new.portfolio_id;
      elsif new.vision_id is not null then
        select activity_space_id into v_space from public.visions where id = new.vision_id;
      end if;
      if v_space is not null then new.activity_space_id := v_space; end if;
      if tg_op = 'UPDATE' and new.activity_space_id is null then
        new.activity_space_id := old.activity_space_id;
      end if;
      return new;
    end;
    $b$
  $f$;
  execute 'revoke execute on function public.strategies_follow_space() from public, anon, authenticated';
  execute 'drop trigger if exists strategies_follow_space on public.strategies';
  execute 'create trigger strategies_follow_space
    before insert or update of portfolio_id, vision_id, activity_space_id on public.strategies
    for each row execute function public.strategies_follow_space()';

  -- ── Read and write rules ───────────────────────────────────────────────
  execute $f$
    create or replace function public.user_can_read_strategy(_strategy_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        exists (select 1 from public.strategies s
                 where s.id = _strategy_id
                   and (s.created_by = auth.uid()
                        or (s.activity_space_id is not null
                            and public.is_activity_space_member(s.activity_space_id))))
        or exists (select 1 from public.strategy_objects so
                    where so.strategy_id = _strategy_id
                      and public.user_can_read_object(so.object_id));
    $b$
  $f$;

  -- user_can_see_strategy gates commenting; anyone who reads it may comment.
  execute $f$
    create or replace function public.user_can_see_strategy(_strategy_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.user_can_read_strategy(_strategy_id);
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_edit_strategy(_strategy_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.strategies s
        where s.id = _strategy_id
          and ((select auth.uid()) is not null)
          and (s.created_by = (select auth.uid())
               or (s.activity_space_id is not null
                   and public.is_activity_space_owner(s.activity_space_id)))
      );
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.user_can_edit_strategy(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_edit_strategy(uuid) to authenticated, service_role';

  execute $f$
    create or replace function public.user_owns_intent(p_intent_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.intents i
        where i.id = p_intent_id and alcon_internal.user_can_edit_strategy(i.strategy_id)
      );
    $b$
  $f$;

  -- strategies
  execute 'drop policy if exists strategies_select on public.strategies';
  execute 'drop policy if exists strategies_select_via_boundary on public.strategies';
  execute 'drop policy if exists strategies_insert on public.strategies';
  execute 'drop policy if exists strategies_update on public.strategies';
  execute 'drop policy if exists strategies_delete on public.strategies';
  -- Judged on the row's own columns first: insert ... returning checks this
  -- policy before the new row is visible to user_can_read_strategy.
  execute 'create policy strategies_select on public.strategies for select
    using (created_by = (select auth.uid())
           or (activity_space_id is not null and public.is_activity_space_member(activity_space_id))
           or public.user_can_read_strategy(id))';
  execute 'create policy strategies_insert on public.strategies for insert
    with check (created_by = (select auth.uid())
                and (activity_space_id is null or public.is_activity_space_member(activity_space_id)))';
  execute 'create policy strategies_update on public.strategies for update
    using (alcon_internal.user_can_edit_strategy(id))
    with check (activity_space_id is null or public.is_activity_space_member(activity_space_id))';
  execute 'create policy strategies_delete on public.strategies for delete
    using (alcon_internal.user_can_edit_strategy(id))';

  -- intents
  execute 'drop policy if exists intents_insert on public.intents';
  execute 'drop policy if exists intents_update on public.intents';
  execute 'drop policy if exists intents_delete on public.intents';
  execute 'create policy intents_insert on public.intents for insert
    with check (alcon_internal.user_can_edit_strategy(strategy_id))';
  execute 'create policy intents_update on public.intents for update
    using (alcon_internal.user_can_edit_strategy(strategy_id))
    with check (alcon_internal.user_can_edit_strategy(strategy_id))';
  execute 'create policy intents_delete on public.intents for delete
    using (alcon_internal.user_can_edit_strategy(strategy_id))';

  -- strategy_objects: linking still needs the Object to be workable.
  execute 'drop policy if exists strategy_objects_insert on public.strategy_objects';
  execute 'drop policy if exists strategy_objects_delete on public.strategy_objects';
  execute 'create policy strategy_objects_insert on public.strategy_objects for insert
    with check (alcon_internal.user_can_edit_strategy(strategy_id) and public.user_can_see_object(object_id))';
  execute 'create policy strategy_objects_delete on public.strategy_objects for delete
    using (alcon_internal.user_can_edit_strategy(strategy_id) and public.user_can_see_object(object_id))';

  -- strategy_children: nesting changes both, so the caller must be able to
  -- edit both; either side's editor may take the link apart.
  execute 'drop policy if exists strategy_children_select on public.strategy_children';
  execute 'drop policy if exists strategy_children_select_via_boundary on public.strategy_children';
  execute 'drop policy if exists strategy_children_insert on public.strategy_children';
  execute 'drop policy if exists strategy_children_delete on public.strategy_children';
  execute 'create policy strategy_children_select on public.strategy_children for select
    using (public.user_can_read_strategy(parent_strategy_id) and public.user_can_read_strategy(child_strategy_id))';
  execute 'create policy strategy_children_insert on public.strategy_children for insert
    with check (alcon_internal.user_can_edit_strategy(parent_strategy_id)
                and alcon_internal.user_can_edit_strategy(child_strategy_id))';
  execute 'create policy strategy_children_delete on public.strategy_children for delete
    using (alcon_internal.user_can_edit_strategy(parent_strategy_id)
           or alcon_internal.user_can_edit_strategy(child_strategy_id))';
end $mig$;

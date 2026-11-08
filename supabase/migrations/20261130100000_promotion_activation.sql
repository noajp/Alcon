-- Promotion PR4: the decision. The owner's RPCs are the only route by
-- which a promotion draft becomes a definition (and, with a trigger,
-- an Automation) — the drafting driver cannot create either (pattern
-- #7: one route). Activation is bound to what was tested:
--
--   - the draft must sit in awaiting_review, unexpired;
--   - an update's target must still be exactly what it was when
--     drafting began — the base snapshot (base_name / base_body,
--     stamped by the driver beside the base hash) is compared in the
--     RPC itself, so a person's edits are never silently overwritten
--     (decision 8): the activation refuses, and the review shows the
--     drift;
--   - what lands is the tested package (the draft's name and body are
--     frozen at the freeze; nothing in the API moves them afterwards),
--     and the draft keeps the activated snapshot for rollback.
--
-- automations gains the binding's title/description templates, so a
-- promoted Automation titles its Elements the way the reviewer
-- approved (fire() renders them when present); a binding with no
-- trigger creates no Automation at all (decision 2), and one with a
-- trigger creates it enabled (decision 3) under the activating owner.
--
-- accept_unverifiable_promotion is the one substitution decision 4
-- allows: a rehearsal that produced no evidence (a write-only
-- procedure, or reads the rehearsal could not reach) may be carried
-- to review by the owner's explicit acknowledgment, recorded on the
-- draft — never by the drafter, never silently.
--
-- Guarded for preview replay, in the standing style.
do $$
declare
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_drafts boolean := to_regclass('public.promotion_drafts') is not null;
  has_definitions boolean := to_regclass('public.definitions') is not null;
  has_automations boolean := to_regclass('public.automations') is not null;
begin
  if not has_spaces or not has_drafts or not has_definitions then
    raise notice 'promotion activation skipped: base tables not present';
    return;
  end if;

  -- The base snapshot the update check compares against (the driver
  -- stamps it beside the base hash when drafting begins).
  execute 'alter table public.promotion_drafts add column if not exists base_name text';
  execute 'alter table public.promotion_drafts add column if not exists base_body text';

  if has_automations then
    execute 'alter table public.automations add column if not exists title_template text';
    execute 'alter table public.automations add column if not exists description_template text';
  end if;

  execute $f$
  create or replace function public.activate_promotion_draft(p_draft_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $body$
  declare
    v_draft public.promotion_drafts%rowtype;
    v_def public.definitions%rowtype;
    v_definition uuid;
    v_automation uuid;
    v_object uuid;
    v_trigger jsonb;
  begin
    select * into v_draft from public.promotion_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status <> 'awaiting_review' then
      raise exception 'このドラフトは審査待ちではありません';
    end if;
    if v_draft.expires_at is not null and v_draft.expires_at < now() then
      raise exception '審査の期限が切れています';
    end if;
    if v_draft.name is null or v_draft.body is null
       or v_draft.tested_structure_hash is null or v_draft.tested_binding_hash is null then
      raise exception 'テストした候補が記録されていません';
    end if;

    if v_draft.target_definition_id is not null then
      -- An update: the target must still be what drafting started
      -- from. A person's edits refuse the activation — never a
      -- silent overwrite (decision 8); the review shows the drift.
      select * into v_def from public.definitions where id = v_draft.target_definition_id;
      if v_def.id is null then raise exception '更新先の定義が見つかりません'; end if;
      if v_draft.base_body is null then
        raise exception '起草の基準が記録されていません。却下して起草し直してください';
      end if;
      if v_def.name is distinct from v_draft.base_name or v_def.body is distinct from v_draft.base_body then
        raise exception '元の定義が起草開始後に編集されています。黙って上書きはしません。内容を確認し、却下して起草し直してください';
      end if;
      update public.definitions set
        name = v_draft.name, body = v_draft.body,
        promoted_from_draft_id = v_draft.id, updated_at = now()
      where id = v_draft.target_definition_id;
      v_definition := v_draft.target_definition_id;
    else
      insert into public.definitions (activity_space_id, name, body, promoted_from_draft_id, created_by)
      values (v_draft.activity_space_id, v_draft.name, v_draft.body, v_draft.id,
              coalesce(v_draft.requester_id, (select auth.uid())))
      returning id into v_definition;
    end if;

    -- The binding's Automation, when the package carries a schedule
    -- and a home. Born enabled (decision 3), owned by the activator.
    v_trigger := v_draft.binding -> 'trigger';
    if v_trigger is not null and jsonb_typeof(v_trigger) = 'object'
       and v_draft.binding ->> 'objectId' ~ '^[0-9a-fA-F-]{36}$' then
      v_object := (v_draft.binding ->> 'objectId')::uuid;
      insert into public.automations (
        activity_space_id, name, definition_id, object_id, kind, cron, timezone,
        title_template, description_template, owner_id, enabled)
      values (
        v_draft.activity_space_id, v_draft.name, v_definition, v_object, 'schedule',
        v_trigger ->> 'cron', coalesce(nullif(v_trigger ->> 'timezone', ''), 'Asia/Tokyo'),
        nullif(v_draft.binding ->> 'titleTemplate', ''), nullif(v_draft.binding ->> 'descriptionTemplate', ''),
        (select auth.uid()), true)
      returning id into v_automation;
    end if;

    update public.promotion_drafts set
      status = 'active', activated_definition_id = v_definition,
      activated_automation_id = v_automation,
      activated_body = v_draft.body,
      activated_structure_hash = v_draft.tested_structure_hash,
      activated_binding_hash = v_draft.tested_binding_hash,
      decided_by = (select auth.uid()), decided_at = now(), expires_at = null,
      events = events || jsonb_build_array(jsonb_build_object(
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'kind', 'activated', 'by', (select auth.uid()))),
      updated_at = now()
    where id = v_draft.id;
    return v_definition;
  end
  $body$
  $f$;
  execute 'revoke all on function public.activate_promotion_draft(uuid) from public';
  execute 'grant execute on function public.activate_promotion_draft(uuid) to authenticated';

  execute $f$
  create or replace function public.reject_promotion_draft(p_draft_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $body$
  declare
    v_draft public.promotion_drafts%rowtype;
  begin
    select * into v_draft from public.promotion_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status not in ('awaiting_review', 'rehearsing') then
      raise exception 'このドラフトは却下できる状態ではありません';
    end if;
    update public.promotion_drafts set
      status = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
      expires_at = null, updated_at = now()
    where id = v_draft.id;
    return true;
  end
  $body$
  $f$;
  execute 'revoke all on function public.reject_promotion_draft(uuid) from public';
  execute 'grant execute on function public.reject_promotion_draft(uuid) to authenticated';

  execute $f$
  create or replace function public.accept_unverifiable_promotion(p_draft_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $body$
  declare
    v_draft public.promotion_drafts%rowtype;
  begin
    select * into v_draft from public.promotion_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status <> 'rehearsing'
       or coalesce(v_draft.rehearsal_report ->> 'outcome', '') <> 'unverifiable' then
      raise exception 'このドラフトは、確かめきれなかった試走の確認待ちではありません';
    end if;
    update public.promotion_drafts set
      status = 'awaiting_review', failure_class = null,
      expires_at = now() + interval '7 days',
      events = events || jsonb_build_array(jsonb_build_object(
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'kind', 'unverifiable_accepted', 'by', (select auth.uid()))),
      updated_at = now()
    where id = v_draft.id;
    return true;
  end
  $body$
  $f$;
  execute 'revoke all on function public.accept_unverifiable_promotion(uuid) from public';
  execute 'grant execute on function public.accept_unverifiable_promotion(uuid) to authenticated';

  execute $f$
  create or replace function public.rollback_promoted_definition(p_draft_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $body$
  declare
    v_draft public.promotion_drafts%rowtype;
  begin
    select * into v_draft from public.promotion_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status <> 'active' or v_draft.activated_definition_id is null
       or v_draft.activated_body is null then
      raise exception 'このドラフトには戻せる有効化がありません';
    end if;
    -- The rollback source in v1 is the draft's activated snapshot (the
    -- only version a promoted definition is guaranteed to have); the
    -- Automation is not touched — its schedule now runs the restored
    -- body, which is the point of rolling back.
    update public.definitions set
      name = v_draft.name, body = v_draft.activated_body, updated_at = now()
    where id = v_draft.activated_definition_id;
    update public.promotion_drafts set
      events = events || jsonb_build_array(jsonb_build_object(
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'kind', 'rolled_back', 'by', (select auth.uid()))),
      updated_at = now()
    where id = v_draft.id;
    return true;
  end
  $body$
  $f$;
  execute 'revoke all on function public.rollback_promoted_definition(uuid) from public';
  execute 'grant execute on function public.rollback_promoted_definition(uuid) to authenticated';
end
$$;

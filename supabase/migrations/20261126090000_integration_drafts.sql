-- G4: a connection the AI drafts, a connection test verifies, and a Space
-- owner activates. The draft is a record, never a secret holder:
--
--   integration_drafts  the drafting story: who asked and for what work,
--                       the candidate (endpoint, auth, manifest, guide),
--                       its sources, every test round's evidence, what
--                       was tested (tested_content + hashes), and the
--                       decision (who, when, which content hash went
--                       live). Testing happens against a staged row —
--                       a disabled new row, or, when the draft updates a
--                       live connection, a disabled CLONE of it — so an
--                       untested candidate can never reach an assembly,
--                       and a live connection is never the test bench.
--   agent_runs          + integration_draft_id, the fourth subject: the
--                       drafting run (mode 'draft'), anchored to its
--                       draft the way a Copilot run anchors to its
--                       session (20261123090000, same pattern throughout).
--   notifications       + integration_draft_id, so a draft waiting for
--                       review reaches its owners' Inbox (the
--                       workflow_approval_id / agent_action_id pattern).
--   copy_integration_secret  service role only: a staged clone tests
--                       with the original's credential without any
--                       browser ever reading it (Vault names secrets
--                       integration:<row id>, so a copy is a server act).
--   activate_integration_draft / reject_integration_draft
--                       the owner's decisions as security-definer RPCs:
--                       activation re-checks that the draft's candidate
--                       still equals the tested payload (jsonb equality
--                       over the stored normalised content — the hash's
--                       canonical form is computed once, in TypeScript)
--                       and that the staged row still carries it, then
--                       makes it live: a new row is enabled; an update
--                       writes the tested content onto the original and
--                       deletes the clone.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_integrations boolean := to_regclass('public.integrations') is not null;
  has_runs boolean := to_regclass('public.agent_runs') is not null;
  has_sessions boolean := to_regclass('public.ai_sessions') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
  has_notifications boolean := to_regclass('public.notifications') is not null;
  v_check text;
  v_case text;
  v_using text;
  v_with_check text;
begin
  if not has_spaces or not has_integrations then
    raise notice 'integration drafts skipped: activity_spaces or integrations not present';
    return;
  end if;

  -- ── The draft record ──────────────────────────────────────────────────
  create table if not exists public.integration_drafts (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null,
    name_key text not null,
    kind text not null default 'http' check (kind in ('http')),
    status text not null default 'drafting' check (status in (
      'drafting', 'awaiting_input', 'testing', 'awaiting_review',
      'active', 'rejected', 'failed', 'expired', 'superseded', 'rerouted')),
    request_context jsonb not null default '{}'::jsonb,
    endpoint text,
    auth_type text check (auth_type in ('none', 'bearer', 'header', 'oauth')),
    auth_header text,
    manifest jsonb,
    guide text,
    test_inputs jsonb not null default '{}'::jsonb,
    sources jsonb not null default '[]'::jsonb,
    test_results jsonb not null default '[]'::jsonb,
    required_commands jsonb not null default '[]'::jsonb,
    dropped_commands jsonb not null default '[]'::jsonb,
    tested_hash text,
    tested_structure_hash text,
    tested_permission_hash text,
    tested_content jsonb,
    materialized_integration_id uuid references public.integrations(id) on delete set null,
    target_integration_id uuid references public.integrations(id) on delete set null,
    activated_integration_id uuid references public.integrations(id) on delete set null,
    decided_by uuid,
    decided_at timestamptz,
    activated_hash text,
    activated_structure_hash text,
    activated_permission_hash text,
    failure_class text,
    awaiting_question text,
    change_events jsonb not null default '[]'::jsonb,
    expires_at timestamptz,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  -- draft_run_id joins once agent_runs is known to exist (below); the
  -- column is added there so a preview without runs still gets the table.
  create index if not exists integration_drafts_space_idx
    on public.integration_drafts (activity_space_id, created_at desc);
  create index if not exists integration_drafts_review_idx
    on public.integration_drafts (expires_at) where status = 'awaiting_review';
  -- One open draft per service name in a Space: a second entry joins it
  -- instead of starting a rival drafting run.
  create unique index if not exists integration_drafts_one_open
    on public.integration_drafts (activity_space_id, name_key)
    where status in ('drafting', 'awaiting_input', 'testing', 'awaiting_review');

  alter table public.integration_drafts enable row level security;
  drop policy if exists integration_drafts_select on public.integration_drafts;
  create policy integration_drafts_select on public.integration_drafts for select to authenticated
    using (public.is_activity_space_member(activity_space_id));
  drop policy if exists integration_drafts_insert on public.integration_drafts;
  create policy integration_drafts_insert on public.integration_drafts for insert to authenticated
    with check (public.is_activity_space_member(activity_space_id)
      and created_by = (select auth.uid()) and status = 'drafting');
  drop policy if exists integration_drafts_update on public.integration_drafts;
  create policy integration_drafts_update on public.integration_drafts for update to authenticated
    using (public.is_activity_space_owner(activity_space_id))
    with check (public.is_activity_space_owner(activity_space_id));
  -- No delete policy: drafts are the audit record; the service role and
  -- the decision RPCs move them, nobody erases them.

  -- ── agent_runs: the draft as a subject ────────────────────────────────
  if has_runs then
    execute 'alter table public.integration_drafts add column if not exists draft_run_id uuid references public.agent_runs(id) on delete set null';
    execute 'alter table public.agent_runs add column if not exists integration_draft_id uuid references public.integration_drafts(id) on delete set null';
    execute 'create index if not exists agent_runs_integration_draft_idx on public.agent_runs (integration_draft_id, created_at desc) where integration_draft_id is not null';
    execute 'grant insert (integration_draft_id), select (integration_draft_id) on public.agent_runs to authenticated';

    v_check := 'element_id is not null'
      || case when has_strategies then ' or strategy_id is not null' else '' end
      || case when has_sessions then ' or ai_session_id is not null or mode = ''copilot''' else '' end
      || ' or integration_draft_id is not null';
    execute 'alter table public.agent_runs drop constraint if exists agent_runs_subject_check';
    execute 'alter table public.agent_runs add constraint agent_runs_subject_check check (' || v_check || ')';

    v_case := 'case when new.element_id is not null then public.element_space(new.element_id)'
      || case when has_strategies then ' when new.strategy_id is not null then (select s.activity_space_id from public.strategies s where s.id = new.strategy_id)' else '' end
      || case when has_sessions then ' when new.ai_session_id is not null then (select s.activity_space_id from public.ai_sessions s where s.id = new.ai_session_id)' else '' end
      || ' when new.integration_draft_id is not null then (select d.activity_space_id from public.integration_drafts d where d.id = new.integration_draft_id)'
      || ' end';
    execute $f$create or replace function public.agent_runs_stamp_space()
      returns trigger language plpgsql security definer set search_path to 'public' as $body$
    begin
      if new.activity_space_id is null then
        new.activity_space_id := $f$ || v_case || $f$;
      end if;
      return new;
    end
    $body$
    $f$;

    v_using := 'case when element_id is not null then public.user_can_read_element(element_id)'
      || case when has_strategies then ' when strategy_id is not null then exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id)' else '' end
      || case when has_sessions then ' when ai_session_id is not null or mode = ''copilot'' then triggered_by = (select auth.uid())' else '' end
      || ' when integration_draft_id is not null then exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id)'
      || ' else false end';
    execute 'drop policy if exists agent_runs_select on public.agent_runs';
    execute 'create policy agent_runs_select on public.agent_runs for select using (' || v_using || ')';

    v_with_check := 'triggered_by = (select auth.uid()) and ('
      || '(element_id is not null and public.user_can_see_element(element_id)'
      || ' and (worker_id is null or public.worker_assignable(worker_id, element_id)))'
      || case when has_strategies then ' or (element_id is null and strategy_id is not null and worker_id is null and exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id))' else '' end
      || case when has_sessions then ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || ' and ai_session_id is not null and worker_id is null and exists (select 1 from public.ai_sessions s where s.id = agent_runs.ai_session_id and s.user_id = (select auth.uid())))' else '' end
      || ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || case when has_sessions then ' and ai_session_id is null' else '' end || ' and integration_draft_id is not null and worker_id is null and exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id and d.created_by = (select auth.uid())))'
      || ')';
    execute 'drop policy if exists agent_runs_insert on public.agent_runs';
    execute 'create policy agent_runs_insert on public.agent_runs for insert with check (' || v_with_check || ')';
  end if;

  -- ── notifications: a draft waiting for review reaches the Inbox ───────
  if has_notifications then
    execute 'alter table public.notifications add column if not exists integration_draft_id uuid references public.integration_drafts(id) on delete cascade';
  end if;
end
$$;

-- The staged clone of a live connection tests with the original's
-- credential. Vault names a secret integration:<row id>, so the copy is
-- a server act: service role only, same Space only, and it never returns
-- the secret to anyone. Skipped where Vault or integrations is absent.
do $$
begin
  if to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'copy_integration_secret skipped: integrations or vault not present';
    return;
  end if;

  create or replace function public.copy_integration_secret(p_from_id uuid, p_to_id uuid)
  returns boolean language plpgsql security definer set search_path = public, vault as $f$
  declare
    v_from_space uuid;
    v_from_secret uuid;
    v_to_space uuid;
    v_to_secret uuid;
    v_secret text;
    v_new_id uuid;
  begin
    select activity_space_id, secret_id into v_from_space, v_from_secret
    from public.integrations where id = p_from_id;
    select activity_space_id, secret_id into v_to_space, v_to_secret
    from public.integrations where id = p_to_id;
    if v_from_space is null or v_to_space is null or v_from_space <> v_to_space then
      return false;
    end if;
    if v_from_secret is null then return false; end if;
    select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_from_secret;
    if v_secret is null then return false; end if;
    if v_to_secret is not null then delete from vault.secrets where id = v_to_secret; end if;
    v_new_id := vault.create_secret(v_secret, 'integration:' || p_to_id::text, 'Alcon integration credential (draft staging copy)');
    update public.integrations set secret_id = v_new_id, updated_at = now() where id = p_to_id;
    return true;
  end
  $f$;
  revoke all on function public.copy_integration_secret(uuid, uuid) from public;
  revoke all on function public.copy_integration_secret(uuid, uuid) from authenticated;
  revoke all on function public.copy_integration_secret(uuid, uuid) from anon;
  grant execute on function public.copy_integration_secret(uuid, uuid) to service_role;
end
$$;

-- The owner's decisions on a draft. Activation is bound to the tested
-- content twice over: the draft's candidate must still equal the stored
-- tested payload, and the staged row must still carry that payload —
-- all compared as jsonb, so the canonical hash is computed in exactly
-- one place (TypeScript) and only recorded here.
do $$
begin
  if to_regclass('public.integration_drafts') is null or to_regclass('public.integrations') is null then
    raise notice 'integration draft decisions skipped: drafts or integrations not present';
    return;
  end if;

  create or replace function public.activate_integration_draft(p_draft_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $f$
  declare
    v_draft public.integration_drafts%rowtype;
    v_row public.integrations%rowtype;
    v_candidate jsonb;
    v_activated uuid;
  begin
    select * into v_draft from public.integration_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status <> 'awaiting_review' then
      raise exception 'このドラフトは審査待ちではありません';
    end if;
    v_candidate := jsonb_build_object(
      'name', v_draft.name, 'endpoint', v_draft.endpoint, 'auth_type', v_draft.auth_type,
      'auth_header', v_draft.auth_header, 'manifest', v_draft.manifest, 'guide', v_draft.guide);
    if v_draft.tested_content is null or v_candidate <> v_draft.tested_content then
      raise exception 'テストした内容と現在の内容が一致しません。再テストしてください';
    end if;
    select * into v_row from public.integrations where id = v_draft.materialized_integration_id;
    if v_row.id is null then raise exception 'テストした接続が見つかりません'; end if;
    if v_row.name <> v_draft.name or v_row.endpoint <> v_draft.endpoint
       or v_row.auth_type <> v_draft.auth_type
       or v_row.auth_header is distinct from v_draft.auth_header
       or v_row.manifest is distinct from v_draft.manifest
       or v_row.guide is distinct from v_draft.guide then
      raise exception 'テストした接続の内容が変わっています。再テストしてください';
    end if;

    if v_draft.target_integration_id is not null then
      -- An update: the tested content lands on the original, atomically
      -- with the decision; the clone that was tested is deleted (its
      -- copied secret goes with it). The original's own credential was
      -- never touched — the clone only borrowed a copy.
      update public.integrations set
        name = v_draft.name, endpoint = v_draft.endpoint, auth_type = v_draft.auth_type,
        auth_header = v_draft.auth_header, manifest = v_draft.manifest, guide = v_draft.guide,
        updated_at = now()
      where id = v_draft.target_integration_id;
      delete from public.integrations where id = v_draft.materialized_integration_id;
      v_activated := v_draft.target_integration_id;
    else
      update public.integrations set enabled = true, updated_at = now()
      where id = v_draft.materialized_integration_id;
      v_activated := v_draft.materialized_integration_id;
    end if;

    update public.integration_drafts set
      status = 'active', activated_integration_id = v_activated,
      activated_hash = tested_hash, activated_structure_hash = tested_structure_hash,
      activated_permission_hash = tested_permission_hash,
      decided_by = (select auth.uid()), decided_at = now(), expires_at = null, updated_at = now()
    where id = v_draft.id;
    -- The name's previous drafted connection gives way to this one.
    update public.integration_drafts set status = 'superseded', updated_at = now()
    where activity_space_id = v_draft.activity_space_id and name_key = v_draft.name_key
      and status = 'active' and id <> v_draft.id;
    return v_activated;
  end
  $f$;
  revoke all on function public.activate_integration_draft(uuid) from public;
  grant execute on function public.activate_integration_draft(uuid) to authenticated;

  create or replace function public.reject_integration_draft(p_draft_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $f$
  declare
    v_draft public.integration_drafts%rowtype;
  begin
    select * into v_draft from public.integration_drafts where id = p_draft_id for update;
    if v_draft.id is null then raise exception 'draft not found'; end if;
    if not public.is_activity_space_owner(v_draft.activity_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_draft.status not in ('awaiting_review', 'testing') then
      raise exception 'このドラフトは却下できる状態ではありません';
    end if;
    -- The staged row (a disabled new row, or a clone) goes away; a live
    -- original is never the staged row, and a row another draft already
    -- activated is not this draft's to delete.
    if v_draft.materialized_integration_id is not null
       and not exists (select 1 from public.integration_drafts d
                       where d.activated_integration_id = v_draft.materialized_integration_id and d.status = 'active') then
      delete from public.integrations where id = v_draft.materialized_integration_id;
    end if;
    update public.integration_drafts set
      status = 'rejected', decided_by = (select auth.uid()), decided_at = now(), expires_at = null, updated_at = now()
    where id = v_draft.id;
    return true;
  end
  $f$;
  revoke all on function public.reject_integration_draft(uuid) from public;
  grant execute on function public.reject_integration_draft(uuid) to authenticated;
end
$$;

-- §4.11: a drafted connection that people later edit keeps an audit of
-- it on its draft: who changed it, when, and which top-level fields
-- moved (the hashes are compared in TypeScript, where canonicalization
-- lives). The activation write itself is not a change — at that moment
-- the row's new content is the draft's tested content, which is exactly
-- the guard below.
do $$
begin
  if to_regclass('public.integrations') is null or to_regclass('public.integration_drafts') is null then
    raise notice 'integration draft change log skipped: integrations or drafts not present';
    return;
  end if;

  create or replace function public.integration_drafts_note_change()
  returns trigger language plpgsql security definer set search_path = public as $f$
  declare
    v_draft public.integration_drafts%rowtype;
    v_fields text[] := '{}';
  begin
    select * into v_draft from public.integration_drafts
    where activated_integration_id = new.id and status = 'active'
    order by decided_at desc limit 1;
    if v_draft.id is null then return new; end if;
    if new.name is distinct from old.name then v_fields := v_fields || 'name'; end if;
    if new.endpoint is distinct from old.endpoint then v_fields := v_fields || 'endpoint'; end if;
    if new.auth_type is distinct from old.auth_type then v_fields := v_fields || 'auth'; end if;
    if new.manifest is distinct from old.manifest then v_fields := v_fields || 'manifest'; end if;
    if new.guide is distinct from old.guide then v_fields := v_fields || 'guide'; end if;
    if coalesce(array_length(v_fields, 1), 0) = 0 then return new; end if;
    -- An edit that lands exactly on the approved content is not drift.
    if new.name = v_draft.name and new.endpoint = v_draft.endpoint
       and new.auth_type = v_draft.auth_type
       and new.manifest is not distinct from v_draft.manifest
       and new.guide is not distinct from v_draft.guide then
      return new;
    end if;
    update public.integration_drafts set
      change_events = change_events || jsonb_build_array(jsonb_build_object(
        'at', now(), 'by', (select auth.uid()), 'fields', to_jsonb(v_fields))),
      updated_at = now()
    where id = v_draft.id;
    return new;
  end
  $f$;
  drop trigger if exists integrations_draft_change_log on public.integrations;
  create trigger integrations_draft_change_log
    after update on public.integrations
    for each row execute function public.integration_drafts_note_change();
end
$$;

-- Promotion: a piece of one-off work becomes a standing harness.
--
--   promotion_drafts  the promotion's story: where the work came from
--                     (a durable procedure memory, or a finished run a
--                     person named), the package it proposes — a
--                     definition (name + body) and its binding (the
--                     Object its Elements land on, their title and
--                     description templates, a schedule trigger) — the
--                     rehearsal's evidence, what was tested (the
--                     structure and binding hashes), and the decision.
--                     The drafting driver (mode 'promote', the sixth)
--                     can create neither a definition nor an
--                     Automation; only the owner's activation RPC does
--                     (PR4), bound to the tested hashes.
--   agent_runs        + promotion_draft_id, the sixth subject, and
--                     + rehearsal: the mark of a run that tries a
--                     definition with its writes blocked (PR3's
--                     substrate — a general way to try a definition
--                     safely, used first by a promotion's rehearsal).
--   definitions       + promoted_from_draft_id, the provenance a
--                     promoted definition carries (decision 10), so
--                     the panel and the audit can tell it apart and
--                     walk back to the drafting that made it.
--   notifications     + promotion_draft_id, and kind 'promotion'
--                     joins the kind check (restated whole, the
--                     standing style): a draft waiting for review or
--                     for an answer reaches a person.
--   memories          + promotion_offered_at: the once-per-memory
--                     mark of the conversational offer (decision 9) —
--                     a candidate is offered once, and a declined or
--                     lapsed offer is never repeated.
--
-- The activation / rejection / rollback RPCs arrive with PR4's own
-- migration; this one lays down records only, and changes no behaviour:
-- no run can carry the new subject until a surface creates one.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_definitions boolean := to_regclass('public.definitions') is not null;
  has_runs boolean := to_regclass('public.agent_runs') is not null;
  has_sessions boolean := to_regclass('public.ai_sessions') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
  has_notifications boolean := to_regclass('public.notifications') is not null;
  has_drafts boolean := to_regclass('public.integration_drafts') is not null;
  has_memories boolean := to_regclass('public.memories') is not null;
  has_automations boolean := to_regclass('public.automations') is not null;
  v_check text;
  v_case text;
  v_using text;
  v_with_check text;
begin
  if not has_spaces or not has_definitions then
    raise notice 'promotion skipped: activity_spaces or definitions not present';
    return;
  end if;

  -- ── The draft record ──────────────────────────────────────────────────
  create table if not exists public.promotion_drafts (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    status text not null default 'drafting' check (status in (
      'drafting', 'awaiting_input', 'rehearsing', 'awaiting_review',
      'active', 'rejected', 'expired', 'failed')),
    source_kind text not null check (source_kind in ('memory', 'run')),
    target_definition_id uuid references public.definitions(id) on delete set null,
    requester_id uuid,
    name text,
    body text,
    binding jsonb not null default '{}'::jsonb,
    base_definition_hash text,
    tested_structure_hash text,
    tested_binding_hash text,
    rehearsal_report jsonb,
    failure_class text,
    awaiting_question text,
    material_sources jsonb not null default '[]'::jsonb,
    activated_definition_id uuid references public.definitions(id) on delete set null,
    activated_body text,
    activated_structure_hash text,
    activated_binding_hash text,
    decided_by uuid,
    decided_at timestamptz,
    events jsonb not null default '[]'::jsonb,
    expires_at timestamptz,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  -- Columns whose targets are other late tables join once those are
  -- known to exist (the G4 order: the table first, its joins after).
  if has_memories then
    execute 'alter table public.promotion_drafts add column if not exists source_memory_id uuid references public.memories(id) on delete set null';
  end if;
  if has_runs then
    execute 'alter table public.promotion_drafts add column if not exists source_run_id uuid references public.agent_runs(id) on delete set null';
    execute 'alter table public.promotion_drafts add column if not exists draft_run_id uuid references public.agent_runs(id) on delete set null';
    execute 'alter table public.promotion_drafts add column if not exists rehearsal_run_id uuid references public.agent_runs(id) on delete set null';
  end if;
  if has_automations then
    execute 'alter table public.promotion_drafts add column if not exists activated_automation_id uuid references public.automations(id) on delete set null';
  end if;
  create index if not exists promotion_drafts_space_idx
    on public.promotion_drafts (activity_space_id, created_at desc);
  create index if not exists promotion_drafts_review_idx
    on public.promotion_drafts (expires_at) where status = 'awaiting_review';
  -- One open draft per source (design §4.5 rule 1): a second start for
  -- the same memory or run joins the open one instead of rivalling it,
  -- and one open update per target definition.
  create unique index if not exists promotion_drafts_one_open_memory
    on public.promotion_drafts (source_memory_id)
    where source_memory_id is not null and status in ('drafting', 'awaiting_input', 'rehearsing', 'awaiting_review');
  create unique index if not exists promotion_drafts_one_open_run
    on public.promotion_drafts (source_run_id)
    where source_run_id is not null and status in ('drafting', 'awaiting_input', 'rehearsing', 'awaiting_review');
  create unique index if not exists promotion_drafts_one_open_target
    on public.promotion_drafts (target_definition_id)
    where target_definition_id is not null and status in ('drafting', 'awaiting_input', 'rehearsing', 'awaiting_review');

  alter table public.promotion_drafts enable row level security;
  execute 'revoke all on table public.promotion_drafts from public, anon';
  execute 'grant select, insert, update on table public.promotion_drafts to authenticated';
  drop policy if exists promotion_drafts_select on public.promotion_drafts;
  create policy promotion_drafts_select on public.promotion_drafts for select to authenticated
    using (public.is_activity_space_member(activity_space_id));
  drop policy if exists promotion_drafts_insert on public.promotion_drafts;
  create policy promotion_drafts_insert on public.promotion_drafts for insert to authenticated
    with check (public.is_activity_space_member(activity_space_id)
      and created_by = (select auth.uid()) and status = 'drafting');
  drop policy if exists promotion_drafts_update on public.promotion_drafts;
  create policy promotion_drafts_update on public.promotion_drafts for update to authenticated
    using (public.is_activity_space_owner(activity_space_id))
    with check (public.is_activity_space_owner(activity_space_id));
  -- No delete policy: drafts are the audit record; the service role and
  -- the decision RPCs move them, nobody erases them.

  -- ── definitions: the provenance of a promoted definition ─────────────
  execute 'alter table public.definitions add column if not exists promoted_from_draft_id uuid references public.promotion_drafts(id) on delete set null';
  execute 'create index if not exists definitions_promoted_idx on public.definitions (promoted_from_draft_id) where promoted_from_draft_id is not null';

  -- ── memories: the offer is made once ────────────────────────────────
  if has_memories then
    execute 'alter table public.memories add column if not exists promotion_offered_at timestamptz';
  end if;

  -- ── agent_runs: the promotion as a subject, the rehearsal mark ──────
  if has_runs then
    execute 'alter table public.agent_runs add column if not exists promotion_draft_id uuid references public.promotion_drafts(id) on delete set null';
    execute 'alter table public.agent_runs add column if not exists rehearsal boolean not null default false';
    execute 'create index if not exists agent_runs_promotion_draft_idx on public.agent_runs (promotion_draft_id, created_at desc) where promotion_draft_id is not null';
    execute 'grant insert (promotion_draft_id, rehearsal), select (promotion_draft_id, rehearsal) on public.agent_runs to authenticated';

    v_check := 'element_id is not null'
      || case when has_strategies then ' or strategy_id is not null' else '' end
      || case when has_sessions then ' or ai_session_id is not null or mode = ''copilot''' else '' end
      || case when has_drafts then ' or integration_draft_id is not null' else '' end
      || ' or promotion_draft_id is not null'
      || ' or mode = ''heartbeat''';
    execute 'alter table public.agent_runs drop constraint if exists agent_runs_subject_check';
    execute 'alter table public.agent_runs add constraint agent_runs_subject_check check (' || v_check || ')';

    v_case := 'case when new.element_id is not null then public.element_space(new.element_id)'
      || case when has_strategies then ' when new.strategy_id is not null then (select s.activity_space_id from public.strategies s where s.id = new.strategy_id)' else '' end
      || case when has_sessions then ' when new.ai_session_id is not null then (select s.activity_space_id from public.ai_sessions s where s.id = new.ai_session_id)' else '' end
      || case when has_drafts then ' when new.integration_draft_id is not null then (select d.activity_space_id from public.integration_drafts d where d.id = new.integration_draft_id)' else '' end
      || ' when new.promotion_draft_id is not null then (select d.activity_space_id from public.promotion_drafts d where d.id = new.promotion_draft_id)'
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
      || case when has_drafts then ' when integration_draft_id is not null then exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id)' else '' end
      || ' when promotion_draft_id is not null then exists (select 1 from public.promotion_drafts d where d.id = agent_runs.promotion_draft_id)'
      || ' when mode = ''heartbeat'' then public.is_activity_space_member(activity_space_id)'
      || ' else false end';
    execute 'drop policy if exists agent_runs_select on public.agent_runs';
    execute 'create policy agent_runs_select on public.agent_runs for select using (' || v_using || ')';

    v_with_check := 'triggered_by = (select auth.uid()) and ('
      || '(element_id is not null and public.user_can_see_element(element_id)'
      || ' and (worker_id is null or public.worker_assignable(worker_id, element_id)))'
      || case when has_strategies then ' or (element_id is null and strategy_id is not null and worker_id is null and exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id))' else '' end
      || case when has_sessions then ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || ' and ai_session_id is not null and worker_id is null and exists (select 1 from public.ai_sessions s where s.id = agent_runs.ai_session_id and s.user_id = (select auth.uid())))' else '' end
      || case when has_drafts then ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || case when has_sessions then ' and ai_session_id is null' else '' end || ' and integration_draft_id is not null and worker_id is null and exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id and d.created_by = (select auth.uid())))' else '' end
      || ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || case when has_sessions then ' and ai_session_id is null' else '' end || case when has_drafts then ' and integration_draft_id is null' else '' end || ' and promotion_draft_id is not null and worker_id is null and exists (select 1 from public.promotion_drafts d where d.id = agent_runs.promotion_draft_id and d.created_by = (select auth.uid())))'
      || ')';
    execute 'drop policy if exists agent_runs_insert on public.agent_runs';
    execute 'create policy agent_runs_insert on public.agent_runs for insert with check (' || v_with_check || ')';
  end if;

  -- ── notifications: the promotion kind, and the draft it is about ────
  if has_notifications then
    execute 'alter table public.notifications add column if not exists promotion_draft_id uuid references public.promotion_drafts(id) on delete cascade';
    execute 'create index if not exists notifications_promotion_draft_idx on public.notifications (promotion_draft_id) where promotion_draft_id is not null';
    execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || '''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'','
      || '''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced'','
      || '''measure_missed'', ''heartbeat'', ''promotion'''
      || ']::text[]))';
  end if;
end
$$;

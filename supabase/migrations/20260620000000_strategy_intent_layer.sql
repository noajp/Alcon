-- Strategy "Intent" layer — the 認識2x2 + 実践2x2 dashboard backing the new
-- Strategy Document detail page.
--
-- 9 tables in one migration:
--   intents                  — Master + Sub-Intent nodes under a Strategy
--   intent_bindings          — semantic edges to Domain/Object/Element
--                              (evidences/measures/tests/delivers/competes_with)
--   intent_audits            — LLM audit run snapshots (Quality score + trend)
--   intent_predictions       — anonymous "internal market" votes
--   intent_lineage           — judgment-history entries (incl. cross-rotation)
--   intent_resources         — declared-vs-actual allocation snapshots
--   intent_alignments        — detected conflicts + Fallacy-of-Composition
--   intent_escalations       — triggered events when divergence/audit drops
--   intent_next_actions      — AI-Co-Pilot-suggested next steps
--
-- Same guard pattern as 20260613_voice: the parent `public.strategies` table
-- was created straight on the hosted project (not via a committed migration),
-- so a fresh preview replay won't have it. Skip the whole migration in that
-- case; every statement is otherwise idempotent so a re-run is a safe no-op.

do $strategy_intent_migration$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'strategy_intent_layer migration skipped: public.strategies is not present (fresh preview branch).';
    return;
  end if;

  -- ── intents — Master / Sub-Intent under a Strategy ─────────────────
  execute $sql$
    create table if not exists public.intents (
      id uuid primary key default gen_random_uuid(),
      strategy_id uuid not null references public.strategies(id) on delete cascade,
      parent_intent_id uuid references public.intents(id) on delete cascade,
      slug text,  -- "i1", "i2"… for cross-card references like "i2 ↔ i3"
      title text not null,
      subtitle text,
      captured_dimensions text[] not null default '{}',
      uncaptured_dimensions text[] not null default '{}',
      abandoned text,
      horizon date,
      status text not null default 'on_track' check (status in ('on_track','at_risk','off_track','done')),
      decided_by_name text,
      decided_by_role text,
      decided_at timestamptz,
      order_index real not null default 0,
      created_by uuid not null default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $sql$;

  -- One Master per Strategy (parent_intent_id is null). Sub-intents are unbounded.
  execute $sql$
    create unique index if not exists idx_intents_master_per_strategy
      on public.intents (strategy_id) where (parent_intent_id is null)
  $sql$;
  execute $sql$
    create index if not exists idx_intents_strategy
      on public.intents (strategy_id, order_index)
  $sql$;
  execute $sql$
    create index if not exists idx_intents_parent
      on public.intents (parent_intent_id, order_index)
  $sql$;

  -- updated_at touch
  execute $sql$
    create or replace function public.touch_intents_updated_at()
    returns trigger language plpgsql as $$
    begin
      new.updated_at := now();
      return new;
    end
    $$
  $sql$;
  execute 'drop trigger if exists trg_intents_updated_at on public.intents';
  execute $sql$
    create trigger trg_intents_updated_at
      before update on public.intents
      for each row execute function public.touch_intents_updated_at()
  $sql$;

  -- ── intent_bindings — semantic edge to Domain/Object/Element ───────
  execute $sql$
    create table if not exists public.intent_bindings (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      target_type text not null check (target_type in ('domain','object','element')),
      target_id uuid not null,
      relationship_type text not null check (relationship_type in ('evidences','measures','tests','delivers','competes_with')),
      note text,
      created_at timestamptz not null default now()
    )
  $sql$;
  execute $sql$
    create unique index if not exists idx_intent_bindings_uniq
      on public.intent_bindings (intent_id, target_type, target_id, relationship_type)
  $sql$;
  execute $sql$
    create index if not exists idx_intent_bindings_target
      on public.intent_bindings (target_type, target_id)
  $sql$;

  -- ── intent_audits — LLM run snapshot (Quality score + trend point) ─
  execute $sql$
    create table if not exists public.intent_audits (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      ran_at timestamptz not null default now(),
      score int not null check (score between 0 and 100),
      authentic_count int not null default 0,
      suspected_count int not null default 0,
      indeterminate_count int not null default 0,
      total_elements int not null default 0,
      llm_note text,
      delta_30d int  -- e.g., -37 (pt change over the last 30 days)
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_audits_intent_time
      on public.intent_audits (intent_id, ran_at desc)
  $sql$;

  -- ── intent_predictions — anonymous internal market ─────────────────
  -- voter_hash = hash(user_id ‖ intent_id ‖ pepper). The server never stores
  -- user_id alongside the vote, so even admins can't deanonymize. One open
  -- vote per (intent, voter); historical votes are archived by inserting a
  -- new row with `archived_at` set before the new active row is upserted.
  execute $sql$
    create table if not exists public.intent_predictions (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      voter_hash text not null,
      probability int not null check (probability between 0 and 100),
      role_group text check (role_group in ('engineering','delivery','sales','finance','management','other')),
      official_report int check (official_report between 0 and 100),  -- snapshot of the report at vote time
      voted_at timestamptz not null default now(),
      archived_at timestamptz  -- when set, this is a historical row; the active one is the one with archived_at IS NULL
    )
  $sql$;
  -- One active vote per (intent, voter)
  execute $sql$
    create unique index if not exists idx_intent_predictions_active
      on public.intent_predictions (intent_id, voter_hash) where (archived_at is null)
  $sql$;
  execute $sql$
    create index if not exists idx_intent_predictions_time
      on public.intent_predictions (intent_id, voted_at desc)
  $sql$;

  -- ── intent_lineage — judgment-history entries ──────────────────────
  execute $sql$
    create table if not exists public.intent_lineage (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      occurred_at timestamptz not null,
      actor_name text not null,
      actor_role text,
      action_kind text not null check (action_kind in (
        'strategy','allocation','gaming','audit','financial','foundation','escalation','revision','local_optimization'
      )),
      body text not null,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now()
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_lineage_intent_time
      on public.intent_lineage (intent_id, occurred_at desc)
  $sql$;

  -- ── intent_resources — declared-vs-actual allocation snapshots ─────
  execute $sql$
    create table if not exists public.intent_resources (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      captured_at timestamptz not null default now(),
      declared_share numeric,   -- 0..100 (%) declared priority share
      actual_share numeric,     -- 0..100 (%) computed from bindings + assignees
      total_headcount int,
      allocated_headcount int,
      breakdown jsonb,          -- e.g., {"Product dev":12,"Traditional SI":480,"AI infra":8}
      note text
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_resources_intent_time
      on public.intent_resources (intent_id, captured_at desc)
  $sql$;

  -- ── intent_alignments — conflicts + Fallacy of Composition ─────────
  execute $sql$
    create table if not exists public.intent_alignments (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,  -- the parent under which alignment is evaluated
      detected_at timestamptz not null default now(),
      kind text not null check (kind in ('conflict','composition_fallacy','dimension_gap')),
      severity text not null default 'warn' check (severity in ('info','warn','alert')),
      title text not null,
      body text,
      involves_intent_ids uuid[] not null default '{}',  -- which sub-intents collide
      metadata jsonb,                                    -- e.g., {"sum_target_yen":20000000000,"after_audit_yen":8200000000}
      resolved_at timestamptz
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_alignments_open
      on public.intent_alignments (intent_id) where (resolved_at is null)
  $sql$;

  -- ── intent_escalations — triggered events + decision ───────────────
  execute $sql$
    create table if not exists public.intent_escalations (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      triggered_at timestamptz not null default now(),
      trigger_kind text not null check (trigger_kind in ('divergence','audit_drop','alignment','manual')),
      trigger_summary text not null,            -- "64pt divergence on i3"
      collected_context text,                   -- LLM-summarized field context
      flagged_assumptions text[] not null default '{}',
      decision_owner_name text,
      decision_owner_role text,
      status text not null default 'awaiting' check (status in ('awaiting','maintained','revised','retired')),
      decision_note text,
      decided_at timestamptz,
      decided_by uuid references auth.users(id)
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_escalations_open
      on public.intent_escalations (intent_id) where (status = 'awaiting')
  $sql$;

  -- ── intent_next_actions — AI Co-Pilot suggestions ──────────────────
  execute $sql$
    create table if not exists public.intent_next_actions (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      generated_at timestamptz not null default now(),
      label text not null,                      -- "A" / "B" / "C"
      title text not null,                      -- e.g., 'Tighten the "AI-Related" definition'
      hypothesis text,                          -- underlying hypothesis the action would test
      status text not null default 'proposed' check (status in ('proposed','accepted','rejected','converted')),
      converted_element_id uuid references public.elements(id) on delete set null,
      order_index real not null default 0
    )
  $sql$;
  execute $sql$
    create index if not exists idx_intent_next_actions_intent
      on public.intent_next_actions (intent_id, order_index)
  $sql$;

  -- ── RLS — every child table inherits visibility from the parent
  --         Strategy's `created_by`. Mirrors how strategies itself gates.
  --         (The strategies table was created direct on the hosted DB so
  --         we lean on its existing policies rather than redefining.)

  -- Helper: does the current auth user own the parent strategy of an intent?
  execute $sql$
    create or replace function public.user_owns_intent(p_intent_id uuid)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1
        from public.intents i
        join public.strategies s on s.id = i.strategy_id
        where i.id = p_intent_id and s.created_by = auth.uid()
      )
    $$
  $sql$;

  -- intents — owner of the parent strategy can do anything
  execute 'alter table public.intents enable row level security';
  execute 'drop policy if exists intents_all on public.intents';
  execute $sql$
    create policy intents_all on public.intents
      for all
      using (
        exists (select 1 from public.strategies s where s.id = strategy_id and s.created_by = auth.uid())
      )
      with check (
        exists (select 1 from public.strategies s where s.id = strategy_id and s.created_by = auth.uid())
      )
  $sql$;

  -- The 8 child tables all gate via user_owns_intent(intent_id).
  -- Loop to keep this terse and consistent. (format(%I) double-quotes the
  -- identifier; we build the policy name as a plain text first so it doesn't
  -- end up as two tokens like `"intent_bindings"_all`.)
  declare
    child_tables text[] := array[
      'intent_bindings','intent_audits','intent_predictions','intent_lineage',
      'intent_resources','intent_alignments','intent_escalations','intent_next_actions'
    ];
    tbl_name text;
    policy_name text;
  begin
    foreach tbl_name in array child_tables loop
      policy_name := tbl_name || '_all';
      execute format('alter table public.%I enable row level security', tbl_name);
      execute format('drop policy if exists %I on public.%I', policy_name, tbl_name);
      execute format($p$
        create policy %I on public.%I
          for all
          using (public.user_owns_intent(intent_id))
          with check (public.user_owns_intent(intent_id))
      $p$, policy_name, tbl_name);
    end loop;
  end;

end
$strategy_intent_migration$;

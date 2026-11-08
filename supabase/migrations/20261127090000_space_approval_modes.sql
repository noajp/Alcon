-- Approval modes: a Space chooses how Athena's writes are held —
--
--   activity_spaces.approval_mode  the Space's policy layer ('auto' —
--                   only a critical call asks, today's meaning exactly;
--                   'ask' — every effective write asks; 'free' — no
--                   execution approval is asked, and what would have
--                   asked runs as a policy approval instead). Existing
--                   Spaces land on 'auto', so nothing changes for them.
--   agent_runs.approval_mode      the mode a run started under,
--                   snapshotted by the engine when the run is first
--                   driven; null until then (and for runs that predate
--                   the column). A mode changed mid-run does not reach
--                   into the run already going.
--   agent_actions.decision_source / policy_mode
--                   who decided: null is a person, as every row so far;
--                   'policy' is the Space's free mode, with the mode
--                   recorded beside it. A policy row carries the same
--                   input, input_hash and display as a person's ask, so
--                   what ran without asking stays exactly as auditable
--                   as what was approved.
--   space_approval_mode_changes   who set the mode, when, from what to
--                   what. Written only by the RPC below.
--   set_space_approval_mode       the one way the mode changes: an
--                   owner's act, the update and its history written
--                   atomically. Members read the mode; nobody edits the
--                   column directly (no update policy grants it, and the
--                   engines read it server-side).
--
-- The floor no mode lifts is not here — it never was a column: the
-- destination guards, the Vault's rules, a connection's consent and a
-- drafted connection's activation live in their own layers and do not
-- read this mode.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
begin
  if to_regclass('public.activity_spaces') is null then
    raise notice 'approval modes skipped: activity_spaces not present';
    return;
  end if;

  -- ── The Space's mode ────────────────────────────────────────────────
  execute 'alter table public.activity_spaces add column if not exists approval_mode text not null default ''auto''';
  execute 'alter table public.activity_spaces drop constraint if exists activity_spaces_approval_mode_check';
  execute 'alter table public.activity_spaces add constraint activity_spaces_approval_mode_check check (approval_mode in (''ask'', ''auto'', ''free''))';
  execute 'grant select (approval_mode) on public.activity_spaces to authenticated';

  -- ── A run's snapshot of the mode it started under ───────────────────
  if to_regclass('public.agent_runs') is not null then
    execute 'alter table public.agent_runs add column if not exists approval_mode text';
    execute 'alter table public.agent_runs drop constraint if exists agent_runs_approval_mode_check';
    execute 'alter table public.agent_runs add constraint agent_runs_approval_mode_check check (approval_mode is null or approval_mode in (''ask'', ''auto'', ''free''))';
    execute 'grant select (approval_mode) on public.agent_runs to authenticated';
  end if;

  -- ── Who decided an action: a person, or the Space's policy ──────────
  if to_regclass('public.agent_actions') is not null then
    execute 'alter table public.agent_actions add column if not exists decision_source text';
    execute 'alter table public.agent_actions add column if not exists policy_mode text';
    execute 'alter table public.agent_actions drop constraint if exists agent_actions_decision_source_check';
    execute 'alter table public.agent_actions add constraint agent_actions_decision_source_check check (decision_source is null or decision_source = ''policy'')';
    execute 'alter table public.agent_actions drop constraint if exists agent_actions_policy_mode_check';
    execute 'alter table public.agent_actions add constraint agent_actions_policy_mode_check check (policy_mode is null or policy_mode in (''ask'', ''auto'', ''free''))';
    execute 'grant select (decision_source, policy_mode) on public.agent_actions to authenticated';
  end if;

  -- ── The history of mode changes ─────────────────────────────────────
  create table if not exists public.space_approval_mode_changes (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    from_mode text check (from_mode is null or from_mode in ('ask', 'auto', 'free')),
    to_mode text not null check (to_mode in ('ask', 'auto', 'free')),
    changed_by uuid,
    created_at timestamptz not null default now()
  );
  create index if not exists space_approval_mode_changes_space_idx
    on public.space_approval_mode_changes (activity_space_id, created_at desc);
  alter table public.space_approval_mode_changes enable row level security;
  drop policy if exists space_approval_mode_changes_select on public.space_approval_mode_changes;
  create policy space_approval_mode_changes_select on public.space_approval_mode_changes for select to authenticated
    using (public.is_activity_space_member(activity_space_id));
  -- No insert/update/delete policy: the RPC below is the only writer, so
  -- a history row always names a change that actually happened.

  -- ── The one way the mode changes ────────────────────────────────────
  execute $f$
  create or replace function public.set_space_approval_mode(p_space_id uuid, p_mode text)
  returns text language plpgsql security definer set search_path = public as $body$
  declare
    v_current text;
  begin
    if p_mode not in ('ask', 'auto', 'free') then
      raise exception 'unknown approval mode: %', p_mode;
    end if;
    if not public.is_activity_space_owner(p_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    select approval_mode into v_current from public.activity_spaces where id = p_space_id for update;
    if v_current is null then raise exception 'space not found'; end if;
    if v_current = p_mode then return v_current; end if;
    update public.activity_spaces set approval_mode = p_mode, updated_at = now() where id = p_space_id;
    insert into public.space_approval_mode_changes (activity_space_id, from_mode, to_mode, changed_by)
      values (p_space_id, v_current, p_mode, (select auth.uid()));
    return p_mode;
  end
  $body$
  $f$;
  execute 'revoke all on function public.set_space_approval_mode(uuid, text) from public';
  execute 'grant execute on function public.set_space_approval_mode(uuid, text) to authenticated';
end
$$;

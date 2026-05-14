-- AI-driven execution — Symphony-style autonomous agent runs.
--
-- An "agent run" executes a single Element autonomously: it plans, works the
-- task, ticks off existing sub-elements, posts its deliverable as a comment,
-- and stops at "review" for a human to approve. agent_run_steps is the live
-- "Workpad" — one row per step so the UI can stream progress.
--
-- The Anthropic API key stays a server-side Edge Function secret
-- (ANTHROPIC_API_KEY); domains.ai_config only holds behaviour config
-- (model / instructions / max_steps / enabled).

-- ── Per-Domain agent configuration ──────────────────────────────────────────
alter table if exists public.domains
  add column if not exists ai_config jsonb;

-- ── agent_runs ──────────────────────────────────────────────────────────────
create table if not exists public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  element_id     uuid not null references public.elements(id) on delete cascade,
  domain_id      uuid references public.domains(id) on delete set null,
  worker_id      uuid references public.workers(id) on delete set null,
  status         text not null default 'queued',
    -- queued | running | awaiting_review | completed | failed | cancelled
  model          text,
  triggered_from text,             -- 'board' | 'detail'
  triggered_by   uuid,             -- auth.users.id of whoever pressed Start
  summary        text,             -- one-line deliverable summary
  result         text,             -- full deliverable (markdown)
  error          text,             -- failure message
  step_count     integer not null default 0,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists agent_runs_element_idx
  on public.agent_runs (element_id, created_at desc);
create index if not exists agent_runs_status_idx
  on public.agent_runs (status);

-- ── agent_run_steps (the live "Workpad") ────────────────────────────────────
create table if not exists public.agent_run_steps (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.agent_runs(id) on delete cascade,
  idx        integer not null,
  type       text not null,
    -- plan | thought | action | subelement | comment | status | result | error
  title      text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists agent_run_steps_run_idx
  on public.agent_run_steps (run_id, idx);

-- ── RLS — workspace-shared, same bar as elements / element_comments ──────────
-- The run-agent Edge Function writes with the service role (bypasses RLS);
-- the frontend reads/polls with the user session.
alter table public.agent_runs      enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists agent_runs_rw on public.agent_runs;
create policy agent_runs_rw on public.agent_runs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists agent_run_steps_rw on public.agent_run_steps;
create policy agent_run_steps_rw on public.agent_run_steps
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

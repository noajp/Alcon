-- Async question tickets (back-half program B12): "I don't know" stops
-- being a run failure and becomes a queue item. An execute-mode run
-- files a question for a person with ask_question (_shared/
-- questionTickets.ts), rests in awaiting_input, and resumes when the
-- person answers — the answer travels the new `answer` entry
-- (run-agent/dispatch.ts) and is appended to the paused turn as the
-- ask_question call's tool result, verbatim. Work that depends on the
-- resting run waits by the graph's own dependency rule; unrelated
-- work proceeds. A ticket nobody answers inside its window expires,
-- and the automations tick ends the dependent run as blocked with the
-- unanswered question preserved on the record — never a guessed
-- answer, never a silent proceed.
--
--   question_tickets  one row per question: the asking run (and its
--                     Element / Strategy), the question, its options
--                     (2–5 choices, at most one flagged as the agent's
--                     recommendation), the context the person needs
--                     (what decision turns on it, links to artifacts
--                     and records — not a prose dump), what the agent
--                     tried first (checked for presence by code, its
--                     quality judged by nobody — the design's honest
--                     weak gate against ticket spam), the person's
--                     answer verbatim once given, and the expiry
--                     (default 7 days, matching the draft lifetimes).
--                     question_key is the dedup identity: normalized
--                     question text, unique among a run's OPEN
--                     tickets — one question, one ticket; re-asking
--                     while a ticket is open reuses it.
--
-- Reads: Space members read their Space's tickets (the Inbox card
-- reads the row the notification names). No insert / update / delete
-- policy: the engine (service role) is the only writer — a ticket is
-- born from a run's tool call, answered through the run's own entry
-- under the starter-only rule, and expired by the tick. A person
-- never authors or edits one directly, and the model whose question
-- it is cannot mark it answered.
--
-- The notification a ticket raises carries the new kind 'question'
-- and the ticket's id, so the Inbox reader opens the ticket card
-- (options as tappable answers) instead of the Element.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.agent_runs') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.notifications') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'question tickets skipped: activity_spaces, agent_runs, elements, strategies, notifications or is_activity_space_member not present';
    return;
  end if;

  -- ── The tickets ───────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.question_tickets (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid references public.activity_spaces(id) on delete cascade,
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      element_id uuid references public.elements(id) on delete set null,
      strategy_id uuid references public.strategies(id) on delete set null,
      tool_use_id text not null,
      question text not null,
      question_key text not null,
      options jsonb not null default '[]',
      context jsonb not null default '{}',
      tried text not null,
      status text not null default 'open' check (status in ('open', 'answered', 'expired')),
      answer text,
      answered_by uuid,
      answered_at timestamptz,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists question_tickets_space_idx on public.question_tickets (activity_space_id, status, created_at desc)';
  execute 'create index if not exists question_tickets_run_idx on public.question_tickets (run_id, status)';
  execute 'create index if not exists question_tickets_expiry_idx on public.question_tickets (expires_at) where status = ''open''';
  -- One question, one ticket: the same question (its normalized key)
  -- may stand open only once per run; a re-ask reuses the open row.
  execute 'create unique index if not exists question_tickets_open_key_idx on public.question_tickets (run_id, question_key) where status = ''open''';
  -- One asking call files at most one ticket, however the slices fall.
  execute 'create unique index if not exists question_tickets_call_idx on public.question_tickets (run_id, tool_use_id)';

  execute 'alter table public.question_tickets enable row level security';
  execute 'revoke all on table public.question_tickets from public, anon, authenticated';
  execute 'grant select on table public.question_tickets to authenticated';
  execute 'drop policy if exists question_tickets_select on public.question_tickets';
  execute 'create policy question_tickets_select on public.question_tickets for select to authenticated using (activity_space_id is not null and public.is_activity_space_member(activity_space_id))';

  -- ── The notification: the question kind, and the ticket it names ──
  execute 'alter table public.notifications add column if not exists question_ticket_id uuid references public.question_tickets(id) on delete set null';
  execute 'create index if not exists notifications_question_ticket_idx on public.notifications (question_ticket_id) where question_ticket_id is not null';
  execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
    || '''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'','
    || '''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced'','
    || '''measure_missed'', ''heartbeat'', ''promotion'', ''question'''
    || ']::text[]))';
end
$$;

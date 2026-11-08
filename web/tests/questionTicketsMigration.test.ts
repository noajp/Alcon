import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Async question tickets (B12): the migration's shape is part of the
// contract — the ticket row (question, options, context, what was
// tried, the person's verbatim answer, the expiry), the dedup
// identity unique among a run's OPEN tickets, members reading their
// Space's tickets while nobody writes through RLS (the engine is
// the only writer), and the notification kind 'question' with the
// ticket it names.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261209090000_question_tickets.sql", import.meta.url),
  "utf8",
);

describe("question tickets migration (B12)", () => {
  it("is guarded and creates the table", () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regclass('public.elements')");
    expect(sql).toContain("to_regclass('public.strategies')");
    expect(sql).toContain("to_regclass('public.notifications')");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_member(uuid)')");
    expect(sql).toContain("create table if not exists public.question_tickets");
  });

  it("a ticket carries the question, its evidence and the person's answer", () => {
    expect(sql).toContain("run_id uuid not null references public.agent_runs(id) on delete cascade");
    expect(sql).toContain("element_id uuid references public.elements(id) on delete set null");
    expect(sql).toContain("strategy_id uuid references public.strategies(id) on delete set null");
    expect(sql).toContain("tool_use_id text not null");
    expect(sql).toContain("question text not null");
    expect(sql).toContain("options jsonb not null default '[]'");
    expect(sql).toContain("context jsonb not null default '{}'");
    expect(sql).toContain("tried text not null");
    expect(sql).toContain("check (status in ('open', 'answered', 'expired'))");
    expect(sql).toContain("answer text");
    expect(sql).toContain("answered_by uuid");
    expect(sql).toContain("answered_at timestamptz");
    expect(sql).toContain("expires_at timestamptz not null");
  });

  it("one question, one ticket: the key is unique among a run's open tickets, and one call files at most one", () => {
    expect(sql).toContain("question_key text not null");
    expect(sql).toContain("create unique index if not exists question_tickets_open_key_idx on public.question_tickets (run_id, question_key) where status = ''open''");
    expect(sql).toContain("create unique index if not exists question_tickets_call_idx on public.question_tickets (run_id, tool_use_id)");
    expect(sql).toContain("create index if not exists question_tickets_expiry_idx on public.question_tickets (expires_at) where status = ''open''");
  });

  it("RLS: members read their Space's tickets; nobody writes through RLS", () => {
    expect(sql).toContain("alter table public.question_tickets enable row level security");
    expect(sql).toContain("revoke all on table public.question_tickets from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.question_tickets to authenticated");
    expect(sql).toContain("create policy question_tickets_select on public.question_tickets");
    expect(sql).toContain("using (activity_space_id is not null and public.is_activity_space_member(activity_space_id))");
    expect(sql).not.toMatch(/for (insert|update|delete)/);
  });

  it("the notification gains the 'question' kind, restated whole, and the ticket it names", () => {
    expect(sql).toContain("add column if not exists question_ticket_id uuid references public.question_tickets(id) on delete set null");
    expect(sql).toContain("notifications_question_ticket_idx");
    // The whole standing list, plus the new kind — a restatement
    // that dropped a kind would refuse live notifications.
    for (const kind of ["mention", "assigned", "comment", "status_change", "approval_requested",
      "approval_decided", "due_soon", "review_due", "invite", "asset_announced",
      "measure_missed", "heartbeat", "promotion", "question"]) {
      expect(sql).toContain(`''${kind}''`);
    }
  });
});

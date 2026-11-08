import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Outcome records (B4): the migration's shape is part of the contract —
// one outcome per run, rollups keyed per scope/window, RLS on with
// member reads, and NO write policy for anyone: the automations
// collector (service role) is the only writer, so a client can never
// forge a human signal.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261131090000_outcome_records.sql", import.meta.url),
  "utf8",
);

describe("outcome records migration (B4)", () => {
  it("is guarded and creates both tables", () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("create table if not exists public.run_outcomes");
    expect(sql).toContain("create table if not exists public.outcome_rollups");
  });

  it("one outcome per run, sealed at the finish", () => {
    expect(sql).toContain("run_id uuid not null unique references public.agent_runs(id) on delete cascade");
    expect(sql).toContain("finished_at timestamptz not null");
    expect(sql).toContain("definition_version integer");
  });

  it("the human block is an enum-checked, fill-once record", () => {
    expect(sql).toContain("human_signal text not null default 'none'");
    expect(sql).toContain("check (human_signal in ('accepted', 'rejected', 'rework', 'none'))");
    expect(sql).toContain("signal_source in ('approval', 'acceptance', 'reopen', 'rollback', 'review')");
    // The open-scan index the collector's signal pass rides.
    expect(sql).toContain("where human_signal = 'none'");
  });

  it("rollups are keyed per scope and window", () => {
    expect(sql).toContain("unique (scope_kind, scope_id, window_start, window_days)");
    expect(sql).toContain("check (scope_kind in ('definition', 'connector_command', 'space'))");
    expect(sql).toContain("window_days integer not null");
  });

  it("RLS is on, members read, and nobody writes through a policy", () => {
    expect(sql).toContain("alter table public.run_outcomes enable row level security");
    expect(sql).toContain("alter table public.outcome_rollups enable row level security");
    expect(sql).toContain("for select");
    expect(sql).not.toMatch(/for (insert|update|delete)/);
  });
});

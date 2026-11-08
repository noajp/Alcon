import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Plan mode (B8): the migration's shape is part of the contract —
// agent_runs.plan_mode beside rehearsal (the browser starts a plan run
// and reads the flag back), and agent_actions learning 'plan' as a
// decision source beside 'policy' and 'track-record', nothing else.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261207090000_plan_mode.sql", import.meta.url),
  "utf8",
);

describe("plan mode migration (B8)", () => {
  it("is guarded on both tables it touches", () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regclass('public.agent_actions')");
  });

  it("adds plan_mode to agent_runs, defaulted off", () => {
    expect(sql).toContain("add column if not exists plan_mode boolean not null default false");
  });

  it("the browser may set and read plan_mode, mirroring the rehearsal grants", () => {
    expect(sql).toContain("grant insert (plan_mode), select (plan_mode) on public.agent_runs to authenticated");
  });

  it("agent_actions learns 'plan' beside 'policy' and 'track-record'", () => {
    expect(sql).toContain("agent_actions_decision_source_check");
    expect(sql).toContain("check (decision_source is null or decision_source in ('policy', 'track-record', 'plan'))");
  });
});

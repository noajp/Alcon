import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Circuit breakers (B11): the migration's shape is part of the
// contract — the settled call record the rules count, and the trip
// rows that make a pause auditable. The call log is engine
// bookkeeping with NO policy at all (service role only: target keys
// can carry repository paths and recipient addresses); trips are
// member-readable for their Space and writable by nobody through RLS
// — the gate writes them, a decision acknowledges them, both service
// role.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261208090000_breakers.sql", import.meta.url),
  "utf8",
);

describe("circuit breakers migration (B11)", () => {
  it("is guarded and creates both tables", () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regclass('public.agent_actions')");
    expect(sql).toContain("to_regclass('public.integrations')");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_member(uuid)')");
    expect(sql).toContain("create table if not exists public.integration_call_log");
    expect(sql).toContain("create table if not exists public.breaker_trips");
  });

  it("the call log carries the breaker's evidence shape, with a sequence for the run window", () => {
    expect(sql).toContain("seq bigint generated always as identity");
    expect(sql).toContain("command_name text not null");
    expect(sql).toContain("is_write boolean not null");
    expect(sql).toContain("ok boolean not null");
    expect(sql).toContain("target_key text");
    expect(sql).toContain("integration_call_log_target_idx");
    expect(sql).toContain("integration_call_log_run_idx");
  });

  it("a trip names its rule, its target, its evidence and its one-line reason", () => {
    expect(sql).toContain("check (rule in ('write_rate', 'error_rate', 'first_destination'))");
    expect(sql).toContain("check (status in ('open', 'acknowledged'))");
    expect(sql).toContain("evidence jsonb not null default '{}'");
    expect(sql).toContain("reason text not null");
    expect(sql).toContain("action_id uuid references public.agent_actions(id) on delete set null");
    expect(sql).toContain("acknowledged_by uuid");
    expect(sql).toContain("acknowledged_at timestamptz");
  });

  it("RLS: members read their Space's trips; the call log has no policy at all; nobody writes through RLS", () => {
    expect(sql).toContain("alter table public.integration_call_log enable row level security");
    expect(sql).toContain("alter table public.breaker_trips enable row level security");
    expect(sql).toContain("create policy breaker_trips_select on public.breaker_trips");
    expect(sql).toContain("using (public.is_activity_space_member(activity_space_id))");
    expect(sql).not.toContain("integration_call_log_select");
    expect(sql).not.toMatch(/for (insert|update|delete)/);
  });
});

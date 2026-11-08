import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Graduated autonomy (B7): the migration's shape is part of the
// contract — the track-record rollup, the grants the gate reads, and
// their change log, RLS on with member reads and NO write policy for
// anyone: the tick evaluator (service role) and the synchronous
// revocation write grants; a person changes one only by pinning,
// through the owner-checked RPC. The one existing-table change is
// agent_actions learning its second non-person decision source.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261206090000_autonomy_grants.sql", import.meta.url),
  "utf8",
);

describe("autonomy grants migration (B7)", () => {
  it("is guarded and creates all three tables", () => {
    expect(sql).toContain("to_regclass('public.agent_actions')");
    expect(sql).toContain("to_regclass('public.run_outcomes')");
    expect(sql).toContain("create table if not exists public.command_track_records");
    expect(sql).toContain("create table if not exists public.autonomy_grants");
    expect(sql).toContain("create table if not exists public.autonomy_changes");
  });

  it("agent_actions learns 'track-record' beside 'policy', nothing else", () => {
    expect(sql).toContain("agent_actions_decision_source_check");
    // The check is added inside a single-quoted EXECUTE, so the file
    // carries the quotes doubled.
    expect(sql).toContain("check (decision_source is null or decision_source in (''policy'', ''track-record''))");
  });

  it("the record is keyed per command and window, with the streak counts", () => {
    expect(sql).toContain("unique (activity_space_id, integration_id, action, window_start, window_days)");
    expect(sql).toContain("clean_streak integer not null default 0");
    expect(sql).toContain("checked_in_streak integer not null default 0");
    expect(sql).toContain("verify_green_streak integer not null default 0");
    expect(sql).toContain("incidents integer not null default 0");
  });

  it("a grant is one row per command, with its lane, level, basis and pin", () => {
    expect(sql).toContain("unique (activity_space_id, integration_id, action)");
    expect(sql).toContain("check (lane in (1, 2, 3))");
    expect(sql).toContain("check (level in ('ask', 'auto'))");
    expect(sql).toContain("check (granted_by in ('system', 'owner'))");
    expect(sql).toContain("basis jsonb not null default '{}'");
    expect(sql).toContain("pinned boolean not null default false");
    expect(sql).toContain("required_clean integer not null default 0");
    expect(sql).toContain("'rejection', 'verify_mismatch', 'reopen', 'rollback'");
  });

  it("level changes are logged with their cause", () => {
    expect(sql).toContain("check (cause in ('promotion', 'demotion', 'pin', 'unpin'))");
    expect(sql).toContain("check (to_level in ('ask', 'auto'))");
  });

  it("RLS is on, members read, and nobody writes through a policy", () => {
    expect(sql).toContain("alter table public.command_track_records enable row level security");
    expect(sql).toContain("alter table public.autonomy_grants enable row level security");
    expect(sql).toContain("alter table public.autonomy_changes enable row level security");
    expect(sql).toContain("public.is_activity_space_member(activity_space_id)");
    expect(sql).toContain("for select");
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("pinning is the owner's act, checked inside the RPC", () => {
    expect(sql).toContain("create or replace function public.set_autonomy_pin(");
    expect(sql).toContain("public.is_activity_space_owner(p_space_id)");
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain("grant execute on function public.set_autonomy_pin(uuid, uuid, text, text) to authenticated");
    expect(sql).toContain("revoke all on function public.set_autonomy_pin(uuid, uuid, text, text) from public");
  });
});

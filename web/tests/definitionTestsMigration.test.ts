import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Definition tests (B14): the migration's shape is part of the
// contract — the fixture's home, its visibility (exactly the source
// run's: Space members), the capturer-pinned insert, the
// captured_by/owner delete line, and above all the ABSENCE of any
// update path: last_* results are written by the engine's settle
// (service role) alone, so a member's session can never rewrite a
// test's recorded result.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261214090000_definition_tests.sql", import.meta.url),
  "utf8",
);

describe("definition tests migration (B14)", () => {
  it("is guarded and creates the table with its result columns", () => {
    expect(sql).toContain("to_regclass('public.definitions')");
    expect(sql).toContain("to_regclass('public.activity_spaces')");
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_member(uuid)')");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_owner(uuid)')");
    expect(sql).toContain("create table if not exists public.definition_tests");
    expect(sql).toContain("fixture jsonb not null");
    expect(sql).toContain("expected jsonb not null");
    expect(sql).toContain("tainted boolean not null default false");
    expect(sql).toContain("last_result jsonb");
    expect(sql).toContain("last_body_hash text");
    expect(sql).toContain("definition_tests_definition_idx");
    expect(sql).toContain("definition_tests_space_idx");
  });

  it("deleting a definition takes its tests with it; deleting a run only unlinks", () => {
    expect(sql).toContain("definition_id uuid not null references public.definitions(id) on delete cascade");
    expect(sql).toContain("source_run_id uuid references public.agent_runs(id) on delete set null");
    expect(sql).toContain("last_run_id uuid references public.agent_runs(id) on delete set null");
  });

  it("RLS: members select, the capturer inserts as themselves, capturer or owner deletes", () => {
    expect(sql).toContain("alter table public.definition_tests enable row level security");
    expect(sql).toContain("create policy definition_tests_select on public.definition_tests");
    expect(sql).toContain("using (public.is_activity_space_member(activity_space_id))");
    expect(sql).toContain("create policy definition_tests_insert on public.definition_tests");
    expect(sql).toContain("with check (public.is_activity_space_member(activity_space_id) and captured_by = (select auth.uid()))");
    expect(sql).toContain("create policy definition_tests_delete on public.definition_tests");
    expect(sql).toContain("using (captured_by = (select auth.uid()) or public.is_activity_space_owner(activity_space_id))");
  });

  it("there is NO update policy and no update grant — results move by service role only", () => {
    // The negative assertions run on the SQL with its comments
    // stripped: the header prose DESCRIBES the absence ("the table
    // grants no update at all"), and prose is not a grant.
    const code = sql.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/for update/);
    expect(sql).toContain("grant select, insert, delete on public.definition_tests to authenticated");
    expect(code).not.toMatch(/grant[^;]*update[^;]*definition_tests/);
  });

  it("the settle's notification kind joins the Inbox list as a superset, naming its test", () => {
    expect(sql).toContain("add column if not exists definition_test_id uuid references public.definition_tests(id) on delete set null");
    expect(sql).toContain("notifications_definition_test_idx");
    expect(sql).toContain("''definition_test''");
    // The restated list keeps every kind the Inbox already accepts.
    for (const kind of ["mention", "assigned", "comment", "status_change", "approval_requested",
      "approval_decided", "due_soon", "review_due", "invite", "asset_announced",
      "measure_missed", "heartbeat", "promotion", "question"]) {
      expect(sql).toContain(`''${kind}''`);
    }
  });
});

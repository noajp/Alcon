import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Verifier calibration (B5): the migration's shape is part of the
// contract — a refreshed rollup and a lifecycle queue, RLS on with
// member reads, NO write policy for anyone: the tick evaluator
// (service role) opens and refreshes candidates, and a person
// resolves one only through the owner-checked RPC.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261204090000_verifier_calibration.sql", import.meta.url),
  "utf8",
);

describe("verifier calibration migration (B5)", () => {
  it("is guarded and creates both tables", () => {
    expect(sql).toContain("to_regclass('public.run_outcomes')");
    expect(sql).toContain("to_regclass('public.definitions')");
    expect(sql).toContain("create table if not exists public.verifier_calibration");
    expect(sql).toContain("create table if not exists public.definition_revision_candidates");
  });

  it("the rollup is keyed per definition and window, with the pair counts", () => {
    expect(sql).toContain("unique (activity_space_id, definition_id, window_start, window_days)");
    expect(sql).toContain("agree_pass integer not null default 0");
    expect(sql).toContain("false_pass integer not null default 0");
    expect(sql).toContain("false_fail integer not null default 0");
    expect(sql).toContain("pairs integer not null default 0");
  });

  it("the queue carries the claim: direction, rate, pairs, evidence, status", () => {
    expect(sql).toContain("check (reason in ('false_pass_heavy', 'false_fail_heavy', 'gap_cluster'))");
    expect(sql).toContain("check (status in ('open', 'dismissed', 'addressed'))");
    expect(sql).toContain("sample_outcome_ids uuid[] not null default '{}'");
    expect(sql).toContain("rate double precision not null");
  });

  it("at most one open candidate per definition", () => {
    expect(sql).toContain("create unique index if not exists definition_revision_candidates_open_idx");
    expect(sql).toContain("where status = ''open''");
  });

  it("RLS is on, members read, and nobody writes through a policy", () => {
    expect(sql).toContain("alter table public.verifier_calibration enable row level security");
    expect(sql).toContain("alter table public.definition_revision_candidates enable row level security");
    expect(sql).toContain("public.is_activity_space_member(activity_space_id)");
    expect(sql).toContain("for select");
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("resolving is the owner's act, checked inside the RPC", () => {
    expect(sql).toContain("create or replace function public.resolve_revision_candidate(");
    expect(sql).toContain("public.is_activity_space_owner(v_cand.activity_space_id)");
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain("grant execute on function public.resolve_revision_candidate(uuid, text) to authenticated");
  });
});

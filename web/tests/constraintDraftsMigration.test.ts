import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Constraint drafts (B6): the migration's shape is part of the
// contract — the draft queue and the activated truth, RLS on with
// member reads, NO write policy for anyone: the tick derivation
// (service role) writes drafts, and a person decides them only
// through the owner-checked, hash-bound RPCs. Activation is the
// stored-trust gate: the RPC compares the draft's stamped target
// snapshot against the live target and refuses a drifted one.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261205090000_constraint_drafts.sql", import.meta.url),
  "utf8",
);

describe("constraint drafts migration (B6)", () => {
  it("is guarded and extends B4's outcomes with the evidence block", () => {
    expect(sql).toContain("to_regclass('public.run_outcomes')");
    expect(sql).toContain("add column if not exists evidence jsonb");
    expect(sql).toContain("add column if not exists planner_constraints jsonb");
  });

  it("creates both tables with the design's fields", () => {
    expect(sql).toContain("create table if not exists public.constraint_drafts");
    expect(sql).toContain("create table if not exists public.planning_constraints");
    expect(sql).toContain("check (scope in ('definition', 'strategy'))");
    expect(sql).toContain("check (derived_from in ('verifier_gap', 'rejection_cluster', 'correction_pattern'))");
    expect(sql).toContain("evidence_outcome_ids uuid[] not null default '{}'");
    expect(sql).toContain("structure_hash text");
    expect(sql).toContain("binding_hash text");
    expect(sql).toContain("target_snapshot text");
    expect(sql).toContain("check (status in ('draft', 'awaiting_review', 'activated', 'rejected', 'expired'))");
    expect(sql).toContain("calibration_candidate_id uuid references public.definition_revision_candidates(id)");
  });

  it("the activated truth carries its baseline and its effect flag", () => {
    expect(sql).toContain("baseline_rate double precision not null");
    expect(sql).toContain("baseline_outcomes integer not null");
    expect(sql).toContain("baseline_with integer not null");
    expect(sql).toContain("check (effect_status in ('measuring', 'improving', 'established', 'ineffective'))");
    expect(sql).toContain("check (retire_reason is null or retire_reason in ('owner', 'folded'))");
  });

  it("one open draft per target, one active constraint per (target, signature)", () => {
    expect(sql).toContain("create unique index if not exists constraint_drafts_one_open_definition");
    expect(sql).toContain("create unique index if not exists constraint_drafts_one_open_strategy");
    expect(sql).toContain("where target_definition_id is not null and status in (''draft'', ''awaiting_review'')");
    expect(sql).toContain("create unique index if not exists planning_constraints_one_active_definition");
    expect(sql).toContain("where target_definition_id is not null and status = ''active''");
  });

  it("RLS is on, members read, and nobody writes through a policy", () => {
    expect(sql).toContain("alter table public.constraint_drafts enable row level security");
    expect(sql).toContain("alter table public.planning_constraints enable row level security");
    expect(sql).toContain("public.is_activity_space_member(activity_space_id)");
    expect(sql).toContain("for select");
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("activation is the owner's act, checked inside the RPC", () => {
    expect(sql).toContain("create or replace function public.activate_constraint_draft(p_draft_id uuid)");
    expect(sql).toContain("public.is_activity_space_owner(v_draft.activity_space_id)");
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain("grant execute on function public.activate_constraint_draft(uuid) to authenticated");
  });

  it("activation refuses a target edited after drafting — the snapshot comparison", () => {
    expect(sql).toContain("d.body is not distinct from v_draft.target_snapshot");
    expect(sql).toContain("起草後に編集されています");
    expect(sql).toContain("v_draft.status <> 'awaiting_review'");
  });

  it("activation lands the constraint and appends the Strategy projection", () => {
    expect(sql).toContain("insert into public.planning_constraints");
    expect(sql).toContain("set planner_constraints = s.planner_constraints || jsonb_build_array(jsonb_build_object(");
    expect(sql).toContain("'constraint_id', v_constraint");
    expect(sql).toContain("'draft_id', v_draft.id");
  });

  it("rejection and retirement are owner-checked RPCs too", () => {
    expect(sql).toContain("create or replace function public.reject_constraint_draft(p_draft_id uuid)");
    expect(sql).toContain("create or replace function public.deactivate_planning_constraint(");
    expect(sql).toContain("public.is_activity_space_owner(v_con.activity_space_id)");
    expect(sql).toContain("grant execute on function public.reject_constraint_draft(uuid) to authenticated");
    expect(sql).toContain("grant execute on function public.deactivate_planning_constraint(uuid, text) to authenticated");
  });

  it("retirement moves the Strategy projection's record to retired, never deletes it", () => {
    expect(sql).toContain("'status', 'retired'");
    expect(sql).toContain("jsonb_array_elements(s.planner_constraints)");
  });
});

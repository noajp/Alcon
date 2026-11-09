import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Capability attenuation for chained runs (B10): the migration is
// the shelf the whole piece stands on — one guarded column, a
// trigger that makes a minted scope insert-only-by-the-engine and
// immutable afterwards, and the chain_scope() helper beside
// is_delegated_request(). The trigger's two refusals are what let
// the decision path skip any re-check (design §5.4): argument rules
// can change while a run rests, a scope cannot change at all.
const sql = readFileSync(
  new URL("../../supabase/migrations/20261211090000_chain_scope.sql", import.meta.url),
  "utf8",
);

describe("chain scope migration (B10)", () => {
  it("is guarded on the tables and helpers it stands on", () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regprocedure('public.is_delegated_request()')");
  });

  it("adds the one column, guarded", () => {
    expect(sql).toContain("alter table public.agent_runs add column if not exists chain_scope jsonb");
    // No new table, no agent_actions change — a chain denial's
    // evidence is the trace step and the verdict block, as with a
    // manifest denial today.
    expect(sql).not.toContain("create table if not exists");
    expect(sql).not.toContain("alter table public.agent_actions");
  });

  it("a scope is writable only at insert, only by the service role", () => {
    expect(sql).toContain("create or replace function public.guard_agent_run_chain_scope()");
    expect(sql).toContain("before insert or update on public.agent_runs");
    expect(sql).toContain("new.chain_scope is not null");
    expect(sql).toContain("coalesce(auth.jwt() ->> 'role', '') <> 'service_role'");
    expect(sql).toContain("a run''s chain scope is minted by the engine alone");
  });

  it("a written scope never changes afterwards, by anyone", () => {
    expect(sql).toContain("new.chain_scope is distinct from old.chain_scope");
    expect(sql).toContain("a run''s chain scope never changes once minted");
  });

  it("chain_scope() exposes the claim beside is_delegated_request(), with its grants", () => {
    expect(sql).toContain("create or replace function public.chain_scope()");
    expect(sql).toContain("select auth.jwt() -> 'alcon_chain'");
    expect(sql).toContain("revoke all on function public.chain_scope() from public");
    expect(sql).toContain("grant execute on function public.chain_scope() to anon, authenticated, service_role");
  });
});

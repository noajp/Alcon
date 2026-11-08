import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20261210090000_write_compensations.sql', import.meta.url), 'utf8');

describe('write_compensations migration (B9)', () => {
  it('creates the table guarded, with the state machine and the saga link', () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain('create table if not exists public.write_compensations');
    expect(sql).toContain('seq bigint generated always as identity');
    expect(sql).toContain("kind in ('write', 'compensation')");
    expect(sql).toContain('compensates_id uuid references public.write_compensations(id) on delete set null');
    expect(sql).toContain("'pending', 'compensating', 'compensated', 'compensation_failed', 'declined', 'reported'");
    expect(sql).toContain("verify_status in ('ok', 'mismatch', 'unverified')");
    expect(sql).toContain('undo_input jsonb not null');
  });

  it('reads are member-scoped and there is no write policy (engine only)', () => {
    expect(sql).toContain('create policy write_compensations_select on public.write_compensations');
    expect(sql).toContain('public.is_activity_space_member(activity_space_id)');
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("decision_source learns 'compensation' by the guarded re-add (B7/B8 precedent)", () => {
    expect(sql).toContain('drop constraint if exists agent_actions_decision_source_check');
    expect(sql).toContain("''policy'', ''track-record'', ''plan'', ''compensation''");
  });
});

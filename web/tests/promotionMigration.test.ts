import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// PR1 of the promotion path: the records. The migration lays down
// promotion_drafts, the sixth subject on agent_runs, the rehearsal
// mark, the definition's provenance column, the promotion notification
// kind and the offer's once-per-memory mark — guarded, in the standing
// style, and with no behaviour change (the activation RPCs arrive with
// PR4's own migration).
const sql = readFileSync(
  new URL('../../supabase/migrations/20261130090000_promotion.sql', import.meta.url),
  'utf8',
);

describe('promotion migration (PR1)', () => {
  it('is guarded for preview replay', () => {
    expect(sql).toContain("to_regclass('public.activity_spaces')");
    expect(sql).toContain("to_regclass('public.definitions')");
    expect(sql).toContain('promotion skipped');
  });

  it('creates promotion_drafts with the design’s columns and statuses', () => {
    expect(sql).toContain('create table if not exists public.promotion_drafts');
    for (const col of [
      'source_kind', 'source_memory_id', 'source_run_id', 'target_definition_id',
      'binding', 'base_definition_hash', 'tested_structure_hash', 'tested_binding_hash',
      'draft_run_id', 'rehearsal_run_id', 'rehearsal_report', 'failure_class',
      'material_sources', 'activated_definition_id', 'activated_automation_id', 'activated_body',
      'activated_structure_hash', 'activated_binding_hash', 'events', 'expires_at',
    ]) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain("'drafting', 'awaiting_input', 'rehearsing', 'awaiting_review'");
    expect(sql).toContain("'active', 'rejected', 'expired', 'failed'");
    expect(sql).toContain("source_kind in ('memory', 'run')");
  });

  it('allows one open draft per source and per target, at the database too', () => {
    expect(sql).toContain('promotion_drafts_one_open_memory');
    expect(sql).toContain('promotion_drafts_one_open_run');
    expect(sql).toContain('promotion_drafts_one_open_target');
  });

  it('reads for members, inserts as the requester, updates for owners, never deletes', () => {
    expect(sql).toContain('promotion_drafts_select');
    expect(sql).toContain('is_activity_space_member(activity_space_id)');
    expect(sql).toContain("status = 'drafting'");
    expect(sql).toContain('promotion_drafts_update');
    expect(sql).toContain('is_activity_space_owner(activity_space_id)');
    expect(sql).not.toContain('promotion_drafts_delete');
  });

  it('gives agent_runs the sixth subject and the rehearsal mark', () => {
    expect(sql).toContain('add column if not exists promotion_draft_id');
    expect(sql).toContain('add column if not exists rehearsal boolean not null default false');
    expect(sql).toContain("' or promotion_draft_id is not null'");
    expect(sql).toContain('when new.promotion_draft_id is not null then (select d.activity_space_id from public.promotion_drafts d');
    expect(sql).toContain("when promotion_draft_id is not null then exists (select 1 from public.promotion_drafts d");
    // The heartbeat's branches survive the restatement.
    expect(sql).toContain("' or mode = ''heartbeat'''");
    expect(sql).toContain("when mode = ''heartbeat'' then public.is_activity_space_member(activity_space_id)");
    expect(sql).toContain('grant insert (promotion_draft_id, rehearsal), select (promotion_draft_id, rehearsal) on public.agent_runs to authenticated');
  });

  it('carries the definition’s provenance and the offer’s once-only mark', () => {
    expect(sql).toContain('add column if not exists promoted_from_draft_id');
    expect(sql).toContain('add column if not exists promotion_offered_at');
  });

  it('restates the notification kinds with promotion, keeping the rest', () => {
    expect(sql).toContain('add column if not exists promotion_draft_id');
    expect(sql).toContain("''heartbeat'', ''promotion''");
    expect(sql).toContain("''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested''");
  });

  it('lays down records only: no activation RPCs yet (PR4 brings them)', () => {
    expect(sql).not.toContain('activate_promotion_draft');
    expect(sql).not.toContain('rollback_promoted_definition');
  });
});

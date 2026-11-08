import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// PR4 of the promotion path: the decision. The activation migration
// carries the only route by which a draft becomes a definition (and,
// with a trigger, an Automation) — owner-gated, hash- and
// snapshot-bound — plus the unverifiable acknowledgment and the
// rollback, and the binding's templates on automations.
const sql = readFileSync(
  new URL('../../supabase/migrations/20261130100000_promotion_activation.sql', import.meta.url),
  'utf8',
);

describe('promotion activation migration (PR4)', () => {
  it('is guarded for preview replay', () => {
    expect(sql).toContain("to_regclass('public.promotion_drafts')");
    expect(sql).toContain('promotion activation skipped');
  });

  it('lays down the base snapshot and the binding templates', () => {
    expect(sql).toContain('add column if not exists base_name text');
    expect(sql).toContain('add column if not exists base_body text');
    expect(sql).toContain('add column if not exists title_template text');
    expect(sql).toContain('add column if not exists description_template text');
  });

  it('activation is owner-only, review-bound, and expiry-bound', () => {
    expect(sql).toContain('create or replace function public.activate_promotion_draft(p_draft_id uuid)');
    expect(sql).toContain("if not public.is_activity_space_owner(v_draft.activity_space_id) then");
    expect(sql).toContain("raise exception 'not allowed' using errcode = '42501'");
    expect(sql).toContain("if v_draft.status <> 'awaiting_review' then");
    expect(sql).toContain('v_draft.expires_at < now()');
    expect(sql).toContain('tested_structure_hash is null');
  });

  it('an update whose target moved refuses — never a silent overwrite', () => {
    expect(sql).toContain('v_def.name is distinct from v_draft.base_name or v_def.body is distinct from v_draft.base_body');
    expect(sql).toContain('黙って上書きはしません');
  });

  it('what is born carries the provenance and the activated snapshot', () => {
    expect(sql).toContain('promoted_from_draft_id = v_draft.id');
    expect(sql).toContain('promoted_from_draft_id, created_by');
    expect(sql).toContain('activated_body = v_draft.body');
    expect(sql).toContain('activated_structure_hash = v_draft.tested_structure_hash');
    expect(sql).toContain('activated_binding_hash = v_draft.tested_binding_hash');
  });

  it('a schedule binding is born as an enabled automation; no trigger, none', () => {
    expect(sql).toContain("v_trigger := v_draft.binding -> 'trigger'");
    expect(sql).toContain("'schedule'");
    expect(sql).toContain('(select auth.uid()), true)');
    expect(sql).toContain('title_template, description_template, owner_id, enabled');
  });

  it('reject, the unverifiable acknowledgment, and rollback are the owner’s too', () => {
    expect(sql).toContain('create or replace function public.reject_promotion_draft(p_draft_id uuid)');
    expect(sql).toContain("v_draft.status not in ('awaiting_review', 'rehearsing')");
    expect(sql).toContain('create or replace function public.accept_unverifiable_promotion(p_draft_id uuid)');
    expect(sql).toContain("coalesce(v_draft.rehearsal_report ->> 'outcome', '') <> 'unverifiable'");
    expect(sql).toContain("expires_at = now() + interval '7 days'");
    expect(sql).toContain('create or replace function public.rollback_promoted_definition(p_draft_id uuid)');
    expect(sql).toContain('body = v_draft.activated_body');
    expect(sql).toContain("'rolled_back'");
  });

  it('the RPCs are granted to authenticated and nobody else', () => {
    for (const fn of ['activate_promotion_draft', 'reject_promotion_draft', 'accept_unverifiable_promotion', 'rollback_promoted_definition']) {
      expect(sql).toContain(`revoke all on function public.${fn}(uuid) from public`);
      expect(sql).toContain(`grant execute on function public.${fn}(uuid) to authenticated`);
    }
  });
});

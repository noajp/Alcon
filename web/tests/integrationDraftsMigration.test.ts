import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The G4 migration (20261126090000): the draft record, the drafting run
// as agent_runs' fourth subject, the Inbox link, the service-role-only
// secret copy for staged clones, and the owner's decision RPCs bound to
// the tested content. Pinned as text, as the other migration contracts
// are, since no database runs in this suite.
const migration = readFileSync(new URL('../../supabase/migrations/20261126090000_integration_drafts.sql', import.meta.url), 'utf8');

describe('integration drafts migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("to_regclass('public.activity_spaces')");
    expect(migration).toContain("to_regclass('public.integrations')");
    expect(migration).toContain('integration drafts skipped');
  });

  it('creates the draft record with the state machine’s statuses and no secret column', () => {
    expect(migration).toContain('create table if not exists public.integration_drafts');
    for (const status of ['drafting', 'awaiting_input', 'testing', 'awaiting_review', 'active', 'rejected', 'failed', 'expired', 'superseded', 'rerouted']) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain('tested_content jsonb');
    expect(migration).toContain('target_integration_id uuid references public.integrations(id) on delete set null');
    expect(migration).toContain('required_commands jsonb');
    expect(migration).toContain('dropped_commands jsonb');
    expect(migration).not.toMatch(/integration_drafts \([^)]*secret/);
  });

  it('keeps one open draft per service name and lets members read, the requester start, owners change', () => {
    expect(migration).toContain('integration_drafts_one_open');
    expect(migration).toContain("status in ('drafting', 'awaiting_input', 'testing', 'awaiting_review')");
    expect(migration).toContain('integration_drafts_select');
    expect(migration).toContain('public.is_activity_space_member(activity_space_id)');
    expect(migration).toContain("created_by = (select auth.uid()) and status = 'drafting'");
    expect(migration).toContain('integration_drafts_update');
    expect(migration).toContain('public.is_activity_space_owner(activity_space_id)');
  });

  it('makes the draft a subject of agent_runs, the same way the session became one', () => {
    expect(migration).toContain('add column if not exists integration_draft_id uuid references public.integration_drafts(id) on delete set null');
    expect(migration).toContain("' or integration_draft_id is not null'");
    expect(migration).toContain('when new.integration_draft_id is not null then (select d.activity_space_id from public.integration_drafts d where d.id = new.integration_draft_id)');
    expect(migration).toContain('when integration_draft_id is not null then exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id)');
    expect(migration).toContain('d.created_by = (select auth.uid())');
  });

  it('links drafts into notifications for the Inbox', () => {
    expect(migration).toContain('alter table public.notifications add column if not exists integration_draft_id uuid references public.integration_drafts(id) on delete cascade');
  });

  it('copies a secret to a staged clone for the service role only', () => {
    expect(migration).toContain('public.copy_integration_secret(p_from_id uuid, p_to_id uuid)');
    expect(migration).toContain('revoke all on function public.copy_integration_secret(uuid, uuid) from authenticated');
    expect(migration).toContain('grant execute on function public.copy_integration_secret(uuid, uuid) to service_role');
    expect(migration).toContain('v_from_space <> v_to_space');
  });

  it('binds activation to the tested content and lands updates on the original, not the clone', () => {
    expect(migration).toContain('public.activate_integration_draft(p_draft_id uuid)');
    expect(migration).toContain("if not public.is_activity_space_owner(v_draft.activity_space_id) then");
    expect(migration).toContain("if v_draft.status <> 'awaiting_review' then");
    expect(migration).toContain('v_candidate <> v_draft.tested_content');
    expect(migration).toContain("raise exception 'テストした接続の内容が変わっています。再テストしてください'");
    // The update path writes the original and deletes the clone.
    expect(migration).toContain('where id = v_draft.target_integration_id');
    expect(migration).toContain('delete from public.integrations where id = v_draft.materialized_integration_id');
    // A new connection's path only enables the staged row.
    expect(migration).toContain('update public.integrations set enabled = true');
    expect(migration).toContain("status = 'superseded'");
    expect(migration).toContain('activated_hash = tested_hash');
  });

  it('rejects through the same owner check and never deletes a live original', () => {
    expect(migration).toContain('public.reject_integration_draft(p_draft_id uuid)');
    expect(migration).toContain("v_draft.status not in ('awaiting_review', 'testing')");
    expect(migration).toContain('d.activated_integration_id = v_draft.materialized_integration_id');
  });

  it('keeps the post-activation change log, exempting the approved content itself', () => {
    expect(migration).toContain('integrations_draft_change_log');
    expect(migration).toContain("'fields', to_jsonb(v_fields)");
    expect(migration).toContain('new.manifest is not distinct from v_draft.manifest');
  });
});

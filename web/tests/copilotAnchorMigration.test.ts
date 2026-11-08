import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Copilot's approvals become persistent through one migration
// (20261123090000): a session gains an anchor run, an approval may have no
// Element, and undecided Copilot approvals can expire. These tests pin the
// migration's shape — above all that an Element action's visibility rule
// survives verbatim, since no database runs in this suite.

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20261123090000_copilot_anchor_runs.sql');

describe('copilot anchor runs migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("if to_regclass('public.agent_runs') is null or to_regclass('public.agent_actions') is null then");
    expect(migration).toContain("has_sessions boolean := to_regclass('public.ai_sessions') is not null");
  });

  it('adds the session as a run subject, stamped with the session Space', () => {
    expect(migration).toContain('add column if not exists ai_session_id uuid references public.ai_sessions(id) on delete set null');
    expect(migration).toContain('agent_runs_one_open_per_session');
    expect(migration).toContain("status in (''queued'', ''running'', ''awaiting_approval'', ''paused'')");
    expect(migration).toContain("or ai_session_id is not null or mode = ''copilot''");
    expect(migration).toContain('(select s.activity_space_id from public.ai_sessions s where s.id = new.ai_session_id)');
    expect(migration).toContain('grant insert (ai_session_id), select (ai_session_id) on public.agent_runs to authenticated');
  });

  it('opens the anchor only to its starter', () => {
    expect(migration).toContain("when ai_session_id is not null or mode = ''copilot'' then triggered_by = (select auth.uid())");
    expect(migration).toContain('s.user_id = (select auth.uid())');
  });

  it('lets an approval have no Element, and adds expiry for Copilot approvals', () => {
    expect(migration).toContain('alter table public.agent_actions alter column element_id drop not null');
    expect(migration).toContain('add column if not exists expires_at timestamptz');
    expect(migration).toContain("''expired''");
    expect(migration).toContain('agent_actions_expiry_idx');
  });

  it("keeps an Element action's visibility exactly as it was", () => {
    // The policy as 20261025210000 left it, word for word, as the first
    // branch of the new one: a Domain viewer still reads an Element's
    // approvals, and nobody sees more than before.
    const viewerRole = read('20261025210000_domain_viewer_role.sql');
    expect(viewerRole).toContain('using (public.user_can_read_element(element_id))');
    expect(migration).toContain('(element_id is not null and public.user_can_read_element(element_id))');
    expect(migration).not.toContain("public.user_can_see_element(element_id))'");
    // Non-Element runs are read through the run, never through a null Element.
    expect(migration).toContain('r.id = agent_actions.run_id and r.element_id is null');
    expect(migration).toContain("((r.ai_session_id is not null or r.mode = ''copilot'') and r.triggered_by = (select auth.uid()))");
  });

  it('keeps an anchor whose conversation was deleted', () => {
    // Deleting a session nulls the link; the subject check must still
    // accept the run, or the delete itself would fail on it.
    expect(migration).toContain('references public.ai_sessions(id) on delete set null');
    expect(migration).toContain("or mode = ''copilot''");
  });

  it('links the approval into notifications for the Inbox', () => {
    expect(migration).toContain("if to_regclass('public.notifications') is not null then");
    expect(migration).toContain('add column if not exists agent_action_id uuid references public.agent_actions(id) on delete cascade');
  });
});

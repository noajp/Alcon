import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The personal-sessions migration (20261125090000): a Copilot
// conversation outside any Space — the profile chat — gets a session
// row of its author's alone, and the one-open-run-per-session index
// learns the chat driver's resting word. Pinned as text, as the other
// migration contracts are, since no database runs in this suite.
const migration = readFileSync(new URL('../../supabase/migrations/20261125090000_ai_sessions_personal.sql', import.meta.url), 'utf8');

describe('ai_sessions personal migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("if to_regclass('public.ai_sessions') is null then");
    expect(migration).toContain("table_name = 'agent_runs' and column_name = 'ai_session_id'");
  });

  it('makes the Space optional and keeps the session its author’s alone', () => {
    expect(migration).toContain('alter table public.ai_sessions alter column activity_space_id drop not null');
    expect(migration).toContain('user_id = auth.uid() and (activity_space_id is null or public.is_activity_space_member(activity_space_id))');
    // Folders stay Space-bound: the folder must be the author's in the
    // session's own Space, which a null Space can never match.
    expect(migration).toContain('f.activity_space_id = ai_sessions.activity_space_id');
  });

  it('keeps one open run per session in the chat driver’s resting word too', () => {
    expect(migration).toContain('drop index if exists public.agent_runs_one_open_per_session');
    expect(migration).toContain("status in (''queued'', ''running'', ''awaiting_approval'', ''paused'', ''awaiting_input'')");
  });
});

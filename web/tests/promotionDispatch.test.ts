import { describe, expect, it } from 'vitest';

// The sixth driver joins the dispatch table: a run whose subject is a
// promotion draft is driven by `promote`, a person's words may be
// posted to it (the answers shape the package), and no other subject's
// routing changes.
const dispatch = await import(new URL('../../supabase/functions/run-agent/dispatch.ts', import.meta.url).pathname);

const subject = (over: Record<string, unknown> = {}) => ({
  element_id: null, strategy_id: null, ai_session_id: null, mode: 'execute', ...over,
});

describe('driverForRun (promotion)', () => {
  it('a promotion draft’s run is the promote driver', () => {
    expect(dispatch.driverForRun(subject({ promotion_draft_id: 'p1', mode: 'promote' }))).toBe('promote');
  });

  it('an Element still outranks every other subject', () => {
    expect(dispatch.driverForRun(subject({ element_id: 'e1', promotion_draft_id: 'p1' }))).toBe('execute');
  });

  it('the existing subjects route as before', () => {
    expect(dispatch.driverForRun(subject({ integration_draft_id: 'd1', mode: 'draft' }))).toBe('draft');
    expect(dispatch.driverForRun(subject({ strategy_id: 's1', mode: 'converse' }))).toBe('converse');
    expect(dispatch.driverForRun(subject({ ai_session_id: 'a1', mode: 'copilot' }))).toBe('chat');
    expect(dispatch.driverForRun(subject({ mode: 'heartbeat' }))).toBe('heartbeat');
    expect(dispatch.driverForRun(subject({}))).toBe('execute');
  });
});

describe('messageAllowed (promotion)', () => {
  it('a person may talk to the promotion drafter', () => {
    expect(dispatch.messageAllowed('promote')).toBe(true);
    expect(dispatch.messageAllowed('draft')).toBe(true);
    expect(dispatch.messageAllowed('execute')).toBe(false);
    expect(dispatch.messageAllowed('heartbeat')).toBe(false);
  });
});

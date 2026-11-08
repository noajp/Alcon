import { describe, expect, it } from 'vitest';

// The heartbeat's place in Athena's dispatch table (run-agent/dispatch.ts):
// the run with no subject column, whose subject is its Space. These pins
// hold what the design fixes — a subject always outranks the mode, a
// heartbeat takes no words and no decisions, and the only claim a fresh
// wake makes is start's.
const dispatch = await import(new URL('../../supabase/functions/run-agent/dispatch.ts', import.meta.url).pathname);

const subject = (over: Record<string, unknown> = {}) => ({
  element_id: null, strategy_id: null, ai_session_id: null, mode: 'execute', ...over,
});

describe('driverForRun (the heartbeat)', () => {
  it("a subjectless run with mode 'heartbeat' is the heartbeat", () => {
    expect(dispatch.driverForRun(subject({ mode: 'heartbeat' }))).toBe('heartbeat');
  });

  it('a subject column always outranks the heartbeat mode', () => {
    expect(dispatch.driverForRun(subject({ element_id: 'e1', mode: 'heartbeat' }))).toBe('execute');
    expect(dispatch.driverForRun(subject({ strategy_id: 's1', mode: 'heartbeat' }))).toBe('converse');
    expect(dispatch.driverForRun(subject({ integration_draft_id: 'd1', mode: 'heartbeat' }))).toBe('draft');
    expect(dispatch.driverForRun(subject({ ai_session_id: 'a1', mode: 'heartbeat' }))).toBe('chat');
  });

  it('a heartbeat takes no posted words', () => {
    expect(dispatch.messageAllowed('heartbeat')).toBe(false);
  });
});

describe('heartbeatEntryAllowed', () => {
  it("admits the schedule's start and the tick's revival, nothing else", () => {
    expect(dispatch.heartbeatEntryAllowed('start')).toBe(true);
    expect(dispatch.heartbeatEntryAllowed('resume')).toBe(true);
    expect(dispatch.heartbeatEntryAllowed('continue')).toBe(true);
    expect(dispatch.heartbeatEntryAllowed('message')).toBe(false);
    expect(dispatch.heartbeatEntryAllowed('decision')).toBe(false);
  });

  it("a fresh wake claims from queued, start's rule as always", () => {
    expect(dispatch.claimFor('start')).toEqual({ from: ['queued'] });
  });
});

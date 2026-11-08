import { describe, expect, it } from 'vitest';
import { runWaitingOnApproval } from '@/hooks/automationData';

// An automation's run stopped at an approval is a state of its own —
// above all under the Ask-every-time approval mode, where stopping
// there is the specified behavior and must read as waiting, never as
// a failure or a plain start.

describe('runWaitingOnApproval', () => {
  it('is true only for a run awaiting approval', () => {
    expect(runWaitingOnApproval('awaiting_approval')).toBe(true);
    expect(runWaitingOnApproval('running')).toBe(false);
    expect(runWaitingOnApproval('finished')).toBe(false);
    expect(runWaitingOnApproval('failed')).toBe(false);
    expect(runWaitingOnApproval('paused')).toBe(false);
    expect(runWaitingOnApproval(null)).toBe(false);
    expect(runWaitingOnApproval(undefined)).toBe(false);
  });
});

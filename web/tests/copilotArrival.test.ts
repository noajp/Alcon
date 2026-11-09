import { describe, expect, it } from 'vitest';
import { shouldResetOnArrival, type CopilotArrivalInput } from '@/AIP/ai/copilotArrival';

// The arrival decision (copilotArrival.ts): coming to an AI surface
// lands on a fresh conversation, unless the gesture is a carry
// between the two windows, a live turn is streaming, or the shown
// conversation is already fresh. Staying is not arriving.
const arrival = (patch: Partial<CopilotArrivalInput> = {}): CopilotArrivalInput => ({
  wasVisible: false,
  visible: true,
  carry: false,
  streaming: false,
  fresh: false,
  ...patch,
});

describe('shouldResetOnArrival', () => {
  it('resets on arrival from a non-AI surface', () => {
    expect(shouldResetOnArrival(arrival())).toBe(true);
  });

  it('resets when the pop-up is opened after being closed', () => {
    // The pop-up opening is the same false→true transition of "any AI
    // surface visible"; the decision does not exempt it.
    expect(shouldResetOnArrival(arrival({ wasVisible: false, visible: true }))).toBe(true);
  });

  it('does not reset on an expand/minimize carry', () => {
    expect(shouldResetOnArrival(arrival({ carry: true }))).toBe(false);
  });

  it('does not reset while the shown conversation is streaming', () => {
    expect(shouldResetOnArrival(arrival({ streaming: true }))).toBe(false);
  });

  it('is a no-op when the shown conversation is already fresh', () => {
    expect(shouldResetOnArrival(arrival({ fresh: true }))).toBe(false);
  });

  it('does not reset when staying (no transition)', () => {
    expect(shouldResetOnArrival(arrival({ wasVisible: true, visible: true }))).toBe(false);
  });

  it('does not reset when leaving a surface', () => {
    expect(shouldResetOnArrival(arrival({ wasVisible: true, visible: false }))).toBe(false);
  });

  it('does not reset while hidden throughout', () => {
    expect(shouldResetOnArrival(arrival({ wasVisible: false, visible: false }))).toBe(false);
  });

  it('exemptions win together: a carried arrival while streaming stays', () => {
    expect(shouldResetOnArrival(arrival({ carry: true, streaming: true }))).toBe(false);
  });
});

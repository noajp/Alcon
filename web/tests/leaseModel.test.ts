import { describe, it, expect } from 'vitest';
import { liveLease, holderLabel, formatRemaining } from '@/Function/shared/element/lease';
import { bucketsOf, DIMENSIONS, DIMENSION_LABEL } from '../src/Function/shared/dimensions';
import type { ElementWithDetails } from '../src/types/database';

const T0 = Date.parse('2026-09-06T12:00:00Z');
const row = (o: Partial<ElementWithDetails>) =>
  ({ claimed_by: null, claim_expires_at: null, branch: null, ...o }) as ElementWithDetails;

describe('liveLease', () => {
  it('is null with no claim', () => {
    expect(liveLease(row({}), T0)).toBeNull();
  });

  it('is null once the lease has lapsed — a dead session is not a holder', () => {
    expect(liveLease(row({ claimed_by: 'Claude@a', claim_expires_at: '2026-09-06T11:59:59Z' }), T0)).toBeNull();
    expect(liveLease(row({ claimed_by: 'Claude@a', claim_expires_at: '2026-09-06T12:00:00Z' }), T0)).toBeNull();
  });

  it('reports holder, branch and remaining time while live', () => {
    const l = liveLease(row({ claimed_by: 'Claude@a', branch: 'claude/x', claim_expires_at: '2026-09-06T12:38:00Z' }), T0);
    expect(l).toEqual({ holder: 'Claude@a', branch: 'claude/x', expiresAt: '2026-09-06T12:38:00Z', remainingMs: 38 * 60_000 });
  });

  it('a claim with no expiry is not treated as live', () => {
    expect(liveLease(row({ claimed_by: 'Claude@a' }), T0)).toBeNull();
  });
});

describe('holderLabel', () => {
  it('keeps the agent and the distinguishing tail of a long worktree name', () => {
    expect(holderLabel('Claude@unmerged-wip-check-30418a')).toBe('Claude@…k-30418a');
  });
  it('leaves short tokens whole', () => {
    expect(holderLabel('Claude@Clayware')).toBe('Claude@Clayware');
    expect(holderLabel('Codex@box-7')).toBe('Codex@box-7');
  });
  it('two sessions never collapse to the same label', () => {
    expect(holderLabel('Claude@session-aaaaaaaa')).not.toBe(holderLabel('Claude@session-bbbbbbbb'));
  });
  it('passes a token without @ through', () => {
    expect(holderLabel('service')).toBe('service');
  });
  it('elides only when it saves at least four characters', () => {
    expect(holderLabel('Claude@abcdefghijkl')).toBe('Claude@abcdefghijkl');      // 12: whole
    expect(holderLabel('Claude@abcdefghijklm')).toBe('Claude@…fghijklm');        // 13: elided
  });
  it('keeps an empty suffix and splits on the first @', () => {
    expect(holderLabel('Claude@')).toBe('Claude@');
    expect(holderLabel('Claude@a@very-long-worktree-name')).toBe('Claude@…ree-name');
  });
});

describe('formatRemaining', () => {
  it('rounds down to minutes and never goes negative', () => {
    expect(formatRemaining(38 * 60_000 + 59_000)).toBe('38m');
    expect(formatRemaining(-5)).toBe('<1m');
    expect(formatRemaining(30_000)).toBe('<1m');
  });
  it('shows hours with zero-padded minutes', () => {
    expect(formatRemaining(62 * 60_000)).toBe('1h 02m');
    expect(formatRemaining(120 * 60_000)).toBe('2h 00m');
  });
});

describe("dimension 'holder'", () => {
  it('is offered everywhere dimensions are', () => {
    expect(DIMENSIONS).toContain('holder');
    expect(DIMENSION_LABEL.holder).toBe('Holder');
  });
  it('buckets by the token as stored — no clock in dimensions', () => {
    expect(bucketsOf(row({ claimed_by: 'Claude@unmerged-wip-check-30418a' }), 'holder'))
      .toEqual([{ id: 'Claude@unmerged-wip-check-30418a', label: 'Claude@…k-30418a', color: null }]);
  });
  it('an unclaimed row lands in its own bucket rather than vanishing', () => {
    const [b] = bucketsOf(row({}), 'holder');
    expect(b.id).toBe('__none__');
    expect(b.label).toBe('Unclaimed');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { checkInAttempt, checkInBase, checkInChange, checkInFailure, hasNewerCheckInVersion, type CheckInDraft } from '../src/ActivitySpace/execution/element/checkIn/checkInDraft';
import type { Element } from '../src/types/database';

const element = (patch: Partial<Element> = {}): Element => ({
  id: 'element-a', title: 'Send draft', status: 'todo', updated_at: '2026-09-07T01:00:00Z',
  direction: { approach: 'Talk to the customer', acceptance: ['Response received'], next: 'Send draft' },
  is_approval: false, approval_state: null, ...patch,
} as Element);
const empty: CheckInDraft = { status: null, next: null, note: '' };

describe('check-in drafts', () => {
  it('does not invent a status or next step for an optional note', () => {
    const base = checkInBase(element({ status: null }));
    expect(checkInChange(base, { ...empty, note: ' Customer replied. ' })).toEqual({
      elementId: base.id, expectedUpdatedAt: base.updatedAt, patch: {}, note: 'Customer replied.',
    });
  });

  it('does not create empty reports or rewrite unchanged values', () => {
    const base = checkInBase(element());
    expect(checkInChange(base, empty)).toBeNull();
    expect(checkInChange(base, { status: 'todo', next: ' Send draft ', note: '  ' })).toBeNull();
  });

  it('distinguishes leaving the next step alone from explicitly clearing it', () => {
    const base = checkInBase(element());
    expect(checkInChange(base, { ...empty, status: 'in_progress' })?.patch).toEqual({ status: 'in_progress' });
    expect(checkInChange(base, { ...empty, next: '' })?.patch).toEqual({ next: null });
  });

  it('keeps the original concurrency base and unrelated direction fields untouched', () => {
    const original = element();
    const base = checkInBase(original);
    original.updated_at = '2026-09-07T02:00:00Z';
    const result = checkInChange(base, { ...empty, next: 'Review reply', note: 'Draft sent.' });
    expect(result?.expectedUpdatedAt).toBe('2026-09-07T01:00:00Z');
    expect(result?.patch).toEqual({ next: 'Review reply' });
    expect(original.direction?.approach).toBe('Talk to the customer');
  });

  it('rebases only explicit edits without restoring untouched old fields', () => {
    const latest = checkInBase(element({ status: 'review', direction: { approach: null, acceptance: [], next: 'Customer review' } }));
    const draft = { ...empty, note: 'Added context.' };
    expect(checkInChange(latest, draft)?.patch).toEqual({});
    expect(draft).toEqual({ status: null, next: null, note: 'Added context.' });
    expect(checkInChange(latest, { ...draft, next: 'Send amended draft' })?.patch).toEqual({ next: 'Send amended draft' });
  });

  it('retains an explicit status choice when the shared status changed', () => {
    const latest = checkInBase(element({ status: 'blocked' }));
    expect(checkInChange(latest, { ...empty, status: 'in_progress' })?.patch).toEqual({ status: 'in_progress' });
  });

  it.each([null, 'pending', 'changes_requested', 'rejected'] as const)('does not grant completion for approval state %s', state => {
    expect(checkInBase(element({ is_approval: true, approval_state: state })).approvalPending).toBe(true);
  });

  it('permits completion only after approval or for ordinary work', () => {
    expect(checkInBase(element({ is_approval: true, approval_state: 'approved' })).approvalPending).toBe(false);
    expect(checkInBase(element()).approvalPending).toBe(false);
  });
});

describe('check-in retries', () => {
  it('reuses the operation ID for a lost response to the same payload', () => {
    const makeId = vi.fn(() => 'request-1');
    const change = checkInChange(checkInBase(element()), { ...empty, note: 'Done' })!;
    const first = checkInAttempt(change, null, makeId);
    expect(checkInAttempt({ ...change }, first, makeId)).toBe(first);
    expect(makeId).toHaveBeenCalledTimes(1);
  });

  it('uses a new operation for changed content, target, or acknowledged version', () => {
    const change = checkInChange(checkInBase(element()), { ...empty, note: 'Done' })!;
    const first = checkInAttempt(change, null, () => 'request-1');
    const variants = [
      { ...change, note: 'Not done' }, { ...change, elementId: 'element-b' },
      { ...change, expectedUpdatedAt: '2026-09-07T02:00:00Z' }, { ...change, patch: { next: 'Review' } },
    ];
    for (const next of variants) expect(checkInAttempt(next, first, () => 'request-2').requestId).toBe('request-2');
  });

  it('keeps a snapshot of the exact request even if the source draft is changed', () => {
    const change = checkInChange(checkInBase(element()), { ...empty, note: 'Done', next: 'Review' })!;
    const attempt = checkInAttempt(change, null, () => 'request-1');
    change.note = 'Changed after sending';
    change.patch.next = 'Publish';
    expect(attempt.input.note).toBe('Done');
    expect(attempt.input.patch).toEqual({ next: 'Review' });
    expect(attempt.input.expectedUpdatedAt).toBe('2026-09-07T01:00:00Z');
    expect(checkInAttempt(attempt.input, attempt, () => 'request-2')).toBe(attempt);
  });

  it.each([
    [new TypeError('Failed to fetch'), 'unconfirmed'],
    [{ code: 'INVALID_RESPONSE' }, 'unconfirmed'],
    [{ code: '08007' }, 'unconfirmed'],
    [{ code: '40003' }, 'unconfirmed'],
    [{ code: 'PT409' }, 'conflict'],
    [{ code: '40001' }, 'conflict'],
    [{ code: '42501' }, 'permission'],
    [{ code: '22023' }, 'invalid'],
    [{ code: '23503' }, 'rejected'],
    [{ code: 'P0002' }, 'history_changed'],
  ])('classifies the first save failure %j as %s', (cause, result) => {
    expect(checkInFailure(cause, false)).toBe(result);
  });

  it.each(['42501', '22023', '23503', 'INVALID_RESPONSE'])('does not treat a retry rejection %s as proof that the original save failed', code => {
    expect(checkInFailure({ code }, true)).toBe('unconfirmed');
  });

  it('resolves an unknown attempt only when the server establishes no receipt or a changed saved receipt', () => {
    expect(checkInFailure({ code: 'PT409' }, true)).toBe('conflict');
    expect(checkInFailure({ code: '40001' }, true)).toBe('conflict');
    expect(checkInFailure({ code: 'P0002' }, true)).toBe('history_changed');
  });

  it.each([false, true])('requires the explicit RPC conflict code rather than an ambiguous HTTP status (previously unconfirmed: %s)', wasUnconfirmed => {
    expect(checkInFailure({ code: 'PT409', status: 409, message: 'This Element changed while you were writing.' }, wasUnconfirmed)).toBe('conflict');
    expect(checkInFailure({ status: 409, message: 'The response could not be read.' }, wasUnconfirmed)).toBe('unconfirmed');
    expect(checkInFailure({ code: 'INVALID_RESPONSE', status: 409 }, wasUnconfirmed)).toBe('unconfirmed');
  });

  it('does not show an older background snapshot as a new conflict after rebasing', () => {
    expect(hasNewerCheckInVersion('2026-09-07T01:00:00Z', '2026-09-07T02:00:00Z')).toBe(false);
    expect(hasNewerCheckInVersion('2026-09-07T02:00:00Z', '2026-09-07T01:00:00Z')).toBe(true);
    expect(hasNewerCheckInVersion('invalid', null)).toBe(false);
    expect(hasNewerCheckInVersion('2026-09-07T01:00:00Z', null)).toBe(true);
  });
});

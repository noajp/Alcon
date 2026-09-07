import { describe, expect, it, vi } from 'vitest';
import { checkInAttempt, checkInBase, checkInChange } from '../src/alcon/element/now/checkInDraft';
import { clearPendingCheckIn, readPendingCheckIn, rememberPendingCheckIn, type PendingCheckIn } from '../src/alcon/element/now/checkInPending';

const userId = '00000000-0000-0000-0000-000000000001';
const elementId = '00000000-0000-0000-0000-000000000002';
const requestId = '00000000-0000-0000-0000-000000000003';
const otherId = '00000000-0000-0000-0000-000000000004';
const limits = { noteMax: 4000, nextMax: 2000 };
const key = `alcon:pendingCheckIn:v1:${userId}:${elementId}`;

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}

function pending(): PendingCheckIn {
  const base = checkInBase({ id: elementId, title: 'Send draft', status: 'todo',
    updated_at: '2026-09-07T01:00:00Z', direction: { approach: null, acceptance: [], next: 'Send draft' },
    is_approval: false, approval_state: null });
  const draft = { status: 'in_progress' as const, next: null, note: ' Draft sent. ' };
  return { version: 1, userId, base, draft, attempt: checkInAttempt(checkInChange(base, draft)!, null, () => requestId) };
}

describe('pending check-in storage', () => {
  it('restores the exact operation and original draft after a new editor or reload', () => {
    const store = storage();
    const original = pending();
    rememberPendingCheckIn(store, original, limits);
    const recovered = readPendingCheckIn(store, userId, elementId, limits)!;
    expect(recovered).toEqual(original);
    expect(recovered).not.toBe(original);
    expect(recovered.draft.note).toBe(' Draft sent. ');
    expect(recovered.attempt.input.note).toBe('Draft sent.');
    expect(recovered.attempt.requestId).toBe(requestId);
    expect(recovered.attempt.input.expectedUpdatedAt).toBe('2026-09-07T01:00:00Z');
    rememberPendingCheckIn(store, recovered, limits);
    expect(store.data.size).toBe(1);
  });

  it('scopes pending content to the signed-in user and Element, independent of the current Space', () => {
    const store = storage();
    rememberPendingCheckIn(store, pending(), limits);
    expect(readPendingCheckIn(store, otherId, elementId, limits)).toBeNull();
    expect(readPendingCheckIn(store, userId, otherId, limits)).toBeNull();
    expect(readPendingCheckIn(store, userId, elementId, limits)?.attempt.requestId).toBe(requestId);
  });

  it('refuses to replace an unresolved operation with an edited payload or a fresh ID', () => {
    const store = storage();
    const original = pending();
    rememberPendingCheckIn(store, original, limits);
    const next = pending();
    next.draft.note = 'A different update';
    next.attempt = checkInAttempt(checkInChange(next.base, next.draft)!, null, () => otherId);
    expect(() => rememberPendingCheckIn(store, next, limits)).toThrow('earlier update');
    expect(readPendingCheckIn(store, userId, elementId, limits)).toEqual(original);
  });

  it('does not permit a request when persistence or its readback failed', () => {
    const store = storage();
    expect(() => rememberPendingCheckIn({ ...store, setItem: () => { throw new Error('storage unavailable'); } }, pending(), limits)).toThrow();
    expect(() => rememberPendingCheckIn({ ...store, setItem: vi.fn() }, pending(), limits)).toThrow('No request was sent');
  });

  it.each(['', '{', 'null', JSON.stringify({ version: 2 }), 'x'.repeat(100_001)])('does not silently discard invalid stored data', raw => {
    const store = storage();
    store.data.set(key, raw);
    expect(() => readPendingCheckIn(store, userId, elementId, limits)).toThrow('could not be restored safely');
    expect(store.data.get(key)).toBe(raw);
    expect(() => rememberPendingCheckIn(store, pending(), limits)).toThrow();
  });

  it.each(['scope', 'request', 'draft', 'base', 'fingerprint', 'limit'])('rejects inconsistent persisted %s fields', field => {
    const store = storage();
    const value = pending();
    if (field === 'scope') value.userId = otherId;
    if (field === 'request') value.attempt.requestId = 'invalid';
    if (field === 'draft') value.draft.note = 'Different draft';
    if (field === 'base') value.base.updatedAt = 'invalid';
    if (field === 'fingerprint') value.attempt.fingerprint = '{}';
    if (field === 'limit') value.draft.note = 'a'.repeat(limits.noteMax + 1);
    store.data.set(key, JSON.stringify(value));
    expect(() => readPendingCheckIn(store, userId, elementId, limits)).toThrow();
  });

  it('does not erase a different pending operation when an earlier editor settles', () => {
    const store = storage();
    const earlier = pending();
    const current = pending();
    current.attempt.requestId = otherId;
    rememberPendingCheckIn(store, current, limits);
    expect(() => clearPendingCheckIn(store, earlier, limits)).toThrow('different update');
    expect(readPendingCheckIn(store, userId, elementId, limits)).toEqual(current);
  });

  it('clears only a matching confirmed operation and detects failed removal', () => {
    const store = storage();
    const original = pending();
    rememberPendingCheckIn(store, original, limits);
    expect(() => clearPendingCheckIn({ ...store, removeItem: vi.fn() }, original, limits)).toThrow('could not be cleared');
    clearPendingCheckIn(store, original, limits);
    expect(readPendingCheckIn(store, userId, elementId, limits)).toBeNull();
  });

  it('does not block a note-only update because an existing next step exceeds the new editing limit', () => {
    const store = storage();
    const value = pending();
    value.base.next = 'a'.repeat(limits.nextMax + 1);
    value.attempt = checkInAttempt(checkInChange(value.base, value.draft)!, null, () => requestId);
    rememberPendingCheckIn(store, value, limits);
    expect(readPendingCheckIn(store, userId, elementId, limits)).toEqual(value);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, dismissToast, errorMessage, getToasts, notifyError } from '../src/Function/shared/toastStore';
import { reportMutationError } from '../src/lib/queryClient';

afterEach(() => { clearToasts(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('error toasts', () => {
  it('reads the message of an Error, a Supabase error object, or a string', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({ message: 'permission denied', code: '42501' })).toBe('permission denied');
    expect(errorMessage('  plain  ')).toBe('plain');
    expect(errorMessage(null)).toBeNull();
    expect(errorMessage({ code: 'x' })).toBeNull();
  });

  it('shows the headline with the error underneath, once', () => {
    notifyError(new Error('row locked'), 'Could not save your change.');
    notifyError(new Error('row locked'), 'Could not save your change.');
    expect(getToasts()).toEqual([expect.objectContaining({ message: 'Could not save your change.', detail: 'row locked' })]);
  });

  it('ignores aborts and keeps at most three toasts', () => {
    expect(notifyError(Object.assign(new Error('x'), { name: 'AbortError' }), 'm')).toBeNull();
    for (const n of [1, 2, 3, 4]) notifyError(new Error(`e${n}`), 'm');
    expect(getToasts().map((t) => t.detail)).toEqual(['e2', 'e3', 'e4']);
  });

  it('dismisses by hand and on its own', () => {
    vi.useFakeTimers();
    const id = notifyError(new Error('a'), 'm')!;
    notifyError(new Error('b'), 'm');
    dismissToast(id);
    expect(getToasts().map((t) => t.detail)).toEqual(['b']);
    vi.advanceTimersByTime(6000);
    expect(getToasts()).toEqual([]);
  });

  it('reports failed mutations unless the caller handles them', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportMutationError(new Error('handled inline'), { meta: { silent: true } });
    expect(getToasts()).toEqual([]);
    reportMutationError({ message: 'network' }, { meta: undefined });
    expect(getToasts()).toEqual([expect.objectContaining({ detail: 'network' })]);
  });
});

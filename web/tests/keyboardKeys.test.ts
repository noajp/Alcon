// Enter and Escape mean one thing per field kind. These predicates are what
// every dialog's name field and every in-place editor consult, so the cases
// they refuse — IME confirmation, auto-repeat, the wrong modifier — are the
// bugs each field used to reintroduce on its own.

import { describe, expect, it } from 'vitest';
import { isCancelKey, isCommitEnter, isSubmitChord, type KeyLike } from '@/Function/shared/keyboard';

function key(overrides: Partial<KeyLike> = {}): KeyLike {
  return { key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...overrides };
}

describe('isCommitEnter', () => {
  it('is a plain Enter', () => {
    expect(isCommitEnter(key())).toBe(true);
  });

  it('is not the Enter that confirms an IME conversion', () => {
    expect(isCommitEnter(key({ isComposing: true }))).toBe(false);
    // React keeps the flag on the native event.
    expect(isCommitEnter(key({ nativeEvent: { isComposing: true } }))).toBe(false);
  });

  it('is not a held key', () => {
    expect(isCommitEnter(key({ repeat: true }))).toBe(false);
  });

  it('is not Shift+Enter, which is a newline where newlines exist', () => {
    expect(isCommitEnter(key({ shiftKey: true }))).toBe(false);
  });

  it('is not the submit chord', () => {
    expect(isCommitEnter(key({ metaKey: true }))).toBe(false);
    expect(isCommitEnter(key({ ctrlKey: true }))).toBe(false);
  });

  it('is not another key', () => {
    expect(isCommitEnter(key({ key: 'Tab' }))).toBe(false);
  });
});

describe('isSubmitChord', () => {
  it('is Cmd+Enter or Ctrl+Enter', () => {
    expect(isSubmitChord(key({ metaKey: true }))).toBe(true);
    expect(isSubmitChord(key({ ctrlKey: true }))).toBe(true);
  });

  it('is not plain Enter', () => {
    expect(isSubmitChord(key())).toBe(false);
  });

  it('refuses composition and repeat like the plain commit', () => {
    expect(isSubmitChord(key({ metaKey: true, isComposing: true }))).toBe(false);
    expect(isSubmitChord(key({ metaKey: true, repeat: true }))).toBe(false);
  });
});

describe('isCancelKey', () => {
  it('is Escape', () => {
    expect(isCancelKey(key({ key: 'Escape' }))).toBe(true);
  });

  it('is not the Escape that ends an IME composition', () => {
    expect(isCancelKey(key({ key: 'Escape', isComposing: true }))).toBe(false);
  });
});

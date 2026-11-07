import { afterEach, describe, expect, it } from 'vitest';
import {
  clearInstallSession, parseInstallSession, saveInstallSession, serializeInstallSession, takeInstallSession,
  type StoredInstallSession,
} from '@/AIP/harness/installReturn';

// The install walk's place across an OAuth sign-in (installReturn.ts). The
// storage wrappers run against a minimal in-memory sessionStorage.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
afterEach(() => store.clear());

const session: StoredInstallSession = { spaceId: 'space-1', definitionId: 'def-1', catalogId: 'def.improve-loop' };

describe('install session serialising', () => {
  it('round-trips', () => {
    expect(parseInstallSession(serializeInstallSession(session))).toEqual(session);
  });

  it('rejects what is not a session', () => {
    expect(parseInstallSession(null)).toBeNull();
    expect(parseInstallSession('')).toBeNull();
    expect(parseInstallSession('not json')).toBeNull();
    expect(parseInstallSession('{}')).toBeNull();
    expect(parseInstallSession(JSON.stringify({ spaceId: 's', definitionId: 3, catalogId: 'c' }))).toBeNull();
    expect(parseInstallSession(JSON.stringify({ spaceId: '', definitionId: 'd', catalogId: 'c' }))).toBeNull();
    expect(parseInstallSession(JSON.stringify(['space-1']))).toBeNull();
  });

  it('a stored session names its Space, which is how another Space’s session is rejected on return', () => {
    saveInstallSession(session);
    const restored = takeInstallSession();
    expect(restored?.spaceId).toBe('space-1');
    expect(restored?.spaceId).not.toBe('space-2');
  });
});

describe('install session storage', () => {
  it('saves, takes once, and clears', () => {
    saveInstallSession(session);
    expect(takeInstallSession()).toEqual(session);
    expect(takeInstallSession()).toBeNull();
    saveInstallSession(session);
    clearInstallSession();
    expect(takeInstallSession()).toBeNull();
  });
});

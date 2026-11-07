// An install walk interrupted by an OAuth sign-in: opening a preset that
// signs in with OAuth leaves the app, so the walk's place is kept in
// sessionStorage (the pattern oauthReturn.ts uses) and the Harnesses panel
// picks it up on return, resuming at the recompute step. Only what the
// resume needs is stored — the missing connectors are derivable from the
// definition and the Space's connections at any time.

export interface StoredInstallSession {
  spaceId: string;
  definitionId: string;
  catalogId: string;
}

const KEY = 'alcon.harnessInstall.session';

/** Pure. A stored session as JSON. */
export function serializeInstallSession(session: StoredInstallSession): string {
  return JSON.stringify(session);
}

/** Pure. A stored session read back, or null when it is not one. */
export function parseInstallSession(raw: string | null): StoredInstallSession | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Record<string, unknown>;
    if (typeof x.spaceId === 'string' && x.spaceId && typeof x.definitionId === 'string' && x.definitionId
      && typeof x.catalogId === 'string') {
      return { spaceId: x.spaceId, definitionId: x.definitionId, catalogId: x.catalogId };
    }
  } catch { /* not a session */ }
  return null;
}

export function saveInstallSession(session: StoredInstallSession): void {
  try { sessionStorage.setItem(KEY, serializeInstallSession(session)); } catch { /* storage unavailable */ }
}

/** The stored session, read once. */
export function takeInstallSession(): StoredInstallSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return parseInstallSession(raw);
  } catch {
    return null;
  }
}

export function clearInstallSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

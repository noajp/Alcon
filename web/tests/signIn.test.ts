import { describe, expect, it } from 'vitest';

// The PR3 sign-in module: triple-origin resolution, the D6 ask
// decision, and the value-free records. Same URL-import seam as the
// other _shared tests.
const signIn = await import(new URL('../../supabase/functions/_shared/signIn.ts', import.meta.url).pathname);

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the service-role client, in the
 *  credentialRequests.test.ts pattern, plus `.is()` for the
 *  run-annotation update. */
function makeAdmin(state: Record<string, Row[]>) {
  function table(name: string) {
    const rows = () => (state[name] ??= []);
    const filters: [string, unknown][] = [];
    const nullCols: string[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | null = null;
    let single = false;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      in: (c: string, vs: unknown[]) => { filters.push([c, vs]); return b; },
      is: (c: string, v: unknown) => { if (v === null) nullCols.push(c); else filters.push([c, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => { single = true; return b; },
      single: () => { single = true; return b; },
      update: (p: Row) => { op = 'update'; payload = p; return b; },
      insert: (p: Row) => { op = 'insert'; payload = p; return b; },
      then: (resolve: (v: unknown) => void) => {
        const match = (r: Row) => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v))
          && nullCols.every((c) => r[c] == null);
        if (op === 'update') {
          for (const r of rows().filter(match)) Object.assign(r, payload);
          resolve({ data: null, error: null });
        } else if (op === 'insert') {
          const row: Row = { id: `row-${rows().length + 1}`, created_at: new Date().toISOString(), ...(payload ?? {}) };
          rows().push(row);
          resolve({ data: row, error: null });
        } else {
          const found = rows().filter(match);
          resolve({ data: single ? (found[0] ?? null) : found, error: null });
        }
      },
    };
    return b;
  }
  return { from: (n: string) => table(n) };
}

const row = (over: Row = {}): Row => ({
  id: 'sc-1', username: 'taro@example.com', secret_id: 'sec-1', ...over,
});
const target = (over: Row = {}) => signIn.signInTarget({
  probeUrl: 'https://example.com/login', probeWall: true, input: {}, row: row(), onceRequestId: null, ...over,
});

describe('the pair never travels as anything but a pair', () => {
  it('parses the stored JSON pair, and nothing else', () => {
    expect(signIn.parseSitePair('{"username":"u","password":"p"}')).toEqual({ username: 'u', password: 'p' });
    // The Vault read is text; anything else is not a pair.
    expect(signIn.parseSitePair({ username: 'u', password: 'p' })).toBeNull();
    expect(signIn.parseSitePair('{"username":"u"}')).toBeNull();
    expect(signIn.parseSitePair('{"username":"","password":"p"}')).toBeNull();
    expect(signIn.parseSitePair('plain-password')).toBeNull();
    expect(signIn.parseSitePair(null)).toBeNull();
    expect(signIn.parseSitePair(42)).toBeNull();
  });

  it('reads a take row as username + value', () => {
    expect(signIn.pairFromTakeRow({ username: 'u', value: 'p' })).toEqual({ username: 'u', password: 'p' });
    expect(signIn.pairFromTakeRow({ username: 'u', value: '' })).toBeNull();
    expect(signIn.pairFromTakeRow(null)).toBeNull();
    expect(signIn.pairFromTakeRow(undefined)).toBeNull();
  });
});

describe('triple origin equality, resolved server-side', () => {
  it('the page origin comes from the runner probe, canonicalized', () => {
    const t = target({ probeUrl: 'https://Example.COM:443/login?next=/home' });
    expect(t?.origin).toBe('https://example.com');
    expect(t?.stored).toEqual({ id: 'sc-1', username: 'taro@example.com' });
    expect(t?.claimMismatch).toBe(false);
    expect(t?.wall).toBe(true);
  });

  it('no page, no target: a blank or non-web page resolves nothing', () => {
    expect(target({ probeUrl: 'about:blank' })).toBeNull();
    expect(target({ probeUrl: '' })).toBeNull();
  });

  it('an absent claim is no claim; an equal claim passes; any other claim refuses', () => {
    expect(target({ input: {} })?.claimMismatch).toBe(false);
    expect(target({ input: { origin: 'https://example.com/login' } })?.claimMismatch).toBe(false);
    expect(target({ input: { origin: 'https://other.example' } })?.claimMismatch).toBe(true);
    // A claim that cannot even be read as an origin is a mismatch,
    // never a pass.
    expect(target({ input: { origin: 'example dot com' } })?.claimMismatch).toBe(true);
  });

  it('a stored row without its secret is not a credential, but its username survives as the hint', () => {
    const t = target({ row: row({ secret_id: null }) });
    expect(t?.stored).toBeNull();
    expect(t?.storedUsername).toBe('taro@example.com');
  });

  it('the wall report is read as an origin, never as free text', () => {
    expect(signIn.loginWallOf({ url: 'https://example.com/home', login_wall: 'https://Example.com:443/login' })).toBe('https://example.com');
    expect(signIn.loginWallOf({ url: 'https://example.com/home' })).toBeNull();
    expect(signIn.loginWallOf(null)).toBeNull();
    expect(signIn.loginWallOf({ login_wall: 42 })).toBeNull();
  });
});

describe('D6: the one-time sign-in card', () => {
  it('asks only in ask mode, only for a stored credential, only the first time', () => {
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: target(), usedBefore: false })).toBe(true);
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: target(), usedBefore: true })).toBe(false);
    expect(signIn.signInNeedsAsk({ mode: 'auto', target: target(), usedBefore: false })).toBe(false);
    expect(signIn.signInNeedsAsk({ mode: 'free', target: target(), usedBefore: false })).toBe(false);
  });

  it('a use-once stash never asks — the stash itself was the consent', () => {
    const t = target({ row: null, onceRequestId: 'req-1' });
    expect(t?.stored).toBeNull();
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: t, usedBefore: false })).toBe(false);
  });

  it('nothing asks when there is nothing to release, or the claim already failed', () => {
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: target({ row: null }), usedBefore: false })).toBe(false);
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: target({ input: { origin: 'https://other.example' } }), usedBefore: false })).toBe(false);
    expect(signIn.signInNeedsAsk({ mode: 'ask', target: null, usedBefore: false })).toBe(false);
  });

  it('the card shows the site and the account, and can never be remembered', () => {
    const d = signIn.signInDisplayFor({ id: 'c1' }, { origin: 'https://example.com', username: 'taro@example.com', runnerName: 'My PC' });
    expect(d.operation).toBe('sign_in');
    expect(d.destination).toBe('https://example.com');
    expect(d.title).toBe('https://example.com にサインイン');
    expect(d.fields).toEqual([
      { label: 'Origin', value: 'https://example.com' },
      { label: 'Username', value: 'taro@example.com' },
    ]);
    expect(d.rememberable).toBe(false);
    expect(JSON.stringify(d)).not.toContain('password');
  });
});

describe('the sign-in record carries origin and outcome only', () => {
  it('the step title is the origin, nothing else', () => {
    expect(signIn.signInStepTitle('https://example.com')).toBe('PC: サインイン https://example.com');
  });

  it('outcomes are codes the server words itself', () => {
    expect(signIn.signInOutcomeOf({ signed_in: true })).toEqual({ ok: true, code: 'signed_in' });
    expect(signIn.signInOutcomeOf({ signed_in: false, reason: 'still_walled' })).toEqual({ ok: false, code: 'still_walled' });
    expect(signIn.signInOutcomeOf({ signed_in: false, reason: 'page_moved' })).toEqual({ ok: false, code: 'page_moved' });
    expect(signIn.signInOutcomeOf({ signed_in: false, reason: 'no_pair' })).toEqual({ ok: false, code: 'no_pair' });
    expect(signIn.signInOutcomeOf({ signed_in: false, reason: 'surprise' })).toEqual({ ok: false, code: 'error' });
    expect(signIn.signInOutcomeOf({ signed_in: false })).toEqual({ ok: false, code: 'error' });
    expect(signIn.signInOutcomeOf(null)).toEqual({ ok: false, code: 'error' });
  });
});

describe('the audit trail is the D6 memory', () => {
  it('a used row for the credential is what hasSignInUse reads', async () => {
    const state: Record<string, Row[]> = { credential_uses: [] };
    const admin = makeAdmin(state);
    expect(await signIn.hasSignInUse(admin, 'sc-1')).toBe(false);
    await signIn.recordSignInUse(admin, {
      spaceId: 'sp-1', runId: 'run-1', event: 'used', origin: 'https://example.com', detail: 'signed_in',
      credential: { kind: 'site', id: 'sc-1' },
    });
    expect(await signIn.hasSignInUse(admin, 'sc-1')).toBe(true);
    expect(await signIn.hasSignInUse(admin, 'sc-2')).toBe(false);
    const useRow = state.credential_uses[0];
    expect(useRow.credential_kind).toBe('site');
    expect(useRow.site_credential_id).toBe('sc-1');
    expect(useRow.detail).toBe('signed_in');
    expect(useRow.origin).toBe('https://example.com');
  });

  it('a refusal is recorded with its reason code, value-free', async () => {
    const state: Record<string, Row[]> = { credential_uses: [] };
    const admin = makeAdmin(state);
    await signIn.recordSignInUse(admin, {
      spaceId: 'sp-1', runId: 'run-1', event: 'release_refused', origin: 'https://example.com', detail: 'origin_mismatch',
      credential: { kind: 'once' },
    });
    const useRow = state.credential_uses[0];
    expect(useRow.credential_kind).toBe('once');
    expect(useRow.event).toBe('release_refused');
    expect(useRow.detail).toBe('origin_mismatch');
    expect(useRow.site_credential_id ?? null).toBeNull();
  });

  it('the once-take row is annotated with its run, once, and no other row', async () => {
    const state: Record<string, Row[]> = {
      credential_uses: [
        { id: 'u1', credential_kind: 'once', event: 'used', run_id: null, detail: 'one-time credential for request req-1' },
        { id: 'u2', credential_kind: 'once', event: 'used', run_id: null, detail: 'one-time credential for request req-2' },
        { id: 'u3', credential_kind: 'once', event: 'used', run_id: 'run-old', detail: 'one-time credential for request req-1' },
      ],
    };
    const admin = makeAdmin(state);
    await signIn.annotateOnceUseRun(admin, 'req-1', 'run-9');
    expect(state.credential_uses[0].run_id).toBe('run-9');
    expect(state.credential_uses[1].run_id).toBeNull();
    expect(state.credential_uses[2].run_id).toBe('run-old');
  });

  it('a successful sign-in retires the origin\'s standing asks, and only those', async () => {
    const state: Record<string, Row[]> = {
      credential_requests: [
        { id: 'r1', activity_space_id: 'sp-1', kind: 'site_login', origin: 'https://example.com', status: 'pending' },
        { id: 'r2', activity_space_id: 'sp-1', kind: 'site_login', origin: 'https://other.example', status: 'pending' },
        { id: 'r3', activity_space_id: 'sp-1', kind: 'integration_secret', origin: null, status: 'pending' },
        { id: 'r4', activity_space_id: 'sp-1', kind: 'site_login', origin: 'https://example.com', status: 'used_once' },
      ],
    };
    const admin = makeAdmin(state);
    await signIn.supersedePendingSiteRequests(admin, 'sp-1', 'https://example.com');
    expect(state.credential_requests.map((r) => r.status)).toEqual(['superseded', 'pending', 'pending', 'used_once']);
  });

  it('the credential rows are found by origin, and the stash by its state', async () => {
    const state: Record<string, Row[]> = {
      site_credentials: [
        { id: 'sc-1', username: 'taro@example.com', secret_id: 'sec-1', activity_space_id: 'sp-1', origin: 'https://example.com' },
        { id: 'sc-2', username: 'jiro@example.com', secret_id: 'sec-2', activity_space_id: 'sp-1', origin: 'https://other.example' },
      ],
      credential_requests: [
        { id: 'req-1', activity_space_id: 'sp-1', kind: 'site_login', origin: 'https://example.com', status: 'used_once' },
        { id: 'req-2', activity_space_id: 'sp-1', kind: 'site_login', origin: 'https://example.com', status: 'pending' },
      ],
    };
    const admin = makeAdmin(state);
    expect((await signIn.siteCredentialRowForOrigin(admin, 'sp-1', 'https://example.com'))?.id).toBe('sc-1');
    expect(await signIn.siteCredentialRowForOrigin(admin, 'sp-1', 'https://none.example')).toBeNull();
    expect(await signIn.onceRequestForOrigin(admin, 'sp-1', 'https://example.com')).toBe('req-1');
    expect(await signIn.onceRequestForOrigin(admin, 'sp-1', 'https://other.example')).toBeNull();
  });
});

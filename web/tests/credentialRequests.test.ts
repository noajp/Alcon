import { describe, expect, it } from 'vitest';

// The capture-request creators (supabase/functions/_shared/
// credentialRequests.ts), loaded by URL the way the repo loads every
// _shared module into Vitest: the Deno-side imports stay outside the
// web type program, and the surface is typed here at the seam.
const core = await import(new URL('../../supabase/functions/_shared/credentialRequests.ts', import.meta.url).pathname) as unknown as {
  captureSourceForRow: (row: Record<string, unknown>) => 'connection' | 'reauth' | null;
  credentialRequestTitle: (label: string) => string;
  credentialStepDetail: (req: { id: string }, label: string) => string;
  normalizeSiteOrigin: (input: string) => string | null;
  ensureIntegrationCredentialRequest: (admin: unknown, args: Record<string, unknown>) => Promise<{ request: Record<string, unknown>; created: boolean } | null>;
  createCredentialRequestsForNames: (admin: unknown, args: Record<string, unknown>) => Promise<{ request: Record<string, unknown>; created: boolean; row: Record<string, unknown> }[]>;
  createRunnerWallCredentialRequest: (admin: unknown, args: Record<string, unknown>) => Promise<{ request: Record<string, unknown>; created: boolean } | null>;
  takeStashedCredentialForIntegration: (admin: unknown, integrationId: string) => Promise<string | null>;
};
const {
  captureSourceForRow, createCredentialRequestsForNames, createRunnerWallCredentialRequest,
  credentialRequestTitle, credentialStepDetail, ensureIntegrationCredentialRequest,
  normalizeSiteOrigin, takeStashedCredentialForIntegration,
} = core;

// The capture-request creators (secure-login design §2.2): requests
// are created ONLY from server-side facts — an empty/expired
// connection slot, an in-run auth failure, a runner-reported login
// wall. The module takes no model text: the only free strings it
// accepts are the waiting work's description and, on the runner seam,
// the origin the RUNNER reported as its current page. These tests pin
// the derivations and the find-or-create behaviour against a small
// in-memory Supabase stand-in.

const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

type Row = Record<string, unknown>;

function makeAdmin(state: Record<string, Row[]>, rpcImpl?: (fn: string, args: Row) => unknown) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  function table(name: string) {
    const rows = () => (state[name] ??= []);
    let op: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | null = null;
    let single = false;
    const filters: [string, unknown][] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => { single = true; return b; },
      single: () => { single = true; return b; },
      update: (p: Row) => { op = 'update'; payload = p; return b; },
      insert: (p: Row) => { op = 'insert'; payload = p; return b; },
      then: (resolve: (v: unknown) => void) => {
        const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
        if (op === 'update') {
          for (const r of rows().filter(match)) Object.assign(r, payload);
          resolve({ data: null, error: null });
        } else if (op === 'insert') {
          // The credential_requests.status column default, as the schema declares it.
          const defaults: Row = name === 'credential_requests' ? { status: 'pending' } : {};
          const row: Row = { id: `row-${rows().length + 1}`, created_at: new Date().toISOString(), ...defaults, ...(payload ?? {}) };
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
  return {
    from: (n: string) => table(n),
    rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return { data: rpcImpl ? rpcImpl(fn, args) : null, error: null }; },
    rpcCalls,
  };
}

const githubRow = (over: Row = {}): Row => ({
  id: 'int-1', activity_space_id: 'sp-1', name: 'GitHub', preset: 'github', kind: 'mcp',
  endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'bearer', secret_id: null,
  external_account: null, last_test: null, enabled: true, ...over,
});

describe('captureSourceForRow — which slots are capture facts', () => {
  it('an empty token-class slot is a connection need', () => {
    expect(captureSourceForRow(githubRow())).toBe('connection');
  });
  it('a secret whose last test failed auth is a reauth need', () => {
    expect(captureSourceForRow(githubRow({ secret_id: 'sec-1', last_test: { ok: false, code: 'auth_failed', at: PAST } }))).toBe('reauth');
  });
  it('a healthy secret is no need', () => {
    expect(captureSourceForRow(githubRow({ secret_id: 'sec-1', last_test: { ok: true, at: PAST } }))).toBeNull();
  });
  it('OAuth, none and model-proxy connections never take a typed value', () => {
    expect(captureSourceForRow(githubRow({ auth_type: 'oauth' }))).toBeNull();
    expect(captureSourceForRow(githubRow({ auth_type: 'none' }))).toBeNull();
    expect(captureSourceForRow({ ...githubRow(), kind: 'model' })).toBeNull();
  });
  it('a disabled connection is no need', () => {
    expect(captureSourceForRow(githubRow({ enabled: false }))).toBeNull();
  });
});

describe('the model-visible surface carries no value and no username', () => {
  it('the step detail is the request id and the display label only', () => {
    const detail = credentialStepDetail({ id: 'req-9' }, 'GitHub');
    expect(JSON.parse(detail)).toEqual({ requestId: 'req-9', label: 'GitHub' });
    expect(detail).not.toContain('username');
  });
  it('the title names the connection, nothing else', () => {
    expect(credentialRequestTitle('GitHub')).toBe('GitHub の認証情報が必要です');
  });
});

describe('ensureIntegrationCredentialRequest', () => {
  it('creates one pending request for an empty slot', async () => {
    const state: Record<string, Row[]> = { credential_requests: [] };
    const admin = makeAdmin(state);
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', row: githubRow(), waitingFor: 'PR を作る',
    });
    expect(got?.created).toBe(true);
    expect(got?.request.id).toBeTruthy();
    expect(state.credential_requests).toHaveLength(1);
    const req = state.credential_requests[0];
    expect(req.kind).toBe('integration_secret');
    expect(req.integration_id).toBe('int-1');
    expect(req.origin ?? null).toBeNull();
    expect(req.status).toBe('pending');
    expect((req.need as Row).source).toBe('connection');
    expect((req.need as Row).waiting_for).toBe('PR を作る');
  });

  it('reuses the live pending request instead of stacking a second', async () => {
    const state: Record<string, Row[]> = {
      credential_requests: [{ id: 'req-old', activity_space_id: 'sp-1', kind: 'integration', integration_id: 'int-1', status: 'pending', expires_at: FUTURE }],
    };
    const admin = makeAdmin(state);
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', row: githubRow(), waitingFor: 'PR を作る',
    });
    expect(got?.created).toBe(false);
    expect(got?.request.id).toBe('req-old');
    expect(state.credential_requests).toHaveLength(1);
  });

  it('a lapsed pending request is expired on sight and replaced', async () => {
    const state: Record<string, Row[]> = {
      credential_requests: [{ id: 'req-old', activity_space_id: 'sp-1', kind: 'integration', integration_id: 'int-1', status: 'pending', expires_at: PAST }],
    };
    const admin = makeAdmin(state);
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', row: githubRow(), waitingFor: 'PR を作る',
    });
    expect(got?.created).toBe(true);
    expect(state.credential_requests[0].status).toBe('expired');
    expect(state.credential_requests).toHaveLength(2);
  });

  it('a run-raised need records its source and run, and shortens the life', async () => {
    const state: Record<string, Row[]> = { credential_requests: [] };
    const admin = makeAdmin(state);
    await ensureIntegrationCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', row: githubRow({ secret_id: 'sec-1', last_test: { ok: false, code: 'auth_failed', at: PAST } }),
      waitingFor: '要素の実行', runId: 'run-1',
    });
    const req = state.credential_requests[0];
    expect((req.need as Row).source).toBe('run');
    expect((req.need as Row).run_id).toBe('run-1');
    const ttlMs = new Date(req.expires_at as string).getTime() - Date.now();
    expect(ttlMs).toBeLessThan(2 * 24 * 3600 * 1000);
    expect(ttlMs).toBeGreaterThan(0);
  });

  it('no need, no request', async () => {
    const state: Record<string, Row[]> = { credential_requests: [] };
    const admin = makeAdmin(state);
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', row: githubRow({ secret_id: 'sec-1', last_test: { ok: true, at: PAST } }), waitingFor: 'x',
    });
    expect(got).toBeNull();
    expect(state.credential_requests).toHaveLength(0);
  });
});

describe('createCredentialRequestsForNames — the proposal family path', () => {
  it('matches names by row name, preset and the catalogue display name', async () => {
    const state: Record<string, Row[]> = {
      integrations: [githubRow({ name: 'GH 連携' })],
      credential_requests: [],
    };
    const admin = makeAdmin(state);
    const asks = await createCredentialRequestsForNames(admin, {
      spaceId: 'sp-1', userId: 'u-1', names: ['GitHub'], waitingFor: 'PR を作る',
    });
    expect(asks).toHaveLength(1);
    expect(asks[0].row.name).toBe('GH 連携');
    expect(state.credential_requests).toHaveLength(1);
  });

  it('a name with no connection row creates nothing — that is the connect dialog’s work', async () => {
    const state: Record<string, Row[]> = { integrations: [], credential_requests: [] };
    const admin = makeAdmin(state);
    const asks = await createCredentialRequestsForNames(admin, {
      spaceId: 'sp-1', userId: 'u-1', names: ['存在しない'], waitingFor: 'x',
    });
    expect(asks).toEqual([]);
    expect(state.credential_requests).toHaveLength(0);
  });
});

describe('createRunnerWallCredentialRequest — the PR3 seam', () => {
  it('canonicalizes the runner-reported origin and dedups the ask', async () => {
    const state: Record<string, Row[]> = { credential_requests: [], site_credentials: [] };
    const admin = makeAdmin(state);
    const first = await createRunnerWallCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', origin: 'https://linear.app/login?next=/inbox', waitingFor: '課題を確認する', runId: 'run-1',
    });
    expect(first?.created).toBe(true);
    expect(state.credential_requests[0].origin).toBe('https://linear.app');
    expect(state.credential_requests[0].kind).toBe('site_login');
    const second = await createRunnerWallCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', origin: 'https://linear.app', waitingFor: '課題を確認する', runId: 'run-1',
    });
    expect(second?.created).toBe(false);
    expect(state.credential_requests).toHaveLength(1);
  });

  it('a stored password for the origin means no need at all', async () => {
    const state: Record<string, Row[]> = {
      credential_requests: [],
      site_credentials: [{ id: 'sc-1', activity_space_id: 'sp-1', origin: 'https://linear.app', username: 't@example.com', secret_id: 'sec-9' }],
    };
    const admin = makeAdmin(state);
    const got = await createRunnerWallCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', origin: 'https://linear.app/login', waitingFor: 'x',
    });
    expect(got).toBeNull();
    expect(state.credential_requests).toHaveLength(0);
  });

  it('an address that is not a site origin is refused', async () => {
    const admin = makeAdmin({ credential_requests: [], site_credentials: [] });
    const got = await createRunnerWallCredentialRequest(admin, {
      spaceId: 'sp-1', userId: 'u-1', origin: 'not a url at all', waitingFor: 'x',
    });
    expect(got).toBeNull();
  });

  it('normalizeSiteOrigin mirrors the web and SQL canonicalization', () => {
    expect(normalizeSiteOrigin('https://Linear.APP/login?x=1#y')).toBe('https://linear.app');
    expect(normalizeSiteOrigin('http://localhost:8787/app')).toBe('http://localhost:8787');
    expect(normalizeSiteOrigin('linear.app')).toBe('https://linear.app');
    expect(normalizeSiteOrigin('')).toBeNull();
    expect(normalizeSiteOrigin('ftp://x.example')).toBeNull();
  });
});

describe('takeStashedCredentialForIntegration — the single take', () => {
  it('takes through the RPC and returns the value for the caller’s memory only', async () => {
    const state: Record<string, Row[]> = {
      credential_requests: [{ id: 'req-1', activity_space_id: 'sp-1', kind: 'integration_secret', integration_id: 'int-1', status: 'used_once', expires_at: FUTURE }],
      integrations: [githubRow()],
    };
    const admin = makeAdmin(state, (fn) => (fn === 'take_credential_once' ? [{ username: null, value: 'tok-123' }] : null));
    const value = await takeStashedCredentialForIntegration(admin, 'int-1');
    expect(value).toBe('tok-123');
    expect(admin.rpcCalls).toEqual([{ fn: 'take_credential_once', args: { p_request_id: 'req-1' } }]);
  });

  it('without a used-once request it never calls the RPC', async () => {
    const admin = makeAdmin({ credential_requests: [], integrations: [githubRow()] });
    const value = await takeStashedCredentialForIntegration(admin, 'int-1');
    expect(value).toBeNull();
    expect(admin.rpcCalls).toEqual([]);
  });
});

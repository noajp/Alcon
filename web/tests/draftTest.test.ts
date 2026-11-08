import { afterEach, describe, expect, it, vi } from 'vitest';

// The draft test round (supabase/functions/_shared/draftTest.ts) against
// an in-memory store and a stubbed fetch: reads run, writes are never
// sent, authentication needs its negative control, and a passing round
// freezes the tested content and puts the draft in front of the owners.
const dt = await import(new URL('../../supabase/functions/_shared/draftTest.ts', import.meta.url).pathname);

const MANIFEST = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'list_items', action: 'items.list', effect: 'read', description: 'List', input: { limit: { type: 'number' } }, http: { method: 'GET', path: '/items', query: ['limit'] } },
    { name: 'create_item', action: 'items.create', effect: 'write', input: { title: { type: 'string' } }, required: ['title'], http: { method: 'POST', path: '/items', body: ['title'] } },
  ],
};

interface FakeState {
  draft: Record<string, unknown>;
  staged: Record<string, unknown>;
  notifications: Record<string, unknown>[];
  integrationUpdates: Record<string, unknown>[];
}

function fakeAdmin(state: FakeState) {
  const applyDraftPatch = (patch: Record<string, unknown>, statusGuard: string | null) => {
    if (statusGuard && state.draft.status !== statusGuard) return false;
    Object.assign(state.draft, patch);
    return true;
  };
  return {
    from(table: string) {
      let action = '';
      let patch: Record<string, unknown> = {};
      let statusGuard: string | null = null;
      const qb: Record<string, unknown> = {
        select: () => qb,
        update: (p: Record<string, unknown>) => { action = 'update'; patch = p; return qb; },
        insert: (p: Record<string, unknown>) => {
          if (table === 'notifications') state.notifications.push(p);
          return qb;
        },
        delete: () => { action = 'delete'; return qb; },
        eq: (col: string, val: string) => { if (col === 'status') statusGuard = val; return qb; },
        in: () => qb,
        maybeSingle: () => {
          if (table === 'integrations') return Promise.resolve({ data: state.staged });
          if (table === 'integration_drafts') {
            if (action === 'update') return Promise.resolve({ data: applyDraftPatch(patch, statusGuard) ? { id: state.draft.id } : null });
            return Promise.resolve({ data: state.draft });
          }
          return Promise.resolve({ data: null });
        },
        single: () => Promise.resolve({ data: state.staged, error: null }),
        then: (res: (v: unknown) => void, rej: (e: unknown) => void) => {
          let out: unknown = { data: null, error: null };
          if (table === 'activity_space_members') out = { data: [{ user_id: 'owner-1' }] };
          if (table === 'integration_drafts' && action === 'update') { applyDraftPatch(patch, statusGuard); out = { error: null }; }
          if (table === 'integrations' && action === 'update') { state.integrationUpdates.push(patch); Object.assign(state.staged, patch); out = { error: null }; }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return qb;
    },
    rpc: (name: string) => Promise.resolve(name === 'get_integration_secret' ? { data: 'secret-value', error: null } : { data: true, error: null }),
  };
}

function makeState(): FakeState {
  return {
    draft: {
      id: 'draft-1', activity_space_id: 'space-1', name: 'Example API', name_key: 'exampleapi', kind: 'http',
      status: 'testing', request_context: {}, endpoint: 'https://api.example.com/v1', auth_type: 'bearer',
      auth_header: null, manifest: MANIFEST, guide: 'guide', test_inputs: { create_item: { title: 'x' } },
      sources: [], test_results: null, required_commands: ['list_items', 'create_item'], dropped_commands: [],
      tested_hash: null, tested_content: null, materialized_integration_id: 'staged-1', target_integration_id: null,
      activated_integration_id: null, draft_run_id: 'run-1', failure_class: null, awaiting_question: null,
      expires_at: null, created_by: 'user-1', created_at: '', updated_at: '',
    },
    staged: {
      id: 'staged-1', activity_space_id: 'space-1', preset: 'ai-drafted', kind: 'http', name: 'Example API',
      description: null, endpoint: 'https://api.example.com/v1', auth_type: 'bearer', auth_header: null,
      secret_id: 'sec-1', delegation: 'approve_each', enabled: false, manifest: MANIFEST, guide: 'guide', last_test: null,
    },
    notifications: [],
    integrationUpdates: [],
  };
}

const fetchCalls: { url: string; method: string; auth: string | null }[] = [];
const roundOf = (out: unknown) => (out as { round: { outcome: string; results: { command: string; executed: boolean; failure: string | null }[] } }).round;


function stubFetch(handler: (call: { url: string; method: string; auth: string | null }) => { status: number; body: string }) {
  fetchCalls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    const call = { url: String(url), method: init?.method ?? 'GET', auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? null };
    fetchCalls.push(call);
    const { status, body } = handler(call);
    return new Response(body, { status });
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('runDraftTestRound', () => {
  it('passes when reads answer and the control proves the credential matters — and never sends the write', async () => {
    const state = makeState();
    stubFetch(({ auth }) => (auth
      ? { status: 200, body: '{"items":[]}' }
      : { status: 401, body: '{"error":"unauthorized"}' }));
    // deno-lint-ignore no-explicit-any
    const out = await dt.runDraftTestRound(fakeAdmin(state) as any, state.draft as any);
    expect(roundOf(out).outcome).toBe('passed');
    expect(state.draft.status).toBe('awaiting_review');
    expect(typeof state.draft.tested_hash).toBe('string');
    expect(state.draft.tested_content).toMatchObject({ name: 'Example API', endpoint: 'https://api.example.com/v1' });
    expect(state.draft.expires_at).toBeTruthy();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({ recipient_id: 'owner-1', integration_draft_id: 'draft-1' });
    // The write was assembled only: every fetch is a GET.
    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(fetchCalls.every((c) => c.method === 'GET')).toBe(true);
    const write = roundOf(out).results.find((r) => r.command === 'create_item');
    expect(write).toMatchObject({ executed: false, failure: null });
  });

  it('settles as auth_unverified when the same answer comes back without the credential', async () => {
    const state = makeState();
    stubFetch(() => ({ status: 200, body: '{"items":[]}' }));
    // deno-lint-ignore no-explicit-any
    const out = await dt.runDraftTestRound(fakeAdmin(state) as any, state.draft as any);
    expect(roundOf(out).outcome).toBe('auth_unverified');
    expect(state.draft.status).toBe('testing');
    expect(state.draft.failure_class).toBe('auth_unverified');
    expect(state.notifications).toHaveLength(0);
  });

  it('sends a failed read back to drafting with its classification', async () => {
    const state = makeState();
    stubFetch(() => ({ status: 404, body: 'not here' }));
    // deno-lint-ignore no-explicit-any
    const out = await dt.runDraftTestRound(fakeAdmin(state) as any, state.draft as any);
    expect(roundOf(out).outcome).toBe('failed');
    expect(state.draft.status).toBe('drafting');
    expect(state.draft.failure_class).toBe('endpoint_error');
  });

  it('fails a write whose required input cannot be assembled, without sending anything', async () => {
    const state = makeState();
    state.draft.test_inputs = {};
    stubFetch(({ auth }) => (auth ? { status: 200, body: '{}' } : { status: 401, body: '' }));
    // deno-lint-ignore no-explicit-any
    const out = await dt.runDraftTestRound(fakeAdmin(state) as any, state.draft as any);
    const write = roundOf(out).results.find((r) => r.command === 'create_item');
    expect(write).toMatchObject({ executed: false, failure: 'schema_mismatch' });
    expect(fetchCalls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('summarises a round for the revision loop', () => {
    const text = dt.summarizeRound({
      at: '2026-11-08T00:00:00Z', outcome: 'failed', authVerified: false, control: null,
      results: [{ command: 'list_items', effect: 'read', executed: true, status: 404, failure: 'endpoint_error', detail: '', limitedBy: 'limit' }],
    });
    expect(text).toContain('endpoint_error');
    expect(text).toContain('list_items');
  });
});

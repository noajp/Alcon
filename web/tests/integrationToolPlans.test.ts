import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The integration tool-plan cache (_shared/integrationPlans.ts): a plan is
// reused only while it still describes the connection — the fingerprint
// covers the manifest and the row, and an MCP plan also ages out, because
// a server can change its tools without the row changing. These tests pin
// the pure validation, the plan adoption, and the migration's shape.

type Planned = { name: string; description: string; input_schema: Record<string, unknown>; command: { name: string }; remote: { name: string } | null };
type Stored = { integration_id: string; fingerprint: string; plan: Planned[]; fetched_at: string };

const plans = await import(new URL('../../supabase/functions/_shared/integrationPlans.ts', import.meta.url).pathname) as unknown as {
  MCP_PLAN_TTL_MS: number;
  canonicalJson: (v: unknown) => string;
  planFingerprint: (row: { name: string; endpoint: string; kind: string; auth_type: string; manifest?: unknown; updated_at?: string | null }) => Promise<string>;
  planCacheState: (cached: Stored | undefined, fingerprint: string, kind: string, now: number) => 'use' | 'refresh';
  planFitsCache: (plan: Planned[]) => boolean;
};
const it8n = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname) as unknown as {
  adoptPlannedTools: (planned: Planned[], taken: Map<string, unknown>) => Planned[];
};

const ROW = {
  name: 'GitHub', endpoint: 'https://api.githubcopilot.com/mcp', kind: 'mcp', auth_type: 'oauth',
  manifest: { version: 1, commands: [{ name: 'search', action: 'repos.search' }] },
  updated_at: '2026-11-08T00:00:00.000Z',
};

describe('canonicalJson', () => {
  it('sorts object keys at every depth, so stored key order does not matter', () => {
    expect(plans.canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe(plans.canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
    expect(plans.canonicalJson({ a: 1 })).toBe('{"a":1}');
  });

  it('keeps array order and JSON semantics', () => {
    expect(plans.canonicalJson([2, 1])).not.toBe(plans.canonicalJson([1, 2]));
    expect(plans.canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(plans.canonicalJson('x')).toBe('"x"');
  });
});

describe('planFingerprint', () => {
  it('is stable for the same inputs, whatever the manifest key order', async () => {
    const a = await plans.planFingerprint(ROW);
    const b = await plans.planFingerprint({ ...ROW, manifest: { commands: [{ action: 'repos.search', name: 'search' }], version: 1 } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the manifest, the endpoint or the row changes', async () => {
    const base = await plans.planFingerprint(ROW);
    expect(await plans.planFingerprint({ ...ROW, manifest: { version: 1, commands: [] } })).not.toBe(base);
    expect(await plans.planFingerprint({ ...ROW, endpoint: 'https://example.com/mcp' })).not.toBe(base);
    // A secret rotation or a remembered approval rule moves updated_at.
    expect(await plans.planFingerprint({ ...ROW, updated_at: '2026-11-09T00:00:00.000Z' })).not.toBe(base);
    expect(await plans.planFingerprint({ ...ROW, manifest: null })).not.toBe(base);
  });
});

describe('planCacheState', () => {
  const now = Date.parse('2026-11-08T12:00:00.000Z');
  const cached = (over: Partial<Stored> = {}): Stored => ({
    integration_id: 'i1', fingerprint: 'fp', plan: [], fetched_at: new Date(now).toISOString(), ...over,
  });

  it('refreshes when there is no plan or the fingerprint moved', () => {
    expect(plans.planCacheState(undefined, 'fp', 'mcp', now)).toBe('refresh');
    expect(plans.planCacheState(cached(), 'other', 'mcp', now)).toBe('refresh');
    expect(plans.planCacheState(cached(), 'other', 'http', now)).toBe('refresh');
  });

  it('uses a manifest plan on fingerprint alone, however old', () => {
    const old = cached({ fetched_at: new Date(now - 30 * 24 * 3600 * 1000).toISOString() });
    expect(plans.planCacheState(old, 'fp', 'http', now)).toBe('use');
  });

  it('uses an MCP plan only within its TTL', () => {
    const fresh = cached({ fetched_at: new Date(now - plans.MCP_PLAN_TTL_MS + 1000).toISOString() });
    const stale = cached({ fetched_at: new Date(now - plans.MCP_PLAN_TTL_MS - 1000).toISOString() });
    expect(plans.planCacheState(fresh, 'fp', 'mcp', now)).toBe('use');
    expect(plans.planCacheState(stale, 'fp', 'mcp', now)).toBe('refresh');
    expect(plans.MCP_PLAN_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe('planFitsCache', () => {
  it('keeps ordinary plans and refuses an oversized one', () => {
    const tool = (description: string): Planned => ({ name: 'x__a', description, input_schema: {}, command: { name: 'a' }, remote: null });
    expect(plans.planFitsCache([tool('small')])).toBe(true);
    expect(plans.planFitsCache([tool('x'.repeat(1_100_000))])).toBe(false);
  });
});

describe('adoptPlannedTools', () => {
  const tool = (name: string): Planned => ({ name, description: '', input_schema: {}, command: { name }, remote: null });

  it('keeps the planned names and registers them', () => {
    const taken = new Map<string, unknown>();
    const adopted = it8n.adoptPlannedTools([tool('gh__a'), tool('gh__b')], taken);
    expect(adopted.map((p) => p.name)).toEqual(['gh__a', 'gh__b']);
    expect([...taken.keys()]).toEqual(['gh__a', 'gh__b']);
  });

  it('renames a collision instead of reusing a taken name, without mutating the plan', () => {
    const planned = [tool('gh__a')];
    const taken = new Map<string, unknown>([['gh__a', true]]);
    const adopted = it8n.adoptPlannedTools(planned, taken);
    expect(adopted[0].name).not.toBe('gh__a');
    expect(planned[0].name).toBe('gh__a');
  });
});

describe('integration_tool_plans migration', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20261124090000_integration_tool_plans.sql', import.meta.url), 'utf8');

  it('is guarded for preview replay', () => {
    expect(migration).toContain("if to_regclass('public.integrations') is null");
    expect(migration).toContain("to_regprocedure('public.is_activity_space_member(uuid)') is null");
  });

  it('creates the plan store with its freshness fields', () => {
    expect(migration).toContain('create table if not exists public.integration_tool_plans');
    expect(migration).toContain('integration_id uuid primary key references public.integrations(id) on delete cascade');
    expect(migration).toContain('fingerprint text not null');
    expect(migration).toContain('plan jsonb not null');
    expect(migration).toContain('fetched_at timestamptz not null default now()');
  });

  it('opens reads to the Space members of the integration, and writes to nobody but the service role', () => {
    expect(migration).toContain('create policy integration_tool_plans_select on public.integration_tool_plans for select to authenticated');
    expect(migration).toContain('public.is_activity_space_member(i.activity_space_id)');
    expect(migration).not.toMatch(/create policy integration_tool_plans_(insert|update|delete)/);
    expect(migration).not.toMatch(/grant (insert|update|delete) on public\.integration_tool_plans/);
  });
});

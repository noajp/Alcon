import { describe, expect, it } from 'vitest';

// Governed workspaces (coding capability PR1, _shared/workspaces.ts
// + spritesProvider.ts + workspaceLifecycle.ts): the pure core that
// prices and bounds a definition-declared machine — caps, the
// egress policy as the provider applies it, the classification's
// invariants, cost — and the provider seam against a fake fetch.
// The lifecycle's database orchestration is I/O the repo's
// convention pins on source (workspaceWiring.test.ts); what is
// pure enough to judge is judged here.
const ws = await import(new URL('../../supabase/functions/_shared/workspaces.ts', import.meta.url).pathname);
const sp = await import(new URL('../../supabase/functions/_shared/spritesProvider.ts', import.meta.url).pathname);
const lc = await import(new URL('../../supabase/functions/_shared/workspaceLifecycle.ts', import.meta.url).pathname);

const HOUR = 3_600_000;
const req = (over: Partial<{ disposal: 'per-run' | 'any'; egress: string[]; wallClockMs: number | null }> = {}) => ({
  disposal: 'per-run' as const, egress: [] as string[], wallClockMs: null, ...over,
});

describe('caps', () => {
  it('are the server defaults when the definition declares no time', () => {
    expect(ws.capsForRequirement(req())).toEqual(ws.DEFAULT_WORKSPACE_CAPS);
  });

  it('a definition may tighten its wall clock, never widen the server cap', () => {
    expect(ws.capsForRequirement(req({ wallClockMs: HOUR })).wallClockMs).toBe(HOUR);
    expect(ws.capsForRequirement(req({ wallClockMs: 24 * HOUR })).wallClockMs).toBe(ws.DEFAULT_WORKSPACE_CAPS.wallClockMs);
  });

  it('cap violations judge concurrency before spend, and stop at the cap', () => {
    const caps = ws.DEFAULT_WORKSPACE_CAPS;
    expect(ws.capViolation(0, 0, caps)).toBeNull();
    expect(ws.capViolation(caps.maxConcurrentPerSpace, 0, caps)).toBe('concurrency');
    expect(ws.capViolation(0, caps.monthlySpendCapUsd, caps)).toBe('monthly_spend');
    expect(ws.capViolation(caps.maxConcurrentPerSpace - 1, caps.monthlySpendCapUsd - 0.01, caps)).toBeNull();
  });
});

describe('egress policy', () => {
  it('the effective set is the declared hosts plus infrastructure, deduped in order', () => {
    expect(ws.egressHostsFor(['registry.npmjs.org'], ['clayware.example.co', 'registry.npmjs.org', null]))
      .toEqual(['registry.npmjs.org', 'clayware.example.co']);
  });

  it('the policy allows each host and denies everything else, in order', () => {
    expect(ws.networkPolicyRules(['a.example.com', 'b.example.com'])).toEqual([
      { domain: 'a.example.com', action: 'allow' },
      { domain: 'b.example.com', action: 'allow' },
      { domain: '*', action: 'deny' },
    ]);
  });

  it('an empty effective set denies all — the policy still applies', () => {
    expect(ws.networkPolicyRules([])).toEqual([{ domain: '*', action: 'deny' }]);
  });

  it('an explicitly unrestricted declaration has no policy to apply', () => {
    expect(ws.networkPolicyRules(['*'])).toBeNull();
    expect(ws.networkPolicyRules(['a.example.com', '*'])).toBeNull();
  });

  it('hostOfUrl reads a host and refuses what has none', () => {
    expect(ws.hostOfUrl('https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/asset-relay')).toBe('rkugtcqztkkacvoylupw.supabase.co');
    expect(ws.hostOfUrl('not a url')).toBeNull();
  });
});

describe('the classification invariants (design §7)', () => {
  const facts = (over: Record<string, unknown> = {}) => ({
    cls: 'managed' as const, credentialFree: 'server' as const,
    egressDeclared: ['registry.npmjs.org'], egressEnforced: true, ...over,
  });

  it('a managed, enforced, per-run binding earns "read"', () => {
    expect(ws.machineCallKind(facts(), req())).toBe('read');
  });

  it('an unenforced narrow egress makes the calls ask', () => {
    expect(ws.machineCallKind(facts({ egressEnforced: false }), req())).toBe('write');
  });

  it('an explicitly unrestricted declaration is restricted to what was declared', () => {
    expect(ws.machineCallKind(facts({ egressEnforced: false, egressDeclared: ['*'] }), req())).toBe('read');
  });

  it('a standing binding under a per-run definition asks: disposal is not met', () => {
    expect(ws.machineCallKind(facts({ cls: 'standing', credentialFree: 'self-reported', egressDeclared: ['*'], egressEnforced: false }), req()))
      .toBe('write');
  });

  it('a standing binding the definition allowed, with unrestricted declared egress, reads', () => {
    expect(ws.machineCallKind(
      facts({ cls: 'standing', credentialFree: 'self-reported', egressDeclared: ['*'], egressEnforced: false }),
      req({ disposal: 'any' }),
    )).toBe('read');
  });

  it('a standing binding with a narrow declared egress asks: its network is its owner\'s, not the policy\'s', () => {
    expect(ws.machineCallKind(
      facts({ cls: 'standing', credentialFree: 'self-reported', egressDeclared: ['registry.npmjs.org'], egressEnforced: false }),
      req({ disposal: 'any' }),
    )).toBe('write');
  });

  it('the invariants are reported, not just priced', () => {
    expect(ws.machineInvariants(facts({ cls: 'standing', egressEnforced: false }))).toEqual({
      credentialFree: true, egressRestricted: false, perRunDisposal: false,
    });
  });
});

describe('cost', () => {
  it('estimates at the planning rate: the brief\'s ≈ $0.23 per 4-hour session', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(ws.estimateCostUsd(t0, t0 + 4 * HOUR)).toBeCloseTo(0.23, 4);
    expect(ws.estimateCostUsd(t0, t0 - HOUR)).toBe(0);
  });

  it('a month\'s spend counts closed records at their cost and live ones at their accrued estimate', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const rows = [
      { costUsd: 1.5, createdAtMs: t0, closedAtMs: t0 + HOUR },
      { costUsd: null, createdAtMs: t0, closedAtMs: null },
    ];
    // 1.50 recorded + 2h accrued at the planning rate.
    expect(ws.monthSpendUsd(rows, t0 + 2 * HOUR)).toBeCloseTo(1.5 + 2 * ws.SPRITES_USD_PER_HOUR_ESTIMATE, 4);
  });
});

describe('provisioning shapes', () => {
  it('a run\'s sprite name is stable and sanitised', () => {
    expect(ws.spriteNameForRun('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe('clayware-ws-aaaaaaaabbbb4ccc8dddeeee');
    expect(ws.spriteNameForRun('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(ws.spriteNameForRun('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  });

  it('shell quoting is exact, apostrophes included', () => {
    expect(ws.shellQuote('plain')).toBe(`'plain'`);
    expect(ws.shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('the env file carries exactly the workspace\'s own identity — nothing else', () => {
    const env = ws.workspaceEnvFile({
      relayUrl: 'https://proj.supabase.co/functions/v1/asset-relay',
      token: 'alc_ast_deadbeef', name: 'workspace-12345678', runnerUrl: 'https://example.com/clayware-runner.mjs',
    });
    const lines = env.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`CLAYWARE_RELAY='https://proj.supabase.co/functions/v1/asset-relay'`);
    expect(lines[1]).toBe(`CLAYWARE_TOKEN='alc_ast_deadbeef'`);
    expect(lines[2]).toBe(`CLAYWARE_NAME='workspace-12345678'`);
    expect(lines[3]).toBe(`CLAYWARE_RUNNER_URL='https://example.com/clayware-runner.mjs'`);
    expect(env).not.toMatch(/SERVICE_ROLE|ANTHROPIC|VAULT|PASSWORD/);
  });

  it('the bootstrap boots the runner machine-only and holds no secret itself', () => {
    const script = ws.bootstrapScript();
    expect(script).toContain('clayware-runner.mjs --isolated --shell --no-browser --headless');
    expect(script).toContain(`"playwright-core":"${ws.RUNNER_PLAYWRIGHT_PIN}"`);
    expect(script).toContain('. "$CLAYWARE_HOME/env"');
    expect(script).not.toContain('alc_ast_');
  });

  it('provider request bodies are the documented shapes', () => {
    expect(ws.createSpriteBody('clayware-ws-x', ['clayware-workspace'])).toEqual({ name: 'clayware-ws-x', labels: ['clayware-workspace'] });
    expect(ws.networkPolicyBody([{ domain: 'a.com', action: 'allow' }])).toEqual({ rules: [{ domain: 'a.com', action: 'allow' }] });
  });
});

describe('the provisioning record', () => {
  const row = {
    id: 'w1', run_id: 'r1', activity_space_id: 's1', provider: 'sprites', class: 'managed', status: 'ready',
    sandbox_id: 'clayware-ws-r1', asset_id: 'a1', egress_declared: ['registry.npmjs.org'], egress_effective: ['registry.npmjs.org', 'h.example.co'],
    egress_enforced: true, credential_free: 'server', caps: { wallClockMs: 1000, maxConcurrentPerSpace: 3, monthlySpendCapUsd: 25 },
    deadline: '2026-01-01T04:00:00.000Z', cost_usd: '0.23', error: null, destroy_reason: null,
    created_at: '2026-01-01T00:00:00.000Z', ready_at: '2026-01-01T00:01:00.000Z', destroyed_at: null,
  };

  it('reads a row whole, numeric strings and all', () => {
    const rec = ws.parseWorkspaceRow(row);
    expect(rec?.runId).toBe('r1');
    expect(rec?.costUsd).toBe(0.23);
    expect(rec?.egressDeclared).toEqual(['registry.npmjs.org']);
    expect(rec?.caps.wallClockMs).toBe(1000);
  });

  it('a malformed row is no record at all', () => {
    expect(ws.parseWorkspaceRow(null)).toBeNull();
    expect(ws.parseWorkspaceRow({ id: 'w1' })).toBeNull();
  });

  it('a provisioned asset belongs to its run alone; a person\'s own runner belongs to no run', () => {
    expect(ws.provisionedRunIdOf({ provisioned: { by: 'server', run_id: 'r1' } })).toBe('r1');
    expect(ws.provisionedRunIdOf({ runner: 'clayware-runner' })).toBeNull();
    expect(ws.provisionedRunIdOf(null)).toBeNull();
  });
});

describe('the lifecycle seams', () => {
  it('the relay URL is the project\'s asset-relay function', () => {
    expect(lc.relayUrlOf('https://proj.supabase.co')).toBe('https://proj.supabase.co/functions/v1/asset-relay');
    expect(lc.relayUrlOf('https://proj.supabase.co/')).toBe('https://proj.supabase.co/functions/v1/asset-relay');
  });

  it('with no provider configured there is no seat — provisioning cannot start', () => {
    expect(lc.providerSeatFromEnv(() => undefined)).toBeNull();
  });

  it('a configured token yields a seat: provider client plus its config', () => {
    const seat = lc.providerSeatFromEnv((k: string) => (k === 'SPRITES_API_TOKEN' ? 'tok' : undefined));
    expect(seat?.config.token).toBe('tok');
    expect(typeof seat?.provider.create).toBe('function');
    expect(typeof seat?.provider.destroy).toBe('function');
  });
});

describe('the provider seam', () => {
  const get = (vars: Record<string, string>) => (k: string) => vars[k];

  it('no token, no provider: configuration fails closed', () => {
    expect(sp.spritesConfigFromEnv(get({}))).toBeNull();
    expect(sp.spritesConfigFromEnv(get({ SPRITES_API_TOKEN: '  ' }))).toBeNull();
  });

  it('configuration reads env names only, with the documented default base', () => {
    const c = sp.spritesConfigFromEnv(get({ SPRITES_API_TOKEN: 'tok', WORKSPACE_RUNNER_URL: 'https://example.com/r.mjs' }));
    expect(c?.baseUrl).toBe('https://api.sprites.dev');
    expect(c?.runnerUrl).toBe('https://example.com/r.mjs');
    const c2 = sp.spritesConfigFromEnv(get({ SPRITES_API_TOKEN: 'tok', SPRITES_API_URL: 'https://sprites.internal/' }));
    expect(c2?.baseUrl).toBe('https://sprites.internal');
    expect(c2?.runnerUrl).toBeNull();
  });

  interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }
  const fakeFetch = (handler: (call: Seen) => Response) => {
    const seen: Seen[] = [];
    const fn = async (input: string, init?: RequestInit): Promise<Response> => {
      const call: Seen = {
        url: String(input), method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      seen.push(call);
      return handler(call);
    };
    return { seen, fn };
  };
  const config = { token: 'test-token', baseUrl: 'https://api.sprites.dev', runnerUrl: 'https://example.com/r.mjs' };

  it('create posts the documented body under the bearer token', async () => {
    const { seen, fn } = fakeFetch(() => new Response(JSON.stringify({ name: 'clayware-ws-x', status: 'running' }), { status: 200 }));
    const provider = sp.createSpritesProvider(config, fn);
    const made = await provider.create('clayware-ws-x', ['clayware-workspace']);
    expect(made).toEqual({ name: 'clayware-ws-x', status: 'running' });
    expect(seen[0].url).toBe('https://api.sprites.dev/v1/sprites');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.authorization).toBe('Bearer test-token');
    expect(JSON.parse(seen[0].body!)).toEqual({ name: 'clayware-ws-x', labels: ['clayware-workspace'] });
  });

  it('destroy deletes, and an already-gone sprite is the desired end state', async () => {
    const { seen, fn } = fakeFetch(() => new Response(null, { status: 404 }));
    const provider = sp.createSpritesProvider(config, fn);
    await expect(provider.destroy('clayware-ws-x')).resolves.toBeUndefined();
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].url).toBe('https://api.sprites.dev/v1/sprites/clayware-ws-x');
  });

  it('the network policy posts the rules to the policy endpoint', async () => {
    const { seen, fn } = fakeFetch(() => new Response(null, { status: 204 }));
    const provider = sp.createSpritesProvider(config, fn);
    await provider.setNetworkPolicy('clayware-ws-x', [{ domain: 'a.com', action: 'allow' }, { domain: '*', action: 'deny' }]);
    expect(seen[0].url).toBe('https://api.sprites.dev/v1/sprites/clayware-ws-x/policy/network');
    expect(JSON.parse(seen[0].body!)).toEqual({ rules: [{ domain: 'a.com', action: 'allow' }, { domain: '*', action: 'deny' }] });
  });

  it('writeFile puts raw bytes at the fs endpoint with the mode as an octal string', async () => {
    const { seen, fn } = fakeFetch(() => new Response(null, { status: 200 }));
    const provider = sp.createSpritesProvider(config, fn);
    await provider.writeFile('clayware-ws-x', '/home/sprite/.clayware/env', 'SECRET-FREE-CONTENT', '0600');
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe('/v1/sprites/clayware-ws-x/fs/write');
    expect(url.searchParams.get('path')).toBe('/home/sprite/.clayware/env');
    expect(url.searchParams.get('mode')).toBe('0600');
    expect(url.searchParams.get('mkdirParents')).toBe('true');
    expect(seen[0].body).toBe('SECRET-FREE-CONTENT');
  });

  it('putService creates the service with cmd and args', async () => {
    const { seen, fn } = fakeFetch(() => new Response('{"type":"log"}\n', { status: 200 }));
    const provider = sp.createSpritesProvider(config, fn);
    await provider.putService('clayware-ws-x', 'clayware-runner', { cmd: '/bin/bash', args: ['/home/sprite/.clayware/bootstrap.sh'] });
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe('/v1/sprites/clayware-ws-x/services/clayware-runner');
    expect(JSON.parse(seen[0].body!)).toEqual({ cmd: '/bin/bash', args: ['/home/sprite/.clayware/bootstrap.sh'] });
  });

  it('a provider failure is a SpritesError that never carries the token', async () => {
    const { fn } = fakeFetch(() => new Response('boom', { status: 500 }));
    const provider = sp.createSpritesProvider(config, fn);
    const err = await provider.create('clayware-ws-x', []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(sp.SpritesError);
    expect((err as Error).message).toContain('500');
    expect((err as Error).message).not.toContain('test-token');
  });
});

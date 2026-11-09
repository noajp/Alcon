import { describe, expect, it } from 'vitest';

// Capability attenuation for chained runs (B10, _shared/chainScope.ts):
// a run that starts another run hands down a scope minted server-side
// from settled records — the parent's row, the child's definition,
// the Space's connections and their tested manifests — never from
// model text. The scope's truth is the run row; a JWT claim is only
// its carriage. These tests pin the pure core: the derivation (the
// assembly's own matching and closure rules), the parent∩derived
// intersection and the monotonic-subset property over it, the fail-
// closed parse, the per-call fact, and the claim's construction and
// matching. The gate's deny-immutability lives in approvalPolicy's
// tests; the drivers' wiring is pinned on source further below, the
// repo's convention for code Vitest cannot run.
const cs = await import(new URL('../../supabase/functions/_shared/chainScope.ts', import.meta.url).pathname);
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const it8 = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);
const da = await import(new URL('../../supabase/functions/_shared/delegatedAuth.ts', import.meta.url).pathname);

const GH = '11111111-1111-4111-8111-111111111111';
const DR = '22222222-2222-4222-8222-222222222222';
const SL = '33333333-3333-4333-8333-333333333333';
const API = '44444444-4444-4444-8444-444444444444';
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRAT = '55555555-5555-4555-8555-555555555555';

const manifestOf = (commands: unknown[], aliases?: Record<string, string>) =>
  cm.parseManifest({ commands, ...(aliases ? { aliases } : {}) }).manifest;

const GH_MANIFEST = manifestOf([
  { name: 'create_issue', action: 'issues.create', effect: 'write', mcp: 'create_issue' },
  { name: 'get_issue', action: 'issues.get', effect: 'read', mcp: 'get_issue' },
  { name: 'delete_repo', action: 'repos.delete', effect: 'write', mcp: 'delete_repository', permission: 'deny' },
]);

const row = (over: Record<string, unknown>) => ({
  id: GH, name: 'GitHub', preset: 'github', kind: 'mcp', manifest: GH_MANIFEST, isDrive: false, ...over,
});

describe('deriveScopeFromDefinition — the assembly\u2019s rules, restated as a ceiling', () => {
  it('matches by the row\u2019s name, its preset id, or its preset display name, folded', () => {
    const rows = [row({}), row({ id: DR, name: 'Drive', preset: 'google-drive', kind: 'http', manifest: null, isDrive: true })];
    expect(cs.deriveScopeFromDefinition({ connectors: [' github '], integrations: rows, strategyId: null }).integrations).toEqual([GH]);
    expect(cs.deriveScopeFromDefinition({ connectors: ['GITHUB'], integrations: rows, strategyId: null }).integrations).toEqual([GH]);
    expect(cs.deriveScopeFromDefinition({ connectors: ['Google Drive'], integrations: rows, strategyId: null }).integrations).toEqual([DR]);
    expect(cs.deriveScopeFromDefinition({ connectors: ['google-drive'], integrations: rows, strategyId: null }).integrations).toEqual([DR]);
    expect(cs.deriveScopeFromDefinition({ connectors: ['Notion'], integrations: rows, strategyId: null })).toEqual({ actions: [], integrations: [] });
  });

  it('lists every declared command\u2019s canonical action — deny-permission ones included (a ceiling, not a permission)', () => {
    const derived = cs.deriveScopeFromDefinition({ connectors: ['GitHub'], integrations: [row({})], strategyId: null });
    expect(derived.integrations).toEqual([GH]);
    expect(derived.actions).toEqual([`${GH}:issues.create`, `${GH}:issues.get`, `${GH}:repos.delete`]);
  });

  it('a manifest-less row fences by id alone; an untested MCP row and an empty manifest stay out entirely', () => {
    const rows = [
      row({ id: DR, name: 'Drive', preset: 'google-drive', kind: 'http', manifest: null, isDrive: true }),
      row({ id: API, name: 'Weather', preset: null, kind: 'http', manifest: null }),
      row({ id: SL, name: 'Slack', preset: 'slack', kind: 'mcp', manifest: null }),
      row({ id: '66666666-6666-4666-8666-666666666666', name: 'Empty', preset: null, kind: 'http', manifest: manifestOf([]) }),
    ];
    const derived = cs.deriveScopeFromDefinition({ connectors: [], integrations: rows, strategyId: null });
    expect(derived.integrations).toEqual([DR, API].sort());
    expect(derived.actions).toEqual([]);
  });

  it('empty connectors reach the whole eligible set — and only that set (the mint-time freeze)', () => {
    const rows = [row({}), row({ id: SL, name: 'Slack', preset: 'slack', manifest: manifestOf([{ name: 'post', action: 'chat.post', effect: 'write', mcp: 'chat_postMessage' }]) })];
    const derived = cs.deriveScopeFromDefinition({ connectors: [], integrations: rows, strategyId: null });
    expect(derived.integrations).toEqual([GH, SL].sort());
    expect(derived.actions).toContain(`${SL}:chat.post`);
    expect(derived.actions).toContain(`${GH}:issues.create`);
  });
});

describe('scopes at birth — roots, children, the cap', () => {
  const derived = { actions: [`${GH}:issues.create`, `${GH}:issues.get`], integrations: [GH] };

  it('a root stands at depth 0 as its own parent and root', () => {
    const scope = cs.rootChainScope({ runId: RUN_A, derived, strategyId: STRAT });
    expect(scope).toMatchObject({ rootRunId: RUN_A, parentRunId: RUN_A, depth: 0, maxDepth: cs.CHAIN_POLICY.maxDepth, strategyId: STRAT });
    expect(scope.actions).toEqual(derived.actions);
  });

  it('an unscoped parent hands the derivation down whole, at depth 1, rooted at itself', () => {
    const child = cs.deriveChildScope({ parent: null, parentRunId: RUN_A, derived, strategyId: STRAT });
    expect(child).toMatchObject({ rootRunId: RUN_A, parentRunId: RUN_A, depth: 1, strategyId: STRAT });
    expect(child.actions).toEqual(derived.actions);
    expect(child.integrations).toEqual([GH]);
  });

  it('a scoped parent intersects: the child reaches the overlap, one deeper, root and cap inherited', () => {
    const parent = cs.rootChainScope({ runId: RUN_A, derived: { actions: [`${GH}:issues.create`, `${SL}:chat.post`], integrations: [GH, SL] }, strategyId: null });
    const child = cs.deriveChildScope({
      parent, parentRunId: RUN_B,
      derived: { actions: [`${GH}:issues.create`, `${GH}:issues.get`, `${SL}:chat.post`], integrations: [GH, SL] },
      strategyId: STRAT,
    });
    expect(child.actions).toEqual([`${GH}:issues.create`, `${SL}:chat.post`]);
    expect(child.integrations).toEqual([GH, SL].sort());
    expect(child).toMatchObject({ rootRunId: RUN_A, parentRunId: RUN_B, depth: 1, maxDepth: parent.maxDepth });
  });

  it('an empty intersection is still a scope — empty lists, never null', () => {
    const parent = cs.rootChainScope({ runId: RUN_A, derived: { actions: [`${SL}:chat.post`], integrations: [SL] }, strategyId: null });
    const child = cs.deriveChildScope({ parent, parentRunId: RUN_B, derived, strategyId: null });
    expect(child).not.toBeNull();
    expect(child.actions).toEqual([]);
    expect(child.integrations).toEqual([]);
    expect(child.depth).toBe(1);
  });

  it('the cap: a child past maxDepth is refused a birth; a person\u2019s own start is depth 0', () => {
    const atCap = { ...cs.rootChainScope({ runId: RUN_A, derived, strategyId: null }), depth: cs.CHAIN_POLICY.maxDepth };
    expect(cs.chainDepthFor({ parent: atCap, hasParentRun: true })).toEqual({ depth: cs.CHAIN_POLICY.maxDepth + 1, maxDepth: cs.CHAIN_POLICY.maxDepth, capped: true });
    expect(cs.chainDepthFor({ parent: null, hasParentRun: true })).toEqual({ depth: 1, maxDepth: cs.CHAIN_POLICY.maxDepth, capped: false });
    expect(cs.chainDepthFor({ parent: null, hasParentRun: false })).toEqual({ depth: 0, maxDepth: cs.CHAIN_POLICY.maxDepth, capped: false });
  });
});

// ── The monotonic-subset property (design §3.4) ─────────────────────
// For any parent scope S (absent = the virtual scope of everything
// the derivation could reach in this Space) and ANY derivation D,
// deriveChildScope returns S' with S' ⊆ S AND S' ⊆ D, one link
// deeper; a child past the cap is never created. Seeded, 1,000
// generated cases, chains traced to depth 3.
describe('chainScopeSubsetProperty', () => {
  const mulberry32 = (seed: number) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const IDS = [GH, DR, SL, API, '77777777-7777-4777-8777-777777777777'];
  const ACTION_POOL = ['issues.create', 'issues.get', 'chat.post', 'files.list', 'repos.delete', 'mail.send'];

  it('holds at every link of 1,000 generated chains', () => {
    const rnd = mulberry32(0xB10);
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
    const subset = <T,>(arr: readonly T[]): T[] => arr.filter(() => rnd() < 0.5);

    for (let caseNo = 0; caseNo < 1000; caseNo++) {
      // A random Space: each integration present or not, manifest of
      // random commands, a Drive row among them.
      const space: unknown[] = IDS.flatMap((id, i) => rnd() < 0.25 ? [] : [{
        id, name: `Conn${i}`, preset: `preset${i}`, kind: i % 2 ? 'http' : 'mcp',
        isDrive: i === 1,
        manifest: i === 1 ? null : manifestOf(subset(ACTION_POOL).map((action, j) => ({
          name: `cmd_${i}_${j}`, action, effect: j % 2 ? 'read' : 'write', mcp: `cmd_${i}_${j}`,
        }))),
      }]);
      const deriveFor = (connectors: string[]) =>
        cs.deriveScopeFromDefinition({ connectors, integrations: space as never, strategyId: null });
      const universe = deriveFor([]);
      const names = (space as { name: string }[]).map((r) => r.name);

      // The chain's root: a person's run (unscoped — the virtual
      // parent is the universe at depth 0) half the time, an
      // automation's scoped root the other half.
      let parent: unknown = null;
      let virtual: NonNullable<ReturnType<typeof cs.parseChainScope>> = {
        v: 1, rootRunId: RUN_A, parentRunId: RUN_A, strategyId: null, depth: 0,
        maxDepth: cs.CHAIN_POLICY.maxDepth, actions: universe.actions, integrations: universe.integrations,
      };
      if (rnd() < 0.5) {
        parent = cs.rootChainScope({ runId: RUN_A, derived: deriveFor(subset(names)), strategyId: null });
        virtual = parent as typeof virtual;
      }
      let parentRunId = RUN_A;
      for (let link = 0; link < 3; link++) {
        const derived = deriveFor(subset(names));
        const child = cs.deriveChildScope({ parent: parent as never, parentRunId, derived, strategyId: null });
        // S' ⊆ S and S' ⊆ D, same root and cap, exactly one deeper.
        expect(cs.chainScopeSubsetOf(child, virtual as never), `case ${caseNo} link ${link}`).toBe(true);
        expect(child.actions.every((a: string) => derived.actions.includes(a))).toBe(true);
        expect(child.integrations.every((i: string) => derived.integrations.includes(i))).toBe(true);
        // Creation obeys the cap: chainDepthFor agrees with the
        // depth the child would stand at.
        const depth = cs.chainDepthFor({ parent: parent as never, hasParentRun: true });
        expect(depth.depth).toBe(child.depth);
        if (depth.capped) expect(child.depth).toBeGreaterThan(child.maxDepth);
        else expect(child.depth).toBeLessThanOrEqual(child.maxDepth);
        parent = child; virtual = child; parentRunId = pick([RUN_B, RUN_C]);
      }
    }
  });
});

describe('parseChainScope — a broken record fails closed, never open', () => {
  const good = {
    v: 1, rootRunId: RUN_A, parentRunId: RUN_B, strategyId: STRAT, depth: 2, maxDepth: 8,
    actions: [`${GH}:issues.get`, `${GH}:issues.create`, `${GH}:issues.create`], integrations: [GH, GH],
  };

  it('absent is null — the unscoped root every run today is', () => {
    expect(cs.parseChainScope(null)).toBeNull();
    expect(cs.parseChainScope(undefined)).toBeNull();
    expect(cs.chainScopeMalformed(null)).toBe(false);
  });

  it('a valid value round-trips through normalization (sorted, de-duplicated)', () => {
    const scope = cs.parseChainScope(good);
    expect(scope?.actions).toEqual([`${GH}:issues.create`, `${GH}:issues.get`]);
    expect(scope?.integrations).toEqual([GH]);
    expect(cs.chainScopeMalformed(good)).toBe(false);
    expect(cs.chainScopeEquals(scope!, cs.parseChainScope(JSON.parse(JSON.stringify(scope)))!)).toBe(true);
  });

  it.each([
    ['a string', 'scoped'],
    ['an array', []],
    ['wrong version', { ...good, v: 2 }],
    ['negative depth', { ...good, depth: -1 }],
    ['fractional depth', { ...good, depth: 1.5 }],
    ['zero cap', { ...good, maxDepth: 0 }],
    ['a non-string action', { ...good, actions: [42] }],
    ['actions not a list', { ...good, actions: `${GH}:issues.get` }],
    ['missing root', { ...good, rootRunId: '' }],
    ['strategy of the wrong type', { ...good, strategyId: 7 }],
  ])('malformed (%s) reads as the empty scope at full depth', (_label, value) => {
    const scope = cs.parseChainScope(value);
    expect(scope).not.toBeNull();
    expect(scope?.actions).toEqual([]);
    expect(scope?.integrations).toEqual([]);
    expect(scope?.depth).toBe(cs.CHAIN_POLICY.maxDepth);
    expect(cs.chainScopeMalformed(value)).toBe(true);
  });
});

describe('chainFactFor / chainAllows — the fence, per call shape', () => {
  const scope = cs.rootChainScope({
    runId: RUN_A, strategyId: null,
    derived: { actions: [`${GH}:issues.create`, `${GH}:issues.get`], integrations: [GH, DR] },
  });
  const integrationRow = (over: Record<string, unknown>) => ({
    id: GH, preset: 'github', kind: 'mcp', name: 'GitHub', description: null,
    endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', auth_header: null,
    delegation: 'approve_each', ...over,
  });
  const toolFor = (commandName?: string, over: Record<string, unknown> = {}) => ({
    integration: integrationRow({}),
    ...(commandName ? { command: GH_MANIFEST.commands.find((c: { name: string }) => c.name === commandName), manifest: GH_MANIFEST } : {}),
    ...over,
  });
  const call = (name: string) => ({ id: `c-${name}`, name, input: {} });

  it('an in-scope manifest command stands inside — reads included (D3)', () => {
    expect(cs.chainFactFor(scope, toolFor('create_issue') as never, call('github_1111__create_issue') as never)).toEqual({ inScope: true });
    expect(cs.chainFactFor(scope, toolFor('get_issue') as never, call('github_1111__get_issue') as never)).toEqual({ inScope: true });
  });

  it('an out-of-scope manifest command stands outside — a READ refused the same as a write', () => {
    const narrow = cs.rootChainScope({ runId: RUN_A, strategyId: null, derived: { actions: [`${GH}:issues.create`], integrations: [GH] } });
    expect(cs.chainFactFor(narrow, toolFor('get_issue') as never, call('github_1111__get_issue') as never)).toEqual({ inScope: false });
    expect(cs.chainFactFor(scope, toolFor('delete_repo') as never, call('github_1111__delete_repository') as never)).toEqual({ inScope: false });
  });

  it('the key is the canonical action, so a renamed command still matches the scope minted under its old name', () => {
    // manifestFromTools defaults action = name, but a drafted
    // manifest's canonical action can outlive a command rename: the
    // scope lists actions, and the call is keyed by resolving its
    // command name through canonicalAction — the two meet at the
    // action, not the name (design §5.5's judgement table).
    const renamed = manifestOf([{ name: 'make_issue', action: 'issues.create', effect: 'write', mcp: 'create_issue' }]);
    const it = { integration: integrationRow({}), command: renamed.commands[0], manifest: renamed };
    expect(cs.chainKeyForCall(it as never, call('github_1111__make_issue') as never)).toBe(`${GH}:issues.create`);
    expect(cs.chainFactFor(scope, it as never, call('github_1111__make_issue') as never)).toEqual({ inScope: true });
  });

  it('a Drive typed tool is judged by its integration, and an integration outside the fence is out', () => {
    const drive = { integration: integrationRow({ id: DR, name: 'Google Drive', preset: 'google-drive', kind: 'http' }), drive: true };
    expect(cs.chainFactFor(scope, drive as never, call('google_2222__drive_list_files') as never)).toEqual({ inScope: true });
    const other = { integration: integrationRow({ id: SL, name: 'Slack', preset: 'slack' }), drive: true };
    expect(cs.chainFactFor(scope, other as never, call('slack_3333__drive_list_files') as never)).toEqual({ inScope: false });
  });

  it('the raw http_request is outside every scope — unattributable, by construction', () => {
    const raw = { integration: integrationRow({ id: API, name: 'Weather', preset: null, kind: 'http' }) };
    const wide = cs.rootChainScope({ runId: RUN_A, strategyId: null, derived: { actions: [], integrations: [API] } });
    expect(cs.chainFactFor(wide, raw as never, call('weather_4444__http_request') as never)).toEqual({ inScope: false });
  });

  it('a call with no integration tool carries no fact — the catalog/board/runner surfaces keep their own policies', () => {
    expect(cs.chainFactFor(scope, undefined, call('record_progress') as never)).toBeNull();
  });

  it('chainAllows reads the allowlist plainly', () => {
    expect(cs.chainAllows(scope, `${GH}:issues.create`)).toBe(true);
    expect(cs.chainAllows(scope, `${GH}:repos.delete`)).toBe(false);
  });
});

describe('connectorMatches — the one matching rule (assembly and derivation share it)', () => {
  it('answers by row name, preset id, or preset display name, folded', () => {
    const gh = { name: 'GitHub', preset: 'github' };
    expect(it8.connectorMatches(gh, ['GitHub'])).toBe(true);
    expect(it8.connectorMatches(gh, [' github '])).toBe(true);
    expect(it8.connectorMatches({ name: 'My Drive', preset: 'google-drive' }, ['Google Drive'])).toBe(true);
    expect(it8.connectorMatches({ name: 'My Drive', preset: 'google-drive' }, ['google-drive'])).toBe(true);
    expect(it8.connectorMatches(gh, ['Slack'])).toBe(false);
    expect(it8.connectorMatches({ name: 'Plain HTTP', preset: null }, [])).toBe(false);
  });
});

describe('the chain claim — construction and matching (carriage, never truth)', () => {
  const USER = '99999999-9999-4999-8999-999999999999';
  const scope = cs.rootChainScope({
    runId: RUN_A, strategyId: STRAT,
    derived: { actions: [`${GH}:issues.create`], integrations: [GH] },
  });

  it('via "chain" requires its claim and carries it with the standing TTL; other vias never carry one', () => {
    const claims = da.buildUserClaims({ userId: USER, via: 'chain', chain: { ...scope, runId: RUN_B } }, 1_700_000_000);
    expect(claims.alcon_via).toBe('chain');
    expect(claims.alcon_chain?.runId).toBe(RUN_B);
    expect(claims.alcon_chain?.actions).toEqual([`${GH}:issues.create`]);
    expect(claims.exp - claims.iat).toBe(da.DELEGATED_JWT_TTL_SECONDS);
    expect(() => da.buildUserClaims({ userId: USER, via: 'chain' })).toThrow();
    expect(da.buildUserClaims({ userId: USER, via: 'pat', patId: RUN_A }, 1_700_000_000)).not.toHaveProperty('alcon_chain');
    expect(da.buildUserClaims({ userId: USER, via: 'oauth', clientId: 'client' }, 1_700_000_000)).not.toHaveProperty('alcon_chain');
  });

  it('mintChainJwt is the one signing path (mintUserJwt), not a second one', () => {
    const src = require('node:fs').readFileSync(new URL('../../supabase/functions/_shared/delegatedAuth.ts', import.meta.url), 'utf8') as string;
    expect(src).toContain('export async function mintChainJwt');
    expect(src).toContain('return mintUserJwt({ userId: args.userId, via: "chain"');
    expect(src.match(/new jose\.SignJWT/g)).toHaveLength(1);
  });

  const jwtOf = (payload: Record<string, unknown>) => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
  };

  it('chainClaimOf reads the claim back from a token; a bare session carries none', () => {
    const token = jwtOf({ sub: USER, alcon_via: 'chain', alcon_chain: { ...scope, runId: RUN_B } });
    expect(da.chainClaimOf(token)?.runId).toBe(RUN_B);
    expect(da.chainClaimOf(jwtOf({ sub: USER, alcon_via: 'pat' }))).toBeNull();
    expect(da.chainClaimOf('not-a-jwt')).toBeNull();
  });

  it('chainClaimMatches: the claim must name this run and equal the row\u2019s scope', () => {
    const claim = { ...scope, runId: RUN_B };
    expect(cs.chainClaimMatches(claim, scope, RUN_B)).toBe(true);
    // List order is not a difference (canonical form decides).
    const shuffled = { ...claim, actions: [...scope.actions].reverse() };
    expect(cs.chainClaimMatches(shuffled, scope, RUN_B)).toBe(true);
    expect(cs.chainClaimMatches(claim, scope, RUN_A)).toBe(false); // names another run
    expect(cs.chainClaimMatches({ ...claim, actions: [...scope.actions, `${SL}:chat.post`] }, scope, RUN_B)).toBe(false); // wider than the row
    expect(cs.chainClaimMatches(claim, null, RUN_B)).toBe(false); // the row carries no scope
    expect(cs.chainClaimMatches(null, scope, RUN_B)).toBe(false);
    expect(cs.chainClaimMatches('chain', scope, RUN_B)).toBe(false);
  });
});

// ── The drivers' wiring, pinned on source (fixtures 9, 12, 13) ──────
// run-agent and automations are Deno code Vitest cannot execute; the
// repo's convention (promotionOffer.test.ts) asserts the wiring on
// source while the pure rules above carry the behaviour. What is
// pinned: the three mint sites and their shapes, the cap's refusal
// to create, serve()'s claim matching, and the continuation's
// re-mint — the lifecycle a scoped run actually lives.
describe('the mint and the carriage — driver wiring (source pins)', () => {
  const read = (rel: string) => require('node:fs').readFileSync(new URL(rel, import.meta.url), 'utf8') as string;
  const runAgent = read('../../supabase/functions/run-agent/index.ts');
  const automations = read('../../supabase/functions/automations/index.ts');

  it('advanceFrom mints from the parent row, the child definition and the Space rows — and drives under a chain token', () => {
    expect(runAgent).toContain('deriveChildScope({ parent: parent.scope, parentRunId: parent.id, derived, strategyId })');
    expect(runAgent).toContain('rootChainScope({ runId: childRunId, derived, strategyId })');
    expect(runAgent).toContain('loadDerivationIntegrations(admin, spaceId)');
    expect(runAgent).toContain('chain_scope: scope');
    expect(runAgent).toContain('await chainDriveJwt(user.id, scope, next.id, a.jwt)');
    // finishRun hands its own run over as the parent.
    expect(runAgent).toContain('chain_scope: run.chain_scope, activity_space_id: run.activity_space_id, triggered_by: run.triggered_by');
  });

  it('at the cap no child is created: the Element stays ready and the cap is said in three places', () => {
    expect(runAgent).toContain('chainDepthFor({ parent: parent.scope, hasParentRun: true }).capped');
    expect(runAgent).toContain('capped.push({ elementId: id, title: el?.title ?? id });');
    expect(runAgent).toContain('連鎖の深さ上限（${maxDepth}）に達したため、');
    expect(runAgent).toContain('**連鎖の上限**');
    expect(runAgent).toContain('title: "連鎖の上限に達しました"');
    expect(runAgent).toContain('開始ボタンで新しく始められます');
  });

  it('a scoped insert that fails (the column has not landed) falls back to starting unscoped, never to not starting', () => {
    expect(runAgent).toContain('chain scope insert failed; starting unscoped');
    expect(automations).toContain('chain scope insert failed; starting unscoped');
    expect(runAgent).toContain('apply run scope insert failed; starting unscoped');
  });

  it('decidePlan copies the plan run\u2019s scope verbatim — one chain link, no depth spent', () => {
    expect(runAgent).toContain('let applyScope: ChainScope | null = planScope ? { ...planScope, parentRunId: run.id } : null;');
    expect(runAgent).toContain('await chainDriveJwt(user.id, applyScope, applyRunId, a.jwt)');
  });

  it('an automation\u2019s fired run is born scoped from its harness (D4), inserted by the service role', () => {
    expect(automations).toContain('const firedScope = rootChainScope({');
    expect(automations).toContain('connectors: parseDefinition(def.body ?? "").connectors');
    expect(automations).toContain('chain_scope: firedScope');
    expect(automations).toContain('env.admin.from("agent_runs")');
  });

  it('serve() refuses a drive whose chain claim disagrees with the row (403), before any decision is read', () => {
    const claimCheck = runAgent.indexOf('chainClaimMatches(chainClaim, parseChainScope(run.chain_scope), runId)');
    const decisionCheck = runAgent.indexOf('if (body.decision) {');
    expect(claimCheck).toBeGreaterThan(-1);
    expect(decisionCheck).toBeGreaterThan(claimCheck);
    expect(runAgent).toContain('提示された連鎖の範囲が、この実行の範囲と一致しません。');
  });

  it('a scoped run\u2019s continuation re-mints from the row instead of forwarding a dying claim', () => {
    expect(runAgent).toContain('const driveJwt = runScope ? await chainDriveJwt(user.id, runScope, run.id, a.jwt) : a.jwt;');
  });

  it('the run says its chain on its first slice — and a malformed scope is said, not silent', () => {
    expect(runAgent).toContain('連鎖実行として開始（深さ ${runScope.depth}/${runScope.maxDepth}、起点の実行 ${runScope.rootRunId}）');
    expect(runAgent).toContain('連鎖の範囲の記録が読めなかったため、連携の操作はすべて拒否します');
  });

  it('the assembly matches connectors by the shared rule (connectorMatches), not a local fold', () => {
    expect(runAgent).toContain('wantedConnectors.filter((c) => connectorMatches(row, [c]))');
  });
});

// ── Enforcement wiring (fixtures 10, 11) ─────────────────────────────
// The gate's composition is behaviour-tested in approvalPolicy's
// matrix; what remains is that run-agent actually composes the fact
// at the one point, delivers the fence's wording first, checks the
// plan twice, and leaves compensation unfenced — pinned on source,
// as with the mint above.
describe('enforcement — driver wiring (source pins)', () => {
  const read = (rel: string) => require('node:fs').readFileSync(new URL(rel, import.meta.url), 'utf8') as string;
  const runAgent = read('../../supabase/functions/run-agent/index.ts');
  const planMode = read('../../supabase/functions/_shared/planMode.ts');

  it('factsForCall composes the chain fact from the ROW scope for every integration call', () => {
    expect(runAgent).toContain('const chainFact = chainFactFor(runScope, it, call);');
    expect(runAgent).toContain('facts.chain = chainFact;');
    expect(runAgent).toContain('if (!chainFact.inScope) chainDeniedCalls.add(call.id);');
    // The scope comes from the row (parsed at the driver's head),
    // never from the request or the model.
    expect(runAgent).toContain('const runScope = parseChainScope(run.chain_scope);');
  });

  it('the deny delivery answers a chain-denied call with the fence\u2019s wording, before the manifest\u2019s', () => {
    const chainBranch = runAgent.indexOf('if (chainDeniedCalls.has(call.id))');
    const manifestBranch = runAgent.indexOf('manifestDenyRefusal(deniedTool.command.name)');
    expect(chainBranch).toBeGreaterThan(-1);
    expect(manifestBranch).toBeGreaterThan(chainBranch);
    expect(runAgent).toContain('chainDeniedCount++;');
    expect(runAgent).toContain('chainDenied: chainDeniedCount,');
  });

  it('the assembly does not offer a scoped run what its fence excludes (politeness, not the boundary)', () => {
    expect(runAgent).toContain('if (runScope && !runScope.integrations.includes(row.id)) continue;');
  });

  it('plan mode: an out-of-scope call is refused at record time and asserted again at apply time', () => {
    expect(runAgent).toContain('const chainFact = chainFactFor(runScope, pit, call);');
    expect(runAgent).toContain('return { content: chainDenyRefusal(pit.integration.name, operationOf(pit, call.input)), is_error: true };');
    expect(runAgent).toContain('await settlePlanApproval(admin, chainActionId, false, { chainDenied: true });');
    expect(planMode).toContain('chainDenied?: boolean');
    expect(planMode).toContain('...(opts?.chainDenied ? { chainDenied: true } : {}),');
  });

  it('compensation verdicts carry no chain fact — the rollback is not fenced (B9\u2019s path, §6.4)', () => {
    expect(runAgent).toContain('verdictOf: (call: ToolCall) => verdictForCall(call, { noChain: true }),');
    expect(runAgent).toContain('if (runScope && !opts?.noChain) {');
  });

  it('a chain denial leaves no agent_actions row: the refusal returns before any approval is recorded', () => {
    // The deny branch returns the refusal inside the loop's execute
    // wrapper, ahead of the policy-approval recording below it —
    // the same shape a manifest denial has always had.
    const denyAt = runAgent.indexOf('if (chainDeniedCalls.has(call.id))');
    const policyAt = runAgent.indexOf('let policyActionId: string | null = null;');
    expect(denyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeGreaterThan(denyAt);
  });
});

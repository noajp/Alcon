import { describe, expect, it } from 'vitest';

// Personal access tokens (ADR 0032): the pure parts of the edge auth path.
const auth = await import(new URL('../../supabase/functions/_shared/delegatedAuth.ts', import.meta.url).pathname);
const protocol = await import(new URL('../../supabase/functions/alcon-mcp/protocol.ts', import.meta.url).pathname);
const { mcpTools, mcpHost, MCP_READ_TOOLS, MCP_WRITE_TOOLS } = await import(new URL('../../supabase/functions/alcon-mcp/tools.ts', import.meta.url).pathname);
const client = await import(new URL('../../supabase/functions/_shared/integrationClient.ts', import.meta.url).pathname);

const {
  PAT_PREFIX, DELEGATED_JWT_TTL_SECONDS, isPersonalAccessToken, isWellFormedPersonalAccessToken, bearerToken,
  sha256Hex, buildUserClaims, parseSigningKey,
} = auth;
const { clientLabel, clientName, handleBody, RPC } = protocol;

const USER = '60b10d95-f1d7-40dc-9d59-0836f4ae333c';
const PAT_ID = '93fb2fb0-a7a1-434e-9211-af4db709a247';
// 'alc_pat_' + 43 base64url characters, the shape create_personal_access_token issues.
const SAMPLE_PAT = `alc_pat_${'A'.repeat(20)}-_${'z'.repeat(21)}`;

describe('personal access token detection', () => {
  it('tells a token from a JWT by its prefix', () => {
    expect(PAT_PREFIX).toBe('alc_pat_');
    expect(isPersonalAccessToken(SAMPLE_PAT)).toBe(true);
    expect(isPersonalAccessToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig')).toBe(false);
    expect(isPersonalAccessToken('ALC_PAT_x')).toBe(false);
  });

  it('accepts only the issued shape', () => {
    expect(isWellFormedPersonalAccessToken(SAMPLE_PAT)).toBe(true);
    expect(isWellFormedPersonalAccessToken('alc_pat_short')).toBe(false);
    expect(isWellFormedPersonalAccessToken(`${SAMPLE_PAT}x`)).toBe(false);
    expect(isWellFormedPersonalAccessToken(`alc_pat_${'A'.repeat(42)}=`)).toBe(false);
    expect(isWellFormedPersonalAccessToken(`alc_pat_${'A'.repeat(42)}+`)).toBe(false);
  });

  it('reads the bearer value of an Authorization header', () => {
    expect(bearerToken(`Bearer ${SAMPLE_PAT}`)).toBe(SAMPLE_PAT);
    expect(bearerToken(`bearer   ${SAMPLE_PAT}  `)).toBe(SAMPLE_PAT);
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('hashes with SHA-256 hex, as token_hash stores it', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(SAMPLE_PAT)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildUserClaims', () => {
  const now = 1_790_000_000;

  it('mints an authenticated, five-minute claim set for the token owner', () => {
    const c = buildUserClaims({ userId: USER, via: 'pat', patId: PAT_ID }, now);
    expect(c).toEqual({
      sub: USER, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 300, alcon_via: 'pat', pat_id: PAT_ID,
    });
    expect(DELEGATED_JWT_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(c.exp - c.iat).toBeLessThanOrEqual(300);
  });

  it('never carries service_role, whatever the subject smuggles in', () => {
    const sneaky = { userId: USER, via: 'pat', patId: PAT_ID, role: 'service_role', aud: 'service_role' } as never;
    const c = buildUserClaims(sneaky, now);
    expect(c.role).toBe('authenticated');
    expect(c.aud).toBe('authenticated');
    expect(JSON.stringify(c)).not.toContain('service_role');
  });

  it('names the OAuth client for an OAuth grant', () => {
    const c = buildUserClaims({ userId: USER, via: 'oauth', clientId: 'chatgpt' }, now);
    expect(c.client_id).toBe('chatgpt');
    expect(c.alcon_via).toBe('oauth');
    expect(c.pat_id).toBeUndefined();
  });

  it('refuses a subject that is not a user, or a delegation without its id', () => {
    expect(() => buildUserClaims({ userId: 'service_role', via: 'pat', patId: PAT_ID }, now)).toThrow();
    expect(() => buildUserClaims({ userId: USER, via: 'pat' }, now)).toThrow();
    expect(() => buildUserClaims({ userId: USER, via: 'oauth' }, now)).toThrow();
    expect(() => buildUserClaims({ userId: USER, via: 'session' } as never, now)).toThrow();
  });
});

describe('parseSigningKey', () => {
  it('fails closed without a key', () => {
    expect(parseSigningKey(undefined)).toBeNull();
    expect(parseSigningKey('  ')).toBeNull();
  });
  it('uses the legacy secret for HS256 and an EC private JWK for ES256', () => {
    expect(parseSigningKey('not-a-real-secret')).toEqual({ alg: 'HS256', secret: 'not-a-real-secret' });
    const jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd', kid: 'k1' };
    expect(parseSigningKey(JSON.stringify(jwk))).toEqual({ alg: 'ES256', jwk, kid: 'k1' });
    // A public JWK cannot sign: treated as a plain secret, never as ES256.
    expect(parseSigningKey(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }))?.alg).toBe('HS256');
  });
});

describe('clientLabel with a token', () => {
  const url = (q = '') => new URL(`https://x.supabase.co/functions/v1/alcon-mcp${q}`);
  it('names the token after the client', () => {
    expect(clientLabel(url('?client=Claude%20Code'), null, { token: 'laptop' })).toBe('Claude Code (MCP · token: laptop)');
    expect(clientLabel(url(), 'claude-code/2.1.0', { token: 'CI runner' })).toBe('Claude Code (MCP · token: CI runner)');
    expect(clientLabel(url(), 'claude-code/2.1.0', null)).toBe('Claude Code (MCP)');
    expect(clientName(url('?client=Cursor'), 'claude-code/2')).toBe('Cursor');
  });
  it('sanitises the token name and caps it at 40 characters', () => {
    expect(clientLabel(url(), null, { token: 'lap<script>top)' })).toBe('AI (MCP · token: lapscripttop)');
    const long = 'a'.repeat(60);
    expect(clientLabel(url(), null, { token: long })).toBe(`AI (MCP · token: ${'a'.repeat(40)})`);
    expect(clientLabel(url(), null, { token: '<<>>' })).toBe('AI (MCP · token)');
  });
});

describe('read-only tokens', () => {
  it('are offered no write tool', () => {
    const names = mcpTools('read').map((t: { name: string }) => t.name);
    expect(names).toEqual([...MCP_READ_TOOLS]);
    for (const w of MCP_WRITE_TOOLS) expect(names).not.toContain(w);
    expect(mcpTools('read').every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    expect(mcpTools('read_write').map((t: { name: string }) => t.name)).toEqual([...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS]);
  });

  it('refuse a write call with INVALID_PARAMS before any tool runs', async () => {
    const touched: string[] = [];
    const db = { from: (table: string) => { touched.push(table); throw new Error('no db access expected'); } } as never;
    const host = mcpHost(db, { agent: 'Claude Code (MCP · token: laptop)', userId: USER }, 'read');
    const res = await handleBody(JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'createElement', arguments: { title: 'x' } },
    }), host);
    expect(res.status).toBe(200);
    expect((res.body as { error: { code: number } }).error.code).toBe(RPC.INVALID_PARAMS);
    // Called directly, the host still refuses.
    expect(await host.call('updateElement', {})).toMatchObject({ ok: false });
    expect(touched).toEqual([]);
  });
});

describe('agents never reach Alcon through an integration', () => {
  it('recognises the project host', () => {
    const base = 'https://rkugtcqztkkacvoylupw.supabase.co';
    expect(client.pointsAtAlcon(`${base}/functions/v1/alcon-mcp`, base)).toBe(true);
    expect(client.pointsAtAlcon('https://RKUGTCQZTKKACVOYLUPW.supabase.co./rest/v1', `${base}/`)).toBe(true);
    expect(client.pointsAtAlcon('https://mcp.linear.app/mcp', base)).toBe(false);
    expect(client.pointsAtAlcon('https://other.supabase.co/functions/v1/alcon-mcp', base)).toBe(false);
    expect(client.pointsAtAlcon('not a url', base)).toBe(false);
  });

  it('also recognises the legacy functions host, in any case, with a trailing dot or a port', () => {
    const base = 'https://rkugtcqztkkacvoylupw.supabase.co';
    expect(client.pointsAtAlcon('https://rkugtcqztkkacvoylupw.functions.supabase.co/alcon-mcp', base)).toBe(true);
    expect(client.pointsAtAlcon('https://RKUGTCQZTKKACVOYLUPW.Functions.Supabase.co./alcon-mcp', base)).toBe(true);
    expect(client.pointsAtAlcon('https://rkugtcqztkkacvoylupw.functions.supabase.co:443/alcon-mcp', base)).toBe(true);
    expect(client.pointsAtAlcon('https://rkugtcqztkkacvoylupw.supabase.co:8443/functions/v1/alcon-mcp', base)).toBe(true);
    expect(client.pointsAtAlcon('https://other.functions.supabase.co/alcon-mcp', base)).toBe(false);
    expect(client.pointsAtAlcon('https://rkugtcqztkkacvoylupw.supabase.co.evil.example/x', base)).toBe(false);
    // A custom-domain SUPABASE_URL still matches itself.
    expect(client.pointsAtAlcon('https://api.alcon.example/functions/v1/alcon-mcp', 'https://api.alcon.example')).toBe(true);
    expect(client.pointsAtAlcon(`${base}/x`, undefined)).toBe(false);
  });
});

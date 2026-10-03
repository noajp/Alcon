import { describe, expect, it } from 'vitest';
import {
  authorizationIdFrom, mergeConnectedApps, redirectHost, safeRedirectUrl,
} from '../src/Function/oauth/connectedApps';

// MCP over OAuth (ELE_PLT-004, ADR 0034): discovery, the token classifier,
// the record's name, and the consent / connected-apps helpers.
const oauth = await import(new URL('../../supabase/functions/alcon-mcp/oauth.ts', import.meta.url).pathname);
const auth = await import(new URL('../../supabase/functions/_shared/delegatedAuth.ts', import.meta.url).pathname);
const protocol = await import(new URL('../../supabase/functions/alcon-mcp/protocol.ts', import.meta.url).pathname);
const routes = await import(new URL('../../supabase/functions/alcon-api/routes.ts', import.meta.url).pathname);

const SUPABASE = 'https://ref.supabase.co/';
const CLIENT = '0b6a4f7e-3c51-4d5e-9a0b-6c7d8e9f0a1b';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

describe('protected resource metadata', () => {
  it('names alcon-mcp as the resource and Supabase Auth as its authorization server', () => {
    expect(oauth.protectedResourceMetadata(SUPABASE)).toMatchObject({
      resource: 'https://ref.supabase.co/functions/v1/alcon-mcp',
      authorization_servers: ['https://ref.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
    });
  });

  it('is served under the function', () => {
    expect(oauth.isProtectedResourcePath('/alcon-mcp/.well-known/oauth-protected-resource')).toBe(true);
    expect(oauth.isProtectedResourcePath('/functions/v1/alcon-mcp/.well-known/oauth-protected-resource/')).toBe(true);
    expect(oauth.isProtectedResourcePath('/alcon-mcp')).toBe(false);
    expect(oauth.isProtectedResourcePath('/alcon-api/.well-known/oauth-protected-resource')).toBe(false);
  });

  it('is pointed at by every 401, with an error only when a token was sent', () => {
    const meta = 'resource_metadata="https://ref.supabase.co/functions/v1/alcon-mcp/.well-known/oauth-protected-resource"';
    expect(oauth.wwwAuthenticate(SUPABASE, null)).toBe(`Bearer realm="alcon", ${meta}`);
    expect(oauth.wwwAuthenticate(SUPABASE, 'token is invalid or expired'))
      .toBe(`Bearer realm="alcon", ${meta}, error="invalid_token", error_description="token is invalid or expired"`);
    expect(oauth.wwwAuthenticate(SUPABASE, 'a "b"\r\nc')).toContain('error_description="a b  c"');
  });
});

describe('the OAuth token classifier', () => {
  it('reads a UUID client_id from the unverified payload', () => {
    expect(auth.oauthClientIdOf(jwt({ sub: 'u', client_id: CLIENT }))).toBe(CLIENT);
  });

  it('ignores session JWTs, PATs and malformed values', () => {
    expect(auth.oauthClientIdOf(jwt({ sub: 'u', role: 'authenticated' }))).toBeNull();
    expect(auth.oauthClientIdOf(jwt({ client_id: 'not-a-uuid' }))).toBeNull();
    expect(auth.oauthClientIdOf(jwt({ client_id: 42 }))).toBeNull();
    expect(auth.oauthClientIdOf(`alc_pat_${'A'.repeat(43)}`)).toBeNull();
    expect(auth.oauthClientIdOf('a.%%%.c')).toBeNull();
    expect(auth.oauthClientIdOf('a.b')).toBeNull();
  });

  it('mints an OAuth-delegated JWT that keeps the client and stays authenticated', () => {
    const claims = auth.buildUserClaims({ userId: '60b10d95-f1d7-40dc-9d59-0836f4ae333c', via: 'oauth', clientId: CLIENT }, 1000);
    expect(claims).toMatchObject({ role: 'authenticated', alcon_via: 'oauth', client_id: CLIENT, exp: 1300 });
  });
});

describe('the record names the OAuth client', () => {
  const url = new URL('https://x.test/alcon-mcp');
  it('in MCP', () => {
    expect(protocol.clientLabel(url, 'claude-ai', { oauthClient: 'Claude' })).toBe('Claude (MCP · OAuth)');
    expect(protocol.clientLabel(url, 'openai-mcp', { oauthClient: '<>' })).toBe('ChatGPT (MCP · OAuth)');
  });
  it('in REST', () => {
    expect(routes.apiActorLabel(null, null, 'Claude')).toBe('Claude (API · OAuth)');
    expect(routes.apiActorLabel('n8n', null, 'Claude')).toBe('n8n (API · OAuth)');
    expect(routes.apiActorLabel(null, null, '<>')).toBe('API · OAuth');
  });
});

describe('connected apps', () => {
  const grant = (id: string, name: string, at: string) => ({ client: { id, name, uri: 'https://claude.ai', logo_uri: '' }, scopes: ['email'], granted_at: at });

  it('joins grants with the allowed access, read-only by default, newest first', () => {
    const apps = mergeConnectedApps(
      [grant('a', 'Claude', '2026-10-01T00:00:00Z'), grant('b', ' ', '2026-10-02T00:00:00Z')],
      [{ client_id: 'a', access: 'read_write' }, { client_id: 'b', access: 'nonsense' }],
    );
    expect(apps.map((a) => [a.clientId, a.name, a.access])).toEqual([['b', 'OAuth client', 'read'], ['a', 'Claude', 'read_write']]);
  });

  it('follows absolute redirects, never script or file ones', () => {
    expect(safeRedirectUrl('https://claude.ai/api/mcp/auth_callback?code=x&state=y')).toBe('https://claude.ai/api/mcp/auth_callback?code=x&state=y');
    expect(safeRedirectUrl('http://localhost:6274/callback')).toBe('http://localhost:6274/callback');
    expect(safeRedirectUrl('cursor://anysphere.cursor-retrieval/oauth/callback?code=x')).toBe('cursor://anysphere.cursor-retrieval/oauth/callback?code=x');
    expect(safeRedirectUrl('javascript:alert(1)')).toBeNull();
    expect(safeRedirectUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(safeRedirectUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeRedirectUrl('/relative')).toBeNull();
    expect(safeRedirectUrl(undefined)).toBeNull();
  });

  it('reads the redirect host and the authorization id', () => {
    expect(redirectHost('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('chatgpt.com');
    expect(redirectHost('cursor://callback')).toBe('cursor://callback');
    expect(authorizationIdFrom('?authorization_id=abc')).toBe('abc');
    expect(authorizationIdFrom('?authorization_id=%20')).toBeNull();
    expect(authorizationIdFrom('')).toBeNull();
  });
});

describe('OAuth tokens must carry the hook role', () => {
  it('accepts only alcon_oauth_client', () => {
    expect(auth.OAUTH_CLIENT_ROLE).toBe('alcon_oauth_client');
    expect(auth.hasOAuthClientRole(jwt({ client_id: CLIENT, role: 'alcon_oauth_client' }))).toBe(true);
    expect(auth.hasOAuthClientRole(jwt({ client_id: CLIENT, role: 'authenticated' }))).toBe(false);
    expect(auth.hasOAuthClientRole(jwt({ client_id: CLIENT }))).toBe(false);
    expect(auth.hasOAuthClientRole('not.a.jwt')).toBe(false);
  });

  it('advertises scopes without openid', () => {
    expect(oauth.protectedResourceMetadata(SUPABASE).scopes_supported).toEqual(['email', 'profile']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  coveringIntegration, normalizeSiteOrigin, siteCredentialLastUsedAt, siteCredentialStatus,
} from '@/AIP/connectors/siteCredentialModel';
import type { CredentialUse, SiteCredential } from '@/types/database';

// Site logins (secure-login PR1): the origin is the credential's
// identity, so normalization is a security rule, not a formatting
// nicety — the same fixtures pin the SQL twin
// (public.normalize_site_origin) by contract: what the client shows
// as the origin is what the server files the password under.

describe('normalizeSiteOrigin', () => {
  it('canonicalizes scheme, host case and default ports', () => {
    expect(normalizeSiteOrigin('https://linear.app')).toBe('https://linear.app');
    expect(normalizeSiteOrigin('linear.app')).toBe('https://linear.app');
    expect(normalizeSiteOrigin('HTTPS://EXAMPLE.COM:443/path?q=1')).toBe('https://example.com');
    expect(normalizeSiteOrigin('http://example.com:80')).toBe('http://example.com');
    expect(normalizeSiteOrigin('https://sub.example.co.jp')).toBe('https://sub.example.co.jp');
    expect(normalizeSiteOrigin('  https://example.com  ')).toBe('https://example.com');
  });

  it('keeps non-default ports and plain hosts', () => {
    expect(normalizeSiteOrigin('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
    expect(normalizeSiteOrigin('https://example.com:8443')).toBe('https://example.com:8443');
    expect(normalizeSiteOrigin('localhost:3000')).toBe('https://localhost:3000');
  });

  it('refuses anything that is not a site address', () => {
    expect(normalizeSiteOrigin('')).toBeNull();
    expect(normalizeSiteOrigin('   ')).toBeNull();
    expect(normalizeSiteOrigin('https://')).toBeNull();
    expect(normalizeSiteOrigin('https://user@example.com')).toBeNull();
    expect(normalizeSiteOrigin('ftp://example.com')).toBeNull();
    expect(normalizeSiteOrigin('https://example.com:99999')).toBeNull();
    expect(normalizeSiteOrigin('https://example.com:abc')).toBeNull();
    expect(normalizeSiteOrigin('https://example.com:80:90')).toBeNull();
    expect(normalizeSiteOrigin('https://exa mple.com')).toBeNull();
  });
});

describe('coveringIntegration (D5)', () => {
  const integrations = [
    { name: 'GitHub API', endpoint: 'https://api.github.com' },
    { name: 'Copilot MCP', endpoint: 'https://api.githubcopilot.com/mcp/' },
    { name: 'Schemeless', endpoint: 'api.example.com' },
  ];

  it('matches on host, case-insensitively, ignoring the endpoint path', () => {
    expect(coveringIntegration(integrations, 'https://api.github.com')?.name).toBe('GitHub API');
    expect(coveringIntegration(integrations, 'https://api.githubcopilot.com')?.name).toBe('Copilot MCP');
  });

  it('a different host is a different place, even for the same service', () => {
    expect(coveringIntegration(integrations, 'https://github.com')).toBeNull();
    expect(coveringIntegration(integrations, 'https://example.com')).toBeNull();
  });

  it('an endpoint without a scheme covers nothing', () => {
    expect(coveringIntegration(integrations, 'https://api.example.com')).toBeNull();
  });

  it('ports do not change the host a connection covers', () => {
    expect(coveringIntegration(integrations, 'https://api.github.com:8443')?.name).toBe('GitHub API');
  });
});

describe('siteCredentialStatus', () => {
  const base = { secret_id: null, last_test: null } as Pick<SiteCredential, 'secret_id' | 'last_test'>;

  it('one word per state', () => {
    expect(siteCredentialStatus(base)).toBe('empty');
    expect(siteCredentialStatus({ ...base, secret_id: 's1' })).toBe('saved');
    expect(siteCredentialStatus({ ...base, secret_id: 's1', last_test: { ok: true, code: 'connected' } })).toBe('saved');
  });

  it('a refused sign-in outranks the stored state', () => {
    expect(siteCredentialStatus({ ...base, secret_id: 's1', last_test: { ok: false, code: 'auth_failed' } })).toBe('action-needed');
    expect(siteCredentialStatus({ ...base, secret_id: 's1', last_test: { ok: false, code: 'unreachable' } })).toBe('saved');
  });
});

describe('siteCredentialLastUsedAt', () => {
  const use = (over: Partial<CredentialUse>): CredentialUse => ({
    id: 'u', activity_space_id: 'sp', credential_kind: 'site', integration_id: null,
    site_credential_id: 'sc1', event: 'used', run_id: 'r', actor_id: null, origin: 'https://example.com',
    detail: null, created_at: '2026-11-01T00:00:00Z', ...over,
  });

  it('projects the latest used event for this credential only', () => {
    const uses = [
      use({ created_at: '2026-11-02T00:00:00Z' }),
      use({ created_at: '2026-11-05T00:00:00Z' }),
      use({ event: 'stored', created_at: '2026-11-09T00:00:00Z' }),
      use({ site_credential_id: 'other', created_at: '2026-11-08T00:00:00Z' }),
    ];
    expect(siteCredentialLastUsedAt(uses, 'sc1')).toBe('2026-11-05T00:00:00Z');
    expect(siteCredentialLastUsedAt(uses, 'missing')).toBeNull();
    expect(siteCredentialLastUsedAt([], 'sc1')).toBeNull();
  });
});

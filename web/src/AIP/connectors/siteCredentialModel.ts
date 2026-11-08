import type { CredentialUse, SiteCredential } from '@/types/database';
import { readLastTest } from './catalog';

// Site logins (secure-login PR1): the pure half of the site-credential
// surface — origin identity, the covered-host rule (D5) and the row's
// one status word. The server enforces all of it again in
// set_site_credential_by_origin; this mirror exists so the Settings
// dialog can name a blocker before the round trip, never instead of it.

/** The canonical origin: scheme://host[:port], host lowercased,
 *  default port dropped, path refused. A missing scheme reads as
 *  https (a form convenience — what is stored is always canonical).
 *  Mirrors public.normalize_site_origin exactly, fixtures shared by
 *  the migration test. Returns null for anything that is not a site
 *  address (userinfo, non-http schemes, IPv6 literals, bad ports). */
export function normalizeSiteOrigin(input: string): string | null {
  let v = (input ?? '').trim().toLowerCase();
  if (!v) return null;
  if (!v.includes('://')) v = `https://${v}`;
  const scheme = v.split('://', 1)[0];
  if (scheme !== 'http' && scheme !== 'https') return null;
  let authority = v.slice(scheme.length + 3);
  authority = authority.split('/', 1)[0].split('?', 1)[0].split('#', 1)[0];
  if (authority.includes('@')) return null;
  if ((authority.match(/:/g) ?? []).length > 1) return null;
  let host = authority;
  let port: string | null = null;
  if (authority.includes(':')) {
    const [h, p] = authority.split(':');
    host = h;
    if (!/^[0-9]+$/.test(p) || Number(p) > 65535) return null;
    if (!((scheme === 'https' && p === '443') || (scheme === 'http' && p === '80'))) port = p;
  }
  if (!host || /[^a-z0-9.\-]/.test(host) || !/[a-z0-9]/.test(host)) return null;
  return `${scheme}://${host}${port ? `:${port}` : ''}`;
}

/** The host of a canonical origin (what the D5 rule compares). */
function siteOriginHost(origin: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/.exec(origin ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** The host an integration endpoint points at, the way the RPC reads
 *  it; an endpoint without a scheme has no host and covers nothing. */
function endpointHost(endpoint: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/i.exec((endpoint ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** D5: a connection in the Space whose endpoint already covers this
 *  origin's host is the route to it — a stored password there would
 *  be a second route to the same capability. Returns the covering
 *  connection (for the warning's name), or null. */
export function coveringIntegration<T extends { endpoint: string }>(
  integrations: readonly T[],
  origin: string,
): T | null {
  const host = siteOriginHost(origin);
  if (!host) return null;
  return integrations.find((i) => endpointHost(i.endpoint) === host) ?? null;
}

export type SiteCredentialStatus = 'action-needed' | 'saved' | 'empty';

export const SITE_CREDENTIAL_STATUS_LABELS: Record<SiteCredentialStatus, string> = {
  'action-needed': 'Action needed',
  saved: 'Saved',
  empty: 'No password saved',
};

/** The row's one status word. A refused sign-in (last_test
 *  auth_failed, written by the runner path from PR3) outranks the
 *  stored state, exactly as a connection's status does. */
export function siteCredentialStatus(cred: Pick<SiteCredential, 'secret_id' | 'last_test'>): SiteCredentialStatus {
  const last = readLastTest(cred.last_test);
  if (last && !last.ok && last.code === 'auth_failed') return 'action-needed';
  return cred.secret_id ? 'saved' : 'empty';
}

/** When this credential was last spent by a run, projected from the
 *  audit trail (credential_uses 'used' events — written from PR3 on;
 *  lifecycle events never count as a use). */
export function siteCredentialLastUsedAt(
  uses: readonly Pick<CredentialUse, 'site_credential_id' | 'event' | 'created_at'>[],
  siteCredentialId: string,
): string | null {
  let latest: string | null = null;
  for (const u of uses) {
    if (u.site_credential_id !== siteCredentialId || u.event !== 'used') continue;
    if (!latest || u.created_at > latest) latest = u.created_at;
  }
  return latest;
}

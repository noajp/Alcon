// Apps connected to Alcon over OAuth (ELE_PLT-004, ADR 0034): pure helpers
// shared by the consent screen and Settings › API & access.

export type OAuthAccess = 'read' | 'read_write';

export interface OAuthGrantLike {
  client: { id: string; name: string; uri: string; logo_uri: string };
  scopes: string[];
  granted_at: string;
}

export interface ConnectedApp {
  clientId: string;
  name: string;
  /** The client's own website, as it registered itself; shown, never followed by Alcon. */
  uri: string;
  grantedAt: string;
  access: OAuthAccess;
}

/**
 * Pure. Supabase's grants joined with what the person allowed each client.
 * A client with no access row is read-only, as alcon-mcp treats it. Newest first.
 */
export function mergeConnectedApps(
  grants: readonly OAuthGrantLike[],
  accessRows: readonly { client_id: string; access: string }[],
): ConnectedApp[] {
  const byClient = new Map(accessRows.map((r) => [r.client_id, r.access]));
  return grants
    .map((g) => ({
      clientId: g.client.id,
      name: g.client.name?.trim() || 'OAuth client',
      uri: g.client.uri ?? '',
      grantedAt: g.granted_at,
      access: (byClient.get(g.client.id) === 'read_write' ? 'read_write' : 'read') as OAuthAccess,
    }))
    .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}

const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

/**
 * Pure. Where to send the browser after a consent decision: an absolute URL —
 * https, http (a local client), or a desktop app's own scheme (cursor://…),
 * which Supabase has already matched against the client's registered
 * redirect URIs. Script-bearing and local-file schemes, and anything
 * relative, are refused.
 */
export function safeRedirectUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const url = new URL(raw);
    return UNSAFE_SCHEMES.has(url.protocol) ? null : url.toString();
  } catch {
    return null;
  }
}

/** Pure. The host a client returns to, for the consent screen; the full URI for an app scheme (cursor://…). */
export function redirectHost(raw: string): string {
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host ? url.host : raw;
  } catch {
    return raw;
  }
}

/** Pure. The authorization id from the consent page's query string. */
export function authorizationIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('authorization_id')?.trim();
  return id ? id : null;
}

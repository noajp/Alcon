// Google OAuth for integrations (ADR 0035) — the pure parts: the authorize
// URL, PKCE, the stored secret's shape, when to refresh, the nonce cookie and
// the return URL. No network, no Deno globals, so web/tests imports it.
//
// The stored Vault value of an OAuth integration is JSON:
//   { v: 1, provider: "google", access_token, refresh_token, expires_at, scope }
// expires_at is epoch milliseconds.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** The endpoint a google-drive integration row carries (catalog.ts). */
export const GOOGLE_DRIVE_ENDPOINT = "https://www.googleapis.com/drive/v3";
/** The endpoint a gmail integration row carries (catalog.ts). */
export const GOOGLE_GMAIL_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me";

export const NONCE_COOKIE = "ioauth";
export const COOKIE_PATH = "/functions/v1/integration-oauth";
export const TICKET_TTL_MS = 2 * 60_000;
export const STATE_TTL_MS = 10 * 60_000;
export const REFRESH_SKEW_MS = 120_000;

export interface OAuthSecret {
  v: 1;
  provider: "google";
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds. */
  expires_at: number;
  scope: string;
}

type IntegrationRowLike = { preset?: string | null; kind?: string | null; auth_type?: string | null; endpoint?: string | null } | null | undefined;

/** An account email read from a provider's answer, or null: not a string,
 *  or longer than an email can be. */
function accountEmail(value: unknown): string | null {
  return typeof value === "string" && value.length <= 320 ? value : null;
}

/**
 * What differs between the services a person signs in to with Google: the
 * rows that belong to it, the scopes a sign-in asks for and must come back
 * with, and how the signed-in account is read back. The flow around it —
 * PKCE, the token exchange, refresh, the Vault shape — is one for every
 * profile (this module); a new Google service is a new row here, not new
 * flow code.
 */
export interface GoogleProviderProfile {
  /** The integrations preset this profile serves. */
  preset: string;
  /** The endpoint a row of this preset carries. */
  endpoint: string;
  /** The scopes a sign-in requests, and the stored grant must cover. */
  scopes: readonly string[];
  /**
   * Ask with include_granted_scopes, so consenting to a wider set later
   * keeps what was granted before. Gmail's scopes arrive in stages (read
   * first, send on a second consent); Drive asks once, for exactly its
   * one scope, and leaves the parameter off as it always has.
   */
  includeGrantedScopes: boolean;
  /** The request that answers who signed in. */
  accountCheck: {
    url: string;
    /** The account's email in that answer's JSON, or null when absent. */
    emailOf(body: unknown): string | null;
  };
}

export const GOOGLE_DRIVE_PROFILE: GoogleProviderProfile = {
  preset: "google-drive",
  endpoint: GOOGLE_DRIVE_ENDPOINT,
  scopes: [DRIVE_FILE_SCOPE],
  includeGrantedScopes: false,
  accountCheck: {
    url: GOOGLE_ABOUT_URL,
    emailOf: (body) => accountEmail((body as { user?: { emailAddress?: unknown } } | null)?.user?.emailAddress),
  },
};

export const GOOGLE_GMAIL_PROFILE: GoogleProviderProfile = {
  preset: "gmail",
  endpoint: GOOGLE_GMAIL_ENDPOINT,
  // The staged consent (design D1): stage one asked for read-only;
  // stage two (P2) adds gmail.send beside it. includeGrantedScopes
  // keeps the earlier grant when a person consents again, and a
  // stored grant from stage one no longer covers this set —
  // grantsRequiredScopes says so, and the connection test turns that
  // into the connection's reauth state (oauth_scope_missing), never
  // a silent widening: the send scope exists only where a person
  // granted it.
  scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
  includeGrantedScopes: true,
  accountCheck: {
    url: `${GOOGLE_GMAIL_ENDPOINT}/profile`,
    emailOf: (body) => accountEmail((body as { emailAddress?: unknown } | null)?.emailAddress),
  },
};

export const GOOGLE_PROFILES: readonly GoogleProviderProfile[] = [GOOGLE_DRIVE_PROFILE, GOOGLE_GMAIL_PROFILE];

/** The Google profile an integration row belongs to, or null: not a row
 *  that signs in with Google (preset, kind, auth and endpoint all agree). */
export function googleProfileOf(row: IntegrationRowLike): GoogleProviderProfile | null {
  if (!row || row.kind !== "http" || row.auth_type !== "oauth") return null;
  return GOOGLE_PROFILES.find((p) => p.preset === row.preset && p.endpoint === row.endpoint) ?? null;
}

/** The integration rows that sign in with Google, under any profile. */
export function isGoogleOAuthRow(row: IntegrationRowLike): boolean {
  return googleProfileOf(row) !== null;
}

/** The integration rows the Drive tools accept: the Drive profile only —
 *  a Gmail row never opens Drive's typed tools. */
export function isGoogleDriveRow(row: IntegrationRowLike): boolean {
  return googleProfileOf(row)?.preset === GOOGLE_DRIVE_PROFILE.preset;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A random base64url string from `bytes` random bytes (32 → 43 chars). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 7636 S256: base64url(sha256(ascii(verifier))). */
export async function s256Challenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(buf));
}

export function redirectUriFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/integration-oauth/callback`;
}

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; profile?: GoogleProviderProfile }): string {
  const profile = p.profile ?? GOOGLE_DRIVE_PROFILE;
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", profile.scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  // Only a profile that consents in stages asks to keep earlier grants;
  // Drive's URL is unchanged (the grant stays drive.file alone).
  if (profile.includeGrantedScopes) u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** True when the space-separated scope string grants `scope`. */
export function hasScope(granted: unknown, scope = DRIVE_FILE_SCOPE): boolean {
  return typeof granted === "string" && granted.split(/\s+/).includes(scope);
}

/** True when the granted scope string covers every scope the profile requires. */
export function grantsRequiredScopes(granted: unknown, profile: GoogleProviderProfile): boolean {
  return profile.scopes.every((scope) => hasScope(granted, scope));
}

/** The stored secret, or null when it is not a well-formed Google OAuth secret. */
export function parseOAuthSecret(raw: unknown): OAuthSecret | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.v !== 1 || o.provider !== "google") return null;
  if (typeof o.access_token !== "string" || !o.access_token) return null;
  if (typeof o.refresh_token !== "string" || !o.refresh_token) return null;
  if (typeof o.expires_at !== "number" || !Number.isFinite(o.expires_at)) return null;
  if (typeof o.scope !== "string") return null;
  return { v: 1, provider: "google", access_token: o.access_token, refresh_token: o.refresh_token, expires_at: o.expires_at, scope: o.scope };
}

/** True when the access token expires within `skewMs` of now (or already has). */
export function needsRefresh(secret: Pick<OAuthSecret, "expires_at">, nowMs: number, skewMs = REFRESH_SKEW_MS): boolean {
  return !(secret.expires_at - skewMs > nowMs);
}

/**
 * The secret to store after a token response. A refresh response carries no
 * refresh_token (Google keeps the old one) and may omit scope; both fall back
 * to `previous`. Null when the response has no usable token.
 */
export function secretFromTokenResponse(res: unknown, nowMs: number, previous?: OAuthSecret | null): OAuthSecret | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  const access = typeof r.access_token === "string" ? r.access_token : "";
  const refresh = typeof r.refresh_token === "string" && r.refresh_token ? r.refresh_token : previous?.refresh_token ?? "";
  const expiresIn = typeof r.expires_in === "number" && r.expires_in > 0 ? r.expires_in : 3600;
  const scope = typeof r.scope === "string" ? r.scope : previous?.scope ?? "";
  if (!access || !refresh) return null;
  return { v: 1, provider: "google", access_token: access, refresh_token: refresh, expires_at: nowMs + expiresIn * 1000, scope };
}

export function nonceCookie(nonce: string, maxAgeSec = Math.floor(STATE_TTL_MS / 1000)): string {
  return `${NONCE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${maxAgeSec}`;
}

export function clearNonceCookie(): string {
  return `${NONCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=0`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** The app origin from APP_ORIGIN: a bare https origin (http only for localhost), or null. */
export function appOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  return u.origin;
}

/**
 * Pure. Where a sign-in returns: the origin the app that started it runs on,
 * when that is the app (APP_ORIGIN), one listed in APP_RETURN_ORIGINS
 * (comma-separated), or this machine (localhost / 127.0.0.1, any port, for
 * development). Anything else returns to APP_ORIGIN. The handle it carries
 * is useless without the starter's own session (/finish checks it), so the
 * list only decides where the browser lands, never who may finish.
 */
export function returnOrigin(requested: unknown, appRaw: string | null | undefined, listRaw: string | null | undefined): string | null {
  const app = appOrigin(appRaw);
  const asked = typeof requested === "string" ? appOrigin(requested) : null;
  if (!asked) return app;
  if (asked === app) return asked;
  const host = new URL(asked).hostname;
  if (host === "localhost" || host === "127.0.0.1") return asked;
  const listed = (listRaw ?? "").split(",").map((s) => appOrigin(s.trim())).filter((o): o is string => !!o);
  return listed.includes(asked) ? asked : app;
}

/**
 * The URL to send the browser back to: the app's origin with the result.
 *   finish   Google answered; the app confirms with POST /finish {handle}
 *            under the signed-in person's JWT, and only then is anything
 *            stored.
 *   error    the sign-in did not complete.
 * Null when APP_ORIGIN is missing or is not a bare origin.
 */
export function appReturnUrl(
  rawOrigin: string | null | undefined,
  result: "finish" | "error",
  integrationId: string | null,
  handle?: string,
): string | null {
  const origin = appOrigin(rawOrigin);
  if (!origin) return null;
  const out = new URL("/", origin);
  out.searchParams.set("integration_oauth", result);
  if (integrationId && /^[0-9a-f-]{36}$/i.test(integrationId)) out.searchParams.set("integration", integrationId);
  if (result === "finish") {
    if (!handle || !/^[A-Za-z0-9_-]{43,128}$/.test(handle)) return null;
    out.searchParams.set("handle", handle);
  }
  return out.toString();
}

export const COMPLETION_TTL_MS = 10 * 60_000;

/** True when an ISO timestamp is missing, unreadable or not after now. */
export function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return !Number.isFinite(t) || t <= nowMs;
}

/**
 * Whether a completed Google sign-in may be stored for the caller of
 * /finish: only for the person who started it, before it expires. Ownership
 * of the Space is checked separately, against the database.
 */
export function finishDecision(p: { flowUserId: string | null | undefined; callerId: string | null | undefined; expiresAt: string | null | undefined; nowMs: number }):
  "ok" | "expired" | "wrong_user" {
  if (!p.callerId || !p.flowUserId || p.callerId !== p.flowUserId) return "wrong_user";
  if (isExpired(p.expiresAt, p.nowMs)) return "expired";
  return "ok";
}

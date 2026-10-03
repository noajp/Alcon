// Google OAuth for integrations (ADR 0034) — the pure parts: the authorize
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
/** The endpoint a google-drive integration row carries (catalog.ts). */
export const GOOGLE_DRIVE_ENDPOINT = "https://www.googleapis.com/drive/v3";

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

/** The integration rows the OAuth flow and the Drive tools accept. */
export function isGoogleDriveRow(row: { preset?: string | null; kind?: string; auth_type?: string; endpoint?: string } | null | undefined): boolean {
  return !!row && row.preset === "google-drive" && row.kind === "http" && row.auth_type === "oauth" && row.endpoint === GOOGLE_DRIVE_ENDPOINT;
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

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", DRIVE_FILE_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** True when the space-separated scope string grants `scope`. */
export function hasScope(granted: unknown, scope = DRIVE_FILE_SCOPE): boolean {
  return typeof granted === "string" && granted.split(/\s+/).includes(scope);
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

/**
 * The URL to send the browser back to: the fixed app origin with the result.
 * Null when APP_ORIGIN is missing or is not a bare https origin (http only
 * for localhost).
 */
export function appReturnUrl(appOrigin: string | null | undefined, ok: boolean, integrationId: string | null): string | null {
  if (!appOrigin) return null;
  let u: URL;
  try { u = new URL(appOrigin); } catch { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  const out = new URL("/", u.origin);
  out.searchParams.set("integration_oauth", ok ? "ok" : "error");
  if (integrationId && /^[0-9a-f-]{36}$/i.test(integrationId)) out.searchParams.set("integration", integrationId);
  return out.toString();
}

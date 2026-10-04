// Delegated auth (ADR 0032, 0034): an external caller that holds a personal
// access token or an OAuth grant is turned into a short-lived
// JWT for the person it stands for. The database never trusts the token
// itself; it sees an ordinary `authenticated` JWT whose `sub` is the person,
// so RLS — which reads only auth.uid() — draws the same boundary as in the
// app. The JWT lives five minutes, exists only inside the Edge Function for
// one request, and carries `alcon_via` so the database can tell a delegated
// call from a session (is_delegated_request()) and refuse token management.
//
// Everything here except mintUserJwt is pure and unit-tested in
// web/tests/personalAccessTokens.test.ts. jose is loaded lazily inside
// mintUserJwt so the pure part imports without Deno.

/** A personal access token starts with this, so the caller can tell it from a JWT without a lookup. */
export const PAT_PREFIX = "alc_pat_";
/** 32 random bytes in base64url without padding. */
const PAT_PATTERN = /^alc_pat_[A-Za-z0-9_-]{43}$/;
/** How long a minted user JWT is valid. Never longer: it is not revocable once minted. */
export const DELEGATED_JWT_TTL_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DelegatedVia = "pat" | "oauth";

export interface DelegatedSubject {
  userId: string;
  via: DelegatedVia;
  /** personal_access_tokens.id, for via 'pat'. */
  patId?: string;
  /** The OAuth client the grant was issued to, for via 'oauth'. */
  clientId?: string;
}

export interface UserClaims {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  iat: number;
  exp: number;
  alcon_via: DelegatedVia;
  pat_id?: string;
  client_id?: string;
}

/** Pure. True for a bearer value that claims to be an Alcon personal access token. */
export function isPersonalAccessToken(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

/** Pure. True when a PAT has the shape create_personal_access_token issues. */
export function isWellFormedPersonalAccessToken(token: string): boolean {
  return PAT_PATTERN.test(token);
}

/** Pure. The bearer value of an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  const token = (header ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return token ? token : null;
}

/** The role the access token hook gives tokens issued to OAuth clients (ADR 0034). */
export const OAUTH_CLIENT_ROLE = "alcon_oauth_client";

/** Pure. A JWT's payload, unverified; null for anything that is not a JWT. */
function unverifiedPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Pure. The OAuth client a bearer JWT was issued to (its `client_id` claim),
 * read from the unverified payload — only to pick the path that then verifies
 * it. Null for anything that is not a JWT carrying a UUID client_id.
 */
export function oauthClientIdOf(token: string): string | null {
  const clientId = unverifiedPayload(token)?.client_id;
  return typeof clientId === "string" && UUID.test(clientId) ? clientId : null;
}

/**
 * Pure. True when an OAuth access token carries the role the access token
 * hook gives (alcon_oauth_client). Checked after the token is verified: a
 * token without it means the hook is not enabled, and such a token would also
 * work directly against PostgREST with the person's full rights.
 */
export function hasOAuthClientRole(token: string): boolean {
  return unverifiedPayload(token)?.role === OAUTH_CLIENT_ROLE;
}

/** SHA-256 hex of a string — what personal_access_tokens.token_hash stores. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pure. The claims of a delegated user JWT. Always role and aud
 * `authenticated` — never service_role, whatever the caller asks — and at
 * most DELEGATED_JWT_TTL_SECONDS long.
 */
export function buildUserClaims(subject: DelegatedSubject, nowSeconds: number = Math.floor(Date.now() / 1000)): UserClaims {
  if (!UUID.test(subject.userId)) throw new Error("delegated subject must be a user id");
  if (!Number.isFinite(nowSeconds)) throw new Error("invalid clock");
  const iat = Math.floor(nowSeconds);
  const claims: UserClaims = {
    sub: subject.userId,
    role: "authenticated",
    aud: "authenticated",
    iat,
    exp: iat + DELEGATED_JWT_TTL_SECONDS,
    alcon_via: subject.via,
  };
  if (subject.via === "pat") {
    if (!subject.patId || !UUID.test(subject.patId)) throw new Error("a token-delegated JWT needs the token id");
    claims.pat_id = subject.patId;
  } else if (subject.via === "oauth") {
    if (!subject.clientId) throw new Error("an OAuth-delegated JWT needs the client id");
    claims.client_id = subject.clientId;
  } else {
    throw new Error("unknown delegation");
  }
  return claims;
}

export type SigningKey =
  | { alg: "HS256"; secret: string }
  | { alg: "ES256"; jwk: Record<string, unknown>; kid: string | undefined };

/**
 * Pure. ALCON_JWT_SIGNING_KEY → how to sign. Today it is the project's legacy
 * HS256 JWT secret. If it holds an EC private JWK instead, sign ES256 with its
 * kid, so moving the project to asymmetric signing keys is a config change.
 */
export function parseSigningKey(raw: string | undefined | null): SigningKey | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("{")) {
    try {
      const jwk = JSON.parse(value) as Record<string, unknown>;
      if (jwk && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.d === "string") {
        return { alg: "ES256", jwk, kid: typeof jwk.kid === "string" ? jwk.kid : undefined };
      }
    } catch { /* not JSON: a secret that happens to start with "{" */ }
  }
  return { alg: "HS256", secret: value };
}

/** Thrown when the function has no signing key: the caller answers 500 "server not configured". */
export class DelegatedAuthNotConfigured extends Error {
  constructor() {
    super("server not configured");
    this.name = "DelegatedAuthNotConfigured";
  }
}

/** A short-lived JWT for the person a delegated caller stands for. Fails closed without a key. */
export async function mintUserJwt(subject: DelegatedSubject, rawKey?: string | null): Promise<string> {
  const key = parseSigningKey(rawKey ?? (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("ALCON_JWT_SIGNING_KEY"));
  if (!key) throw new DelegatedAuthNotConfigured();
  const claims = buildUserClaims(subject);
  const jose = await import("npm:jose@5.9.6");
  const jwt = new jose.SignJWT({ ...claims } as unknown as Record<string, unknown>);
  if (key.alg === "ES256") {
    const privateKey = await jose.importJWK(key.jwk as unknown as Parameters<typeof jose.importJWK>[0], "ES256");
    return await jwt.setProtectedHeader({ alg: "ES256", typ: "JWT", ...(key.kid ? { kid: key.kid } : {}) }).sign(privateKey);
  }
  return await jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(new TextEncoder().encode(key.secret));
}

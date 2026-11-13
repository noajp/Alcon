// GitHub OAuth for the GitHub integration — the pure parts: which rows sign in
// with GitHub, the authorize URL, the stored secret's shape and the client
// from the environment. No network, no Deno globals, so web/tests imports it.
// The sign-in itself runs in integration-oauth, the same flow as Google
// (ticket → PKCE + state + nonce cookie → held token → /finish).
//
// The stored Vault value of a GitHub OAuth integration is JSON:
//   { v: 1, provider: "github", access_token, scope }
// An OAuth App's token does not expire; it ends when the grant is revoked
// (Disconnect, or the person removing Clayware under GitHub › Settings ›
// Applications).

export const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_USER_URL = "https://api.github.com/user";
/** The endpoint a github integration row carries (catalog.ts). */
export const GITHUB_MCP_ENDPOINT = "https://api.githubcopilot.com/mcp/";
/** Read and write the repositories the person can reach: pull requests,
 *  reviews, comments, merges, and the branches an agent pushes. */
export const GITHUB_SCOPE = "repo";

export interface GithubOAuthSecret {
  v: 1;
  provider: "github";
  access_token: string;
  scope: string;
}

export interface GithubClientConfig { clientId: string; clientSecret: string }

/** The integration rows that sign in with GitHub. */
export function isGithubOAuthRow(row: { preset?: string | null; kind?: string | null; auth_type?: string | null; endpoint?: string | null } | null | undefined): boolean {
  return !!row && row.preset === "github" && row.kind === "mcp" && row.auth_type === "oauth" && row.endpoint === GITHUB_MCP_ENDPOINT;
}

export function githubClientFromEnv(get: (key: string) => string | undefined): GithubClientConfig | null {
  const clientId = get("GITHUB_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = get("GITHUB_OAUTH_CLIENT_SECRET")?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function buildGithubAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const u = new URL(GITHUB_AUTH_URL);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", GITHUB_SCOPE);
  u.searchParams.set("state", p.state);
  u.searchParams.set("allow_signup", "false");
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** True when GitHub's comma- or space-separated scope list grants `scope`. */
export function githubHasScope(granted: unknown, scope = GITHUB_SCOPE): boolean {
  return typeof granted === "string" && granted.split(/[\s,]+/).includes(scope);
}

/** The secret to store after GitHub's token response, or null when it has no token. */
export function githubSecretFromTokenResponse(res: unknown): GithubOAuthSecret | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  const access = typeof r.access_token === "string" ? r.access_token : "";
  if (!access || r.error) return null;
  return { v: 1, provider: "github", access_token: access, scope: typeof r.scope === "string" ? r.scope : "" };
}

/** The stored secret, or null when it is not a well-formed GitHub OAuth secret. */
export function parseGithubSecret(raw: unknown): GithubOAuthSecret | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.v !== 1 || o.provider !== "github") return null;
  if (typeof o.access_token !== "string" || !o.access_token) return null;
  return { v: 1, provider: "github", access_token: o.access_token, scope: typeof o.scope === "string" ? o.scope : "" };
}

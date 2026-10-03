// How an MCP client finds out where to sign in (ELE_PLT-004, ADR 0034).
//
// alcon-mcp is an OAuth protected resource; Supabase Auth's OAuth 2.1 server
// is its authorization server. A client that calls without a token gets a 401
// whose WWW-Authenticate names the resource metadata (RFC 9728); the metadata
// names the authorization server, whose own metadata Supabase serves at
// /.well-known/oauth-authorization-server/auth/v1 (registration, PKCE, token).
// The gateway cannot serve a host-root /.well-known path for a function, so
// the metadata lives under the function and the 401 points at it.
// Pure: index.ts supplies SUPABASE_URL.

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

function base(supabaseUrl: string): string {
  return supabaseUrl.replace(/\/+$/, "");
}

/** Pure. The MCP endpoint, as clients address it. */
export function resourceUrl(supabaseUrl: string): string {
  return `${base(supabaseUrl)}/functions/v1/alcon-mcp`;
}

/** Pure. Where the protected resource metadata is served. */
export function resourceMetadataUrl(supabaseUrl: string): string {
  return `${resourceUrl(supabaseUrl)}${PROTECTED_RESOURCE_PATH}`;
}

/** Pure. RFC 9728 metadata for alcon-mcp. */
export function protectedResourceMetadata(supabaseUrl: string): Record<string, unknown> {
  return {
    resource: resourceUrl(supabaseUrl),
    authorization_servers: [`${base(supabaseUrl)}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "Alcon",
    resource_documentation: "https://github.com/noajp/Alcon/blob/main/docs/mcp.md",
  };
}

/** Pure. True when the function's path asks for the protected resource metadata. */
export function isProtectedResourcePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "").endsWith(`/alcon-mcp${PROTECTED_RESOURCE_PATH}`);
}

function quoted(value: string): string {
  return value.replace(/[\\"]/g, "").replace(/[\r\n]/g, " ");
}

/**
 * Pure. The WWW-Authenticate value of a 401. Without a token it carries no
 * error (RFC 6750 §3.1); with a bad one, invalid_token and why.
 */
export function wwwAuthenticate(supabaseUrl: string, detail: string | null): string {
  const parts = [`realm="alcon"`, `resource_metadata="${quoted(resourceMetadataUrl(supabaseUrl))}"`];
  if (detail) parts.push(`error="invalid_token"`, `error_description="${quoted(detail)}"`);
  return `Bearer ${parts.join(", ")}`;
}

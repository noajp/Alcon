// clayware-mcp — Clayware as an MCP server.
//
// External AI clients (Claude Code, Claude, ChatGPT, …) connect over MCP
// Streamable HTTP and read / write the board as the person who connected
// them. Every call runs with that person's Supabase JWT, so RLS decides what
// the AI can see and change — the same boundary the app draws. The service
// role only resolves a personal access token's hash and sends the caller
// their own report notification (callerNotify.ts), never board data. Writes are recorded on the Element's Activity
// under the client's name (see protocol.ts clientLabel).
//
// Transport: stateless. POST one JSON-RPC message → JSON response; a
// notification → 202. GET (server-initiated stream) and DELETE (session end)
// answer 405 because there is no session; the one GET served is the OAuth
// protected resource metadata (oauth.ts).
//
// Auth (ADR 0032, 0034): Authorization: Bearer <personal access token>
// (alc_pat_…), <OAuth access token> (claude.ai, ChatGPT) or <Supabase session
// JWT>. A token or OAuth grant is exchanged for a five-minute JWT for its
// owner (_shared/callerAuth.ts), so RLS applies either way; read-only access
// is offered the read tools alone. verify_jwt=false on this function so a
// missing / expired / revoked token gets an MCP-shaped 401 whose
// WWW-Authenticate points at the resource metadata instead of the gateway's;
// the token is verified here before any tool runs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticateCaller, MISSING_TOKEN } from "../_shared/callerAuth.ts";
import { callerNotifier } from "../_shared/callerNotify.ts";
import { isProtectedResourcePath, protectedResourceMetadata, wwwAuthenticate } from "./oauth.ts";
import { acceptsProtocolHeader, clientLabel, clientName, handleBody } from "./protocol.ts";
import { mcpHost } from "./tools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "www-authenticate",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", ...extra },
  });
}

function supabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

function unauthorized(detail: string): Response {
  return json(401, { error: "unauthorized", error_description: detail }, {
    "www-authenticate": wwwAuthenticate(supabaseUrl(), detail === MISSING_TOKEN ? null : detail),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === "GET" && isProtectedResourcePath(url.pathname)) {
    return json(200, protectedResourceMetadata(supabaseUrl()), { "cache-control": "public, max-age=3600" });
  }
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...corsHeaders, allow: "POST, OPTIONS" } });
  }

  if (!acceptsProtocolHeader(req.headers.get("mcp-protocol-version"))) {
    return json(400, { error: "unsupported MCP-Protocol-Version" });
  }

  const userAgent = req.headers.get("user-agent");
  const auth = await authenticateCaller(req, { client: clientName(url, userAgent) });
  if (!auth.ok) return auth.status === 401 ? unauthorized(auth.detail) : json(auth.status, { error: auth.error });
  const { caller } = auth;

  const actor = {
    agent: clientLabel(
      url,
      userAgent,
      caller.via === "pat" ? { token: caller.label } : caller.via === "oauth" ? { oauthClient: caller.label } : null,
    ),
    userId: caller.userId,
  };
  const { status, body } = await handleBody(await req.text(), mcpHost(caller.db, actor, caller.access, callerNotifier(caller.userId)));
  return body === undefined ? new Response(null, { status, headers: corsHeaders }) : json(status, body);
});

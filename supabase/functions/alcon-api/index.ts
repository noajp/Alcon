// alcon-api — the board over plain HTTP, for scripts, no-code tools and
// other services (ELE_PLT-006).
//
// Each route runs one tool from the outside-caller allowlist that MCP also
// offers (_shared/externalTools.ts, routes.ts), with the caller's own JWT,
// so RLS decides what it sees and changes — the same boundary as the app and
// MCP. Writes are recorded on the Element's Activity as "API · token: <name>"
// (with the X-Alcon-Client name in front when the caller sends one).
//
// Auth (ADR 0032, 0034): Authorization: Bearer <personal access token>, an
// OAuth access token or a Supabase session JWT, resolved by
// _shared/callerAuth.ts. verify_jwt=false
// so a bad token gets this API's JSON 401 rather than the gateway's; the
// token is verified here before any tool runs. GET / and GET /openapi.json
// answer without a token: they describe the API, not the board.
//
// Errors: { "error": { "code", "message" } } with 400 (malformed body),
// 401, 403 (read-only token, or RLS refused a write), 404 (no such route, or
// nothing the caller can see), 405, 422 (invalid or rejected), 500.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticateCaller } from "../_shared/callerAuth.ts";
import { runExternalTool } from "../_shared/externalTools.ts";
import { apiActorLabel, apiPath, openApiDocument, planRequest, ROUTES, toResponse, type ApiError } from "./routes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-alcon-client",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
  "Access-Control-Expose-Headers": "www-authenticate",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", ...extra },
  });
}

function fail(e: ApiError): Response {
  return json(e.status, { error: { code: e.code, message: e.message } }, e.allow ? { allow: e.allow } : {});
}

function serverUrl(): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/alcon-api`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const path = apiPath(url.pathname);

  if (req.method === "GET" && path === "/openapi.json") return json(200, openApiDocument(serverUrl()));
  if (req.method === "GET" && path === "/") {
    return json(200, {
      name: "Alcon API",
      openapi: `${serverUrl()}/openapi.json`,
      routes: ROUTES.map((r) => `${r.method} ${r.path}`),
    });
  }

  const client = req.headers.get("x-alcon-client");
  const auth = await authenticateCaller(req, { client: client?.trim() || "API" });
  if (!auth.ok) {
    if (auth.status === 401) {
      return json(401, { error: { code: "unauthorized", message: auth.detail } }, {
        "www-authenticate": `Bearer realm="alcon", error="invalid_token", error_description="${auth.detail}"`,
      });
    }
    return json(auth.status, { error: { code: "server_error", message: auth.error } });
  }
  const { caller } = auth;

  const plan = planRequest({
    method: req.method,
    path,
    query: url.searchParams,
    body: req.method === "GET" ? "" : await req.text(),
    access: caller.access,
  });
  if (!plan.ok) return fail(plan.error);

  const actor = {
    agent: apiActorLabel(client, caller.via === "pat" ? caller.label : null, caller.via === "oauth" ? caller.label : null),
    userId: caller.userId,
  };
  const result = await runExternalTool(caller.db, plan.call.tool, plan.call.args, actor, caller.access);
  const { status, body } = toResponse(result, plan.call.successStatus);
  return json(status, body);
});

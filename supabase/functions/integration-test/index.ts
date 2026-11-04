// integration-test — checks that a Space's external service answers with the
// stored credential (ADR 0027). Settings › Customize calls it from the
// 「接続テスト」 button.
//
// Request (POST JSON, Authorization: Bearer <the person's Supabase JWT>):
//   { integrationId }
// Response:
//   { last_test: { ok, at, code, detail, tools?, tool_count?, status? } }
//     mcp   initialize + tools/list → connected for a preset, reachable for
//           a custom server; tool_count and up to 20 tools ({ name, readOnly }).
//           The integration's manifest is rebuilt from every listed tool
//           (manifestFromTools), keeping the permissions people set.
//     http  a preset with a credential check (VERIFY) → connected or
//           auth_failed. Any other API: GET on the base URL; a response
//           below 500 other than 401 / 403 is only "reachable".
//     oauth Google Drive: the stored token (refreshed when due, through
//           resolveCredential) reads the signed-in user from Drive's about
//           endpoint → connected. No token → oauth_required; a refresh token
//           Google refuses → oauth_expired.
//           GitHub: the signed-in token opens the MCP server as above.
//     model a one-token Messages request (Anthropic format) with the key →
//           connected on success, auth_failed on 401 / 403. Any other answer
//           under 500 (an unknown model name, say) is only "reachable": the
//           key is not refused, but the request was not served.
//
// Who may test: a Space owner. The integration must be visible to the caller
// (RLS: Space member) and the caller must hold the owner role in that Space —
// both checked with the caller's JWT. Only then does the service role read the
// secret from Vault (get_integration_secret) and write last_test back. The
// secret goes only into the outgoing request's header; it is never returned,
// logged, or put in last_test.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { McpSession, callHttp, isSafeEndpoint, readCapped, resolveCredential, type IntegrationRow } from "../_shared/integrationClient.ts";
import { GOOGLE_ABOUT_URL, isGoogleDriveRow } from "../_shared/googleOAuth.ts";
import { isGithubOAuthRow } from "../_shared/githubOAuth.ts";
import { manifestFromTools } from "../_shared/connectorManifest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_LISTED_TOOLS = 20;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

interface LastTest {
  ok: boolean;
  at: string;
  /** What happened, for the client to word in the viewer's language. */
  code: "connected" | "reachable" | "auth_failed" | "http_error" | "unreachable" | "blocked" | "oauth_required" | "oauth_expired" | "error";
  /** A technical note for errors (already scrubbed of the secret); empty otherwise. */
  detail: string;
  tools?: { name: string; readOnly: boolean }[];
  /** Every tool the server listed, for the manifest; never saved in last_test. */
  all?: { name: string; description: string; readOnly: boolean }[];
  tool_count?: number;
  status?: number;
}

/** Strips anything that looks like the secret from an error before it is stored. */
function scrub(message: string, secret: string | null): string {
  const text = message.slice(0, 300);
  return secret && secret.length >= 4 ? text.split(secret).join("•••") : text;
}

/**
 * How a preset's credential is checked: a request that only succeeds with a
 * valid credential. Without one (a custom API) the test can only say the
 * service answered — "reachable", never "connected".
 */
const VERIFY: Record<string, { path: string; okWhen: (status: number, body: string) => boolean }> = {
  asana: { path: "users/me", okWhen: (status) => status >= 200 && status < 300 },
  // Slack answers 200 even for a bad token; the body's "ok" says which.
  slack: { path: "auth.test", okWhen: (status, body) => status === 200 && /"ok"\s*:\s*true/.test(body) },
};

/** A model provider: one token from its Messages API. The key goes in both
 *  headers providers use for it (x-api-key, Authorization). */
async function runModelTest(row: IntegrationRow, secret: string | null, at: string): Promise<LastTest> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  const res = await fetch(`${row.endpoint.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "anthropic-version": "2023-06-01",
      ...(secret ? { "x-api-key": secret, Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    signal: ctl.signal, redirect: "manual",
  }).finally(() => clearTimeout(timer));
  const body = await readCapped(res, 100_000);
  const status = res.status;
  if (status === 401 || status === 403) return { ok: false, at, code: "auth_failed", status, detail: "" };
  if (status >= 200 && status < 300) return { ok: true, at, code: "connected", status, detail: "" };
  const reason = scrub(body.match(/"message"\s*:\s*"([^"]{1,120})"/)?.[1] ?? "", secret);
  if (status >= 500 || status < 200 || (status >= 300 && status < 400)) return { ok: false, at, code: "http_error", status, detail: reason };
  return { ok: true, at, code: "reachable", status, detail: reason };
}

async function runTest(row: IntegrationRow & { preset: string | null }, secret: string | null): Promise<LastTest> {
  const at = new Date().toISOString();
  if (!isSafeEndpoint(row.endpoint)) return { ok: false, at, code: "blocked", detail: "" };
  try {
    if (row.kind === "model") return await runModelTest(row, secret, at);
    if (row.kind === "mcp") {
      const session = new McpSession(row, secret);
      await session.initialize();
      const tools = await session.listTools();
      // A preset's server refuses tools/list without a valid credential; a
      // custom server may answer anyone, so it is only "reachable".
      return {
        ok: true, at, code: row.preset ? "connected" : "reachable", detail: "",
        tool_count: tools.length,
        tools: tools.slice(0, MAX_LISTED_TOOLS).map((t) => ({ name: t.name, readOnly: t.readOnly })),
        all: tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly })),
      };
    }
    const verify = row.preset ? VERIFY[row.preset] : undefined;
    const res = await callHttp(row, secret, { method: "GET", path: verify?.path ?? "" });
    const status = Number(res.text.match(/^HTTP (\d{3})/)?.[1] ?? 0);
    const body = res.text.replace(/^HTTP \d{3}\n/, "");
    if (status === 401 || status === 403) return { ok: false, at, code: "auth_failed", status, detail: "" };
    if (verify) {
      if (verify.okWhen(status, body)) return { ok: true, at, code: "connected", status, detail: "" };
      const reason = body.match(/"error"\s*:\s*"([^"]{1,60})"/)?.[1] ?? "";
      return { ok: false, at, code: status >= 500 || !status ? "http_error" : "auth_failed", status, detail: scrub(reason, secret) };
    }
    if (!status || status >= 500) return { ok: false, at, code: "http_error", status, detail: "" };
    return { ok: true, at, code: "reachable", status, detail: "" };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "AbortError";
    const message = e instanceof Error ? e.message : String(e);
    if (/認証に失敗/.test(message)) return { ok: false, at, code: "auth_failed", detail: "" };
    return { ok: false, at, code: timeout ? "unreachable" : "error", detail: timeout ? "" : scrub(message, secret) };
  }
}

/** A signed-in connection. GitHub: the token opens its MCP server. Google
 *  Drive: who the stored token belongs to, asked of Drive itself. */
async function runOAuthTest(admin: SupabaseClient, row: IntegrationRow & { preset: string | null }, raw: string | null): Promise<LastTest> {
  const at = new Date().toISOString();
  if (isGithubOAuthRow(row)) {
    const token = raw ? await resolveCredential(admin, row, raw) : null;
    return token ? await runTest(row, token) : { ok: false, at, code: "oauth_required", detail: "" };
  }
  if (!isGoogleDriveRow(row) || !raw) return { ok: false, at, code: "oauth_required", detail: "" };
  let token: string | null;
  try {
    token = await resolveCredential(admin, row, raw);
  } catch (e) {
    return { ok: false, at, code: "error", detail: scrub(e instanceof Error ? e.message : String(e), null) };
  }
  if (!token) {
    // resolveCredential records a refresh token Google refused as oauth_expired.
    const { data } = await admin.from("integrations").select("last_test").eq("id", row.id).maybeSingle();
    const expired = (data?.last_test as { code?: string } | null)?.code === "oauth_expired";
    return { ok: false, at, code: expired ? "oauth_expired" : "oauth_required", detail: "" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const res = await fetch(GOOGLE_ABOUT_URL, { headers: { Authorization: `Bearer ${token}`, accept: "application/json" }, signal: ctl.signal, redirect: "manual" })
      .finally(() => clearTimeout(timer));
    await readCapped(res, 100_000);
    if (res.status === 401 || res.status === 403) return { ok: false, at, code: "auth_failed", status: res.status, detail: "" };
    if (!res.ok) return { ok: false, at, code: "http_error", status: res.status, detail: "" };
    return { ok: true, at, code: "connected", status: res.status, detail: "" };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "AbortError";
    return { ok: false, at, code: timeout ? "unreachable" : "error", detail: timeout ? "" : scrub(e instanceof Error ? e.message : String(e), token) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: { integrationId?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
  if (!integrationId) return json({ error: "integrationId is required" }, 400);

  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "session expired or invalid" }, 401);

  // Visible to the caller (RLS: Space member)…
  const { data: visible, error: readErr } = await userDb
    .from("integrations")
    .select("id, activity_space_id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation")
    .eq("id", integrationId)
    .maybeSingle();
  if (readErr) return json({ error: "could not read the integration" }, 500);
  if (!visible) return json({ error: "integration not found" }, 404);

  // …and the caller owns that Space.
  const { data: membership } = await userDb
    .from("activity_space_members")
    .select("role")
    .eq("activity_space_id", visible.activity_space_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner") return json({ error: "only Space owners can test connections", code: "not_owner" }, 403);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: secretData, error: secretErr } = await admin.rpc("get_integration_secret", { p_integration_id: integrationId });
  if (secretErr) return json({ error: "could not read the credential" }, 500);
  const secret = typeof secretData === "string" && secretData.length > 0 ? secretData : null;

  const row = visible as IntegrationRow & { activity_space_id: string; preset: string | null };
  const { all, ...lastTest } = row.auth_type === "oauth" ? await runOAuthTest(admin, row, secret) : await runTest(row, secret);

  // A server that listed its tools gets its manifest from them: one command
  // per tool, keeping the permissions people set (manifestFromTools).
  const patch: Record<string, unknown> = { last_test: lastTest };
  if (all && lastTest.ok && row.kind === "mcp") {
    const { data: cur } = await admin.from("integrations").select("manifest").eq("id", integrationId).maybeSingle();
    patch.manifest = manifestFromTools(all, cur?.manifest ?? null);
  }
  const { error: writeErr } = await admin.from("integrations").update(patch).eq("id", integrationId);
  if (writeErr) return json({ error: "could not save the result", last_test: lastTest }, 500);

  return json({ last_test: lastTest });
});

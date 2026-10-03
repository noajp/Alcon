// integration-oauth — a Space owner connects Google Drive by signing in with
// Google (ADR 0035). Deployed with --no-verify-jwt: /go and /callback are
// browser navigations without a Supabase JWT; /start and /revoke check the
// caller's JWT themselves.
//
//   GET  /status                 { google: boolean } — whether the Google
//                                OAuth client is configured. No secrets.
//   POST /start { integrationId } (JWT, Space owner) → { url }
//                                Creates a sign-in row with a PKCE verifier
//                                and a one-time ticket (2 minutes). The app
//                                navigates to `url`.
//   GET  /go?ticket              Consumes the ticket, sets the HttpOnly
//                                cookie `ioauth=<nonce>` and redirects to
//                                Google with state + S256 challenge.
//   GET  /callback?code&state    Deletes the sign-in row (single use),
//                                checks expiry (10 minutes) and the cookie
//                                nonce, re-checks the owner and the row,
//                                exchanges the code with the verifier,
//                                requires drive.file, reads the Google email,
//                                stores the tokens in Vault and redirects to
//                                APP_ORIGIN with ?integration_oauth=ok|error.
//   POST /revoke { integrationId } (JWT, Space owner)
//                                Revokes the grant at Google and clears the
//                                stored tokens. Disconnect calls it before
//                                deleting the row.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, APP_ORIGIN.
// Until the client secrets exist every route but /status answers
// not_configured. Tokens never leave this function except into Vault.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleClientFromEnv, readCapped, type IntegrationRow } from "../_shared/integrationClient.ts";
import {
  GOOGLE_ABOUT_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, NONCE_COOKIE, STATE_TTL_MS, TICKET_TTL_MS,
  appReturnUrl, buildAuthorizeUrl, clearNonceCookie, hasScope, isGoogleDriveRow, nonceCookie, parseOAuthSecret,
  randomToken, readCookie, redirectUriFor, s256Challenge, secretFromTokenResponse, sha256Hex,
} from "../_shared/googleOAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ROW_COLUMNS = "id, activity_space_id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation";

type Row = IntegrationRow & { activity_space_id: string };

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

/** The route under the function: "/functions/v1/integration-oauth/go" → "/go". */
function route(pathname: string): string {
  const p = pathname.replace(/^\/functions\/v1(?=\/|$)/, "").replace(/^\/integration-oauth(?=\/|$)/, "");
  return p.replace(/\/+$/, "") || "/";
}

/** Where the browser lands when the sign-in ends. Supabase serves HTML from
 *  Edge Functions as plain text, so without APP_ORIGIN the answer is text. */
function finish(ok: boolean, integrationId: string | null): Response {
  const headers: Record<string, string> = { "set-cookie": clearNonceCookie(), "cache-control": "no-store" };
  const target = appReturnUrl(Deno.env.get("APP_ORIGIN"), ok, integrationId);
  if (target) return new Response(null, { status: 302, headers: { ...headers, location: target } });
  const text = ok
    ? "Google Drive is connected. You can close this tab and return to Alcon."
    : "Google Drive could not be connected. You can close this tab and try again from Alcon.";
  return new Response(text, { status: ok ? 200 : 400, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
}

interface Env { supabaseUrl: string; anonKey: string; serviceKey: string }

/**
 * The caller (by JWT) and the integration, when the caller owns its Space.
 * The same checks as integration-test: the row is visible under the caller's
 * RLS and the caller holds the owner role in that Space.
 */
async function ownedIntegration(req: Request, env: Env, integrationId: string): Promise<{ userId: string; row: Row } | Response> {
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === env.anonKey) return json({ error: "sign-in required" }, 401);
  const userDb = createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "session expired or invalid" }, 401);
  const { data: visible, error: readErr } = await userDb.from("integrations").select(ROW_COLUMNS).eq("id", integrationId).maybeSingle();
  if (readErr) return json({ error: "could not read the integration" }, 500);
  if (!visible) return json({ error: "integration not found" }, 404);
  const { data: membership } = await userDb
    .from("activity_space_members").select("role")
    .eq("activity_space_id", visible.activity_space_id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return json({ error: "only Space owners can connect integrations", code: "not_owner" }, 403);
  return { userId: user.id, row: visible as Row };
}

/** Re-checks with the service role that `userId` still owns the row's Space and the row is still Google Drive. */
async function stillOwned(admin: SupabaseClient, integrationId: string, userId: string): Promise<Row | null> {
  const { data: row } = await admin.from("integrations").select(ROW_COLUMNS).eq("id", integrationId).maybeSingle();
  if (!row || !isGoogleDriveRow(row)) return null;
  const { data: membership } = await admin
    .from("activity_space_members").select("role")
    .eq("activity_space_id", row.activity_space_id).eq("user_id", userId).maybeSingle();
  return membership?.role === "owner" ? (row as Row) : null;
}

async function readIntegrationId(req: Request): Promise<string | Response> {
  let body: { integrationId?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const id = typeof body.integrationId === "string" ? body.integrationId : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "integrationId is required" }, 400);
  return id;
}

async function postForm(url: string, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      signal: ctl.signal,
      redirect: "manual",
    });
    const text = await readCapped(res, 100_000);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function googleEmail(accessToken: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(GOOGLE_ABOUT_URL, { headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: ctl.signal, redirect: "manual" });
    if (!res.ok) return null;
    const body = JSON.parse(await readCapped(res, 100_000)) as { user?: { emailAddress?: unknown } };
    const email = body.user?.emailAddress;
    return typeof email === "string" && email.length <= 320 ? email : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = route(url.pathname);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);
  const env: Env = { supabaseUrl, anonKey, serviceKey };
  const client = googleClientFromEnv((k) => Deno.env.get(k));

  if (path === "/status" && req.method === "GET") return json({ google: !!client });
  if (!["/start", "/go", "/callback", "/revoke"].includes(path)) return json({ error: "not found" }, 404);
  if (!client) {
    if (req.method === "GET") return finish(false, null);
    return json({ error: "Google sign-in is not set up yet", code: "not_configured" }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── POST /start ─────────────────────────────────────────────────────────
  if (path === "/start") {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const integrationId = await readIntegrationId(req);
    if (integrationId instanceof Response) return integrationId;
    const owned = await ownedIntegration(req, env, integrationId);
    if (owned instanceof Response) return owned;
    if (!isGoogleDriveRow(owned.row)) return json({ error: "this integration does not sign in with Google", code: "not_oauth" }, 400);

    await admin.from("integration_oauth_states").delete().lt("expires_at", new Date().toISOString());
    const ticket = randomToken();
    const now = Date.now();
    const { error } = await admin.from("integration_oauth_states").insert({
      integration_id: integrationId,
      user_id: owned.userId,
      ticket_hash: await sha256Hex(ticket),
      code_verifier: randomToken(48),
      ticket_expires_at: new Date(now + TICKET_TTL_MS).toISOString(),
      expires_at: new Date(now + STATE_TTL_MS).toISOString(),
    });
    if (error) return json({ error: "could not start the sign-in" }, 500);
    return json({ url: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/integration-oauth/go?ticket=${encodeURIComponent(ticket)}` });
  }

  // ── GET /go ─────────────────────────────────────────────────────────────
  if (path === "/go") {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!ticket || ticket.length > 100) return finish(false, null);
    const state = randomToken();
    const nonce = randomToken();
    const { data: row } = await admin.from("integration_oauth_states")
      .update({ ticket_hash: null, state_hash: await sha256Hex(state), browser_nonce_hash: await sha256Hex(nonce) })
      .eq("ticket_hash", await sha256Hex(ticket))
      .gt("ticket_expires_at", new Date().toISOString())
      .is("browser_nonce_hash", null)
      .select("integration_id, code_verifier")
      .maybeSingle();
    if (!row) return finish(false, null);
    const location = buildAuthorizeUrl({
      clientId: client.clientId,
      redirectUri: redirectUriFor(supabaseUrl),
      state,
      codeChallenge: await s256Challenge(row.code_verifier as string),
    });
    return new Response(null, { status: 302, headers: { location, "set-cookie": nonceCookie(nonce), "cache-control": "no-store" } });
  }

  // ── GET /callback ───────────────────────────────────────────────────────
  if (path === "/callback") {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const state = url.searchParams.get("state") ?? "";
    if (!state || state.length > 100) return finish(false, null);
    // Single use: the row is gone whatever happens next.
    const { data: flow } = await admin.from("integration_oauth_states")
      .delete()
      .eq("state_hash", await sha256Hex(state))
      .select("integration_id, user_id, code_verifier, browser_nonce_hash, expires_at")
      .maybeSingle();
    if (!flow) return finish(false, null);
    const integrationId = flow.integration_id as string;
    if (new Date(flow.expires_at as string).getTime() <= Date.now()) return finish(false, integrationId);
    const cookieNonce = readCookie(req.headers.get("cookie"), NONCE_COOKIE);
    if (!cookieNonce || await sha256Hex(cookieNonce) !== flow.browser_nonce_hash) return finish(false, integrationId);
    const code = url.searchParams.get("code") ?? "";
    if (!code || url.searchParams.get("error")) return finish(false, integrationId);

    const row = await stillOwned(admin, integrationId, flow.user_id as string);
    if (!row) return finish(false, integrationId);

    const token = await postForm(GOOGLE_TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUriFor(supabaseUrl),
      code_verifier: flow.code_verifier as string,
    }).catch(() => null);
    if (!token || token.status !== 200) return finish(false, integrationId);
    const secret = secretFromTokenResponse(token.body, Date.now());
    if (!secret || !hasScope(secret.scope)) return finish(false, integrationId);

    const email = await googleEmail(secret.access_token);
    const { error: storeErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: JSON.stringify(secret) });
    if (storeErr) return finish(false, integrationId);
    await admin.from("integrations").update({
      external_account: email,
      last_test: { ok: true, at: new Date().toISOString(), code: "connected", detail: "" },
    }).eq("id", integrationId);
    return finish(true, integrationId);
  }

  // ── POST /revoke ────────────────────────────────────────────────────────
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const integrationId = await readIntegrationId(req);
  if (integrationId instanceof Response) return integrationId;
  const owned = await ownedIntegration(req, env, integrationId);
  if (owned instanceof Response) return owned;
  if (owned.row.auth_type !== "oauth") return json({ error: "this integration does not sign in with OAuth", code: "not_oauth" }, 400);

  const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: integrationId });
  const secret = parseOAuthSecret(raw);
  let revoked = false;
  if (secret) {
    // Revoking the refresh token ends the whole grant.
    const res = await postForm(GOOGLE_REVOKE_URL, { token: secret.refresh_token }).catch(() => null);
    revoked = res?.status === 200;
  }
  const { error: clearErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: "" });
  if (clearErr) return json({ error: "could not clear the stored credential" }, 500);
  await admin.from("integrations").update({ last_test: null }).eq("id", integrationId);
  return json({ ok: true, revoked });
});

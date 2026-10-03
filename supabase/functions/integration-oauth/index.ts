// integration-oauth — a Space owner connects Google Drive by signing in with
// Google (ADR 0035). Deployed with --no-verify-jwt: /go and /callback are
// browser navigations without a Supabase JWT; /start, /finish and /revoke
// check the caller's JWT themselves.
//
//   GET  /status                 { google: boolean } — whether Google sign-in
//                                is configured (client + APP_ORIGIN). No
//                                secrets.
//   POST /start { integrationId } (JWT, Space owner) → { url }
//                                Creates a sign-in row with a PKCE verifier
//                                and a one-time ticket (2 minutes). The app
//                                navigates to `url`.
//   GET  /go?ticket              Consumes the ticket, sets the HttpOnly
//                                cookie `ioauth=<nonce>` and redirects to
//                                Google with state + S256 challenge.
//   GET  /callback?code&state    Claims the state (single use), checks
//                                expiry (10 minutes) and the cookie nonce,
//                                exchanges the code with the verifier,
//                                requires drive.file and reads the Google
//                                email. Stores NOTHING on the integration: the
//                                token set is held in Vault against a one-time
//                                completion handle (10 minutes), and the
//                                browser goes to
//                                APP_ORIGIN/?integration_oauth=finish&handle=….
//   POST /finish { handle }      (JWT) Takes the held token set once. Stores
//                                it only when the caller is the person who
//                                called /start and still owns the Space;
//                                otherwise revokes it at Google and discards
//                                it. A link that walks someone else through
//                                the sign-in therefore never lands their
//                                Google account in the starter's Space.
//   POST /revoke { integrationId } (JWT, Space owner) → { ok, revoked }
//                                Revokes the grant at Google and clears the
//                                stored tokens. `revoked` is false when Google
//                                could not confirm it. Disconnect calls it
//                                before deleting the row.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, APP_ORIGIN.
// Without all three, every route but /status fails closed (not_configured).
// Tokens never reach the browser or a URL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleClientFromEnv, readCapped, type IntegrationRow } from "../_shared/integrationClient.ts";
import {
  GOOGLE_ABOUT_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, NONCE_COOKIE, STATE_TTL_MS, TICKET_TTL_MS,
  appOrigin, appReturnUrl, buildAuthorizeUrl, clearNonceCookie, finishDecision, hasScope, isExpired, isGoogleDriveRow,
  nonceCookie, parseOAuthSecret, randomToken, readCookie, redirectUriFor, s256Challenge, secretFromTokenResponse, sha256Hex,
} from "../_shared/googleOAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ROW_COLUMNS = "id, activity_space_id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation";
const NO_APP_ORIGIN = "Google sign-in cannot finish because APP_ORIGIN is not set on the server. Ask an administrator to set APP_ORIGIN, then try again from Alcon.";

type Row = IntegrationRow & { activity_space_id: string };

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "set-cookie": clearNonceCookie(), "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}

/** The route under the function: "/functions/v1/integration-oauth/go" → "/go". */
function route(pathname: string): string {
  const p = pathname.replace(/^\/functions\/v1(?=\/|$)/, "").replace(/^\/integration-oauth(?=\/|$)/, "");
  return p.replace(/\/+$/, "") || "/";
}

/** Sends the browser back to the app. Supabase serves HTML from Edge
 *  Functions as plain text, so without APP_ORIGIN the answer is text. */
function backToApp(result: "finish" | "error", integrationId: string | null, handle?: string): Response {
  const target = appReturnUrl(Deno.env.get("APP_ORIGIN"), result, integrationId, handle);
  if (!target) return text(result === "error" ? "Google Drive could not be connected. You can close this tab and try again from Alcon." : NO_APP_ORIGIN, 400);
  return new Response(null, { status: 302, headers: { "set-cookie": clearNonceCookie(), "cache-control": "no-store", location: target } });
}

interface Env { supabaseUrl: string; anonKey: string; serviceKey: string }

/** The signed-in caller by JWT, with a client acting as them. */
async function caller(req: Request, env: Env): Promise<{ userId: string; userDb: SupabaseClient } | Response> {
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === env.anonKey) return json({ error: "sign-in required" }, 401);
  const userDb = createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "session expired or invalid" }, 401);
  return { userId: user.id, userDb };
}

/**
 * The caller and the integration, when the caller owns its Space. The same
 * checks as integration-test: the row is visible under the caller's RLS and
 * the caller holds the owner role in that Space.
 */
async function ownedIntegration(req: Request, env: Env, integrationId: string): Promise<{ userId: string; row: Row } | Response> {
  const who = await caller(req, env);
  if (who instanceof Response) return who;
  const { data: visible, error: readErr } = await who.userDb.from("integrations").select(ROW_COLUMNS).eq("id", integrationId).maybeSingle();
  if (readErr) return json({ error: "could not read the integration" }, 500);
  if (!visible) return json({ error: "integration not found" }, 404);
  const { data: membership } = await who.userDb
    .from("activity_space_members").select("role")
    .eq("activity_space_id", visible.activity_space_id).eq("user_id", who.userId).maybeSingle();
  if (membership?.role !== "owner") return json({ error: "only Space owners can connect integrations", code: "not_owner" }, 403);
  return { userId: who.userId, row: visible as Row };
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

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : json({ error: "invalid JSON body" }, 400);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
}

async function readIntegrationId(req: Request): Promise<string | Response> {
  const body = await readBody(req);
  if (body instanceof Response) return body;
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
    const raw = await readCapped(res, 100_000);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw); } catch { /* not JSON */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

/** Revokes a token (and so the grant) at Google. True when Google confirmed it. */
async function revokeAtGoogle(token: string): Promise<boolean> {
  const res = await postForm(GOOGLE_REVOKE_URL, { token }).catch(() => null);
  return res?.status === 200;
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
  // /finish is the only way a sign-in is stored, and it is reached through
  // the app at APP_ORIGIN — without it nothing can complete.
  const origin = appOrigin(Deno.env.get("APP_ORIGIN"));

  if (path === "/status" && req.method === "GET") return json({ google: !!client && !!origin });
  if (!["/start", "/go", "/callback", "/finish", "/revoke"].includes(path)) return json({ error: "not found" }, 404);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // /revoke works whatever the configuration, so a connection can always be ended.
  if (path !== "/revoke" && (!client || !origin)) {
    if (path === "/callback" && url.searchParams.get("state")) {
      // Burn the sign-in so it cannot be finished later.
      await admin.from("integration_oauth_states").delete().eq("state_hash", await sha256Hex(url.searchParams.get("state")!.slice(0, 100)));
    }
    if (req.method === "GET") return text(origin ? "Google sign-in is not set up yet." : NO_APP_ORIGIN, 503);
    return json({ error: origin ? "Google sign-in is not set up yet" : "Google sign-in is not set up yet (APP_ORIGIN is missing)", code: "not_configured" }, 503);
  }

  // ── POST /start ─────────────────────────────────────────────────────────
  if (path === "/start") {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const integrationId = await readIntegrationId(req);
    if (integrationId instanceof Response) return integrationId;
    const owned = await ownedIntegration(req, env, integrationId);
    if (owned instanceof Response) return owned;
    if (!isGoogleDriveRow(owned.row)) return json({ error: "this integration does not sign in with Google", code: "not_oauth" }, 400);

    // Sign-ins past both deadlines go (their held tokens with them, by trigger).
    const nowIso = new Date().toISOString();
    await admin.from("integration_oauth_states").delete().lt("expires_at", nowIso).is("completion_hash", null);
    await admin.from("integration_oauth_states").delete().lt("completion_expires_at", nowIso);
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
    if (!ticket || ticket.length > 100) return backToApp("error", null);
    const state = randomToken();
    const nonce = randomToken();
    const { data: row } = await admin.from("integration_oauth_states")
      .update({ ticket_hash: null, state_hash: await sha256Hex(state), browser_nonce_hash: await sha256Hex(nonce) })
      .eq("ticket_hash", await sha256Hex(ticket))
      .gt("ticket_expires_at", new Date().toISOString())
      .is("browser_nonce_hash", null)
      .select("integration_id, code_verifier")
      .maybeSingle();
    if (!row) return backToApp("error", null);
    const location = buildAuthorizeUrl({
      clientId: client!.clientId,
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
    if (!state || state.length > 100) return backToApp("error", null);
    // Claim the state: a second callback with it finds nothing.
    const { data: flow } = await admin.from("integration_oauth_states")
      .update({ state_hash: null })
      .eq("state_hash", await sha256Hex(state))
      .select("id, integration_id, code_verifier, browser_nonce_hash, expires_at")
      .maybeSingle();
    if (!flow) return backToApp("error", null);
    const flowId = flow.id as string;
    const integrationId = flow.integration_id as string;
    const fail = async () => {
      await admin.from("integration_oauth_states").delete().eq("id", flowId);
      return backToApp("error", integrationId);
    };
    if (isExpired(flow.expires_at as string, Date.now())) return await fail();
    const cookieNonce = readCookie(req.headers.get("cookie"), NONCE_COOKIE);
    if (!cookieNonce || await sha256Hex(cookieNonce) !== flow.browser_nonce_hash) return await fail();
    const code = url.searchParams.get("code") ?? "";
    if (!code || url.searchParams.get("error")) return await fail();

    const token = await postForm(GOOGLE_TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      client_id: client!.clientId,
      client_secret: client!.clientSecret,
      redirect_uri: redirectUriFor(supabaseUrl),
      code_verifier: flow.code_verifier as string,
    }).catch(() => null);
    if (!token || token.status !== 200) return await fail();
    const secret = secretFromTokenResponse(token.body, Date.now());
    if (!secret) return await fail();
    if (!hasScope(secret.scope)) {
      await revokeAtGoogle(secret.refresh_token);
      return await fail();
    }

    // Held, not stored: only /finish, under the starter's own JWT, stores it.
    const email = await googleEmail(secret.access_token);
    const handle = randomToken();
    const { error: stashErr } = await admin.rpc("stash_integration_oauth_pending", {
      p_flow_id: flowId, p_secret: JSON.stringify(secret), p_account: email, p_completion_hash: await sha256Hex(handle),
    });
    if (stashErr) {
      await revokeAtGoogle(secret.refresh_token);
      return await fail();
    }
    return backToApp("finish", integrationId, handle);
  }

  // ── POST /finish ────────────────────────────────────────────────────────
  if (path === "/finish") {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const handle = typeof body.handle === "string" ? body.handle : "";
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(handle)) return json({ error: "handle is required" }, 400);
    const who = await caller(req, env);
    if (who instanceof Response) return who;

    const { data: taken, error: takeErr } = await admin.rpc("take_integration_oauth_pending", { p_completion_hash: await sha256Hex(handle) });
    if (takeErr) return json({ error: "could not finish the sign-in" }, 500);
    const pending = (Array.isArray(taken) ? taken[0] : taken) as
      { flow_integration_id: string; flow_user_id: string; token_set: string | null; account: string | null; flow_expires_at: string } | undefined;
    if (!pending) return json({ error: "This Google sign-in has already been used or has expired.", code: "not_found" }, 404);
    const secret = parseOAuthSecret(pending.token_set);
    const integrationId = pending.flow_integration_id;
    const discard = async (status: number, error: string, code: string) => {
      if (secret) await revokeAtGoogle(secret.refresh_token);
      return json({ error, code, integrationId }, status);
    };
    if (!secret) return json({ error: "could not finish the sign-in", integrationId }, 500);

    const decision = finishDecision({ flowUserId: pending.flow_user_id, callerId: who.userId, expiresAt: pending.flow_expires_at, nowMs: Date.now() });
    if (decision === "wrong_user") return await discard(403, "This Google sign-in was started by someone else, so it was discarded.", "wrong_user");
    if (decision === "expired") return await discard(410, "This Google sign-in has expired. Connect again.", "expired");
    if (!await stillOwned(admin, integrationId, who.userId)) return await discard(403, "only Space owners can connect integrations", "not_owner");

    const { error: storeErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: JSON.stringify(secret) });
    if (storeErr) return await discard(500, "could not save the connection", "error");
    await admin.from("integrations").update({
      external_account: pending.account,
      last_test: { ok: true, at: new Date().toISOString(), code: "connected", detail: "" },
    }).eq("id", integrationId);
    return json({ ok: true, integrationId });
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
  // Revoking the refresh token ends Alcon's whole grant for that Google
  // account, including in other Spaces that connected the same account.
  const revoked = secret ? await revokeAtGoogle(secret.refresh_token) : false;
  const { error: clearErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: "" });
  if (clearErr) return json({ error: "could not clear the stored credential" }, 500);
  await admin.from("integrations").update({ last_test: null }).eq("id", integrationId);
  return json({ ok: true, revoked });
});

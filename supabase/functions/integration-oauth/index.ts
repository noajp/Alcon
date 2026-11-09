// integration-oauth — a Space owner connects a Google service by signing in
// with Google (ADR 0035), or GitHub by signing in with GitHub. Deployed with
// --no-verify-jwt: /go and /callback are browser navigations without a
// Supabase JWT; /start, /finish and /revoke check the caller's JWT themselves.
// The provider is the integration row's: a row a Google profile claims
// (google-drive, gmail) → Google, github → GitHub; every step below is the
// same for both. What differs per Google service — scopes, the account
// check — is the profile's (googleOAuth.ts).
//
//   GET  /status                 { google: boolean, github: boolean } —
//                                whether each sign-in is configured (client +
//                                APP_ORIGIN). No secrets.
//   POST /start { integrationId } (JWT, Space owner) → { url }
//          { returnTo }          Creates a sign-in row with a PKCE verifier,
//                                a one-time ticket (2 minutes) and where to
//                                return (returnOrigin: the starting app's
//                                origin when allowed, else APP_ORIGIN). The
//                                app navigates to `url`.
//   GET  /go?ticket              Consumes the ticket, sets the HttpOnly
//                                cookie `ioauth=<nonce>` and redirects to
//                                the provider with state + S256 challenge.
//   GET  /callback?code&state    Claims the state (single use), checks
//                                expiry (10 minutes) and the cookie nonce,
//                                exchanges the code with the verifier,
//                                requires the scopes (the Google profile's /
//                                repo) and reads the account (Google email /
//                                GitHub login). Stores NOTHING on the integration: the
//                                token set is held in Vault against a one-time
//                                completion handle (10 minutes), and the
//                                browser goes back to where it started
//                                (/?integration_oauth=finish&handle=…).
//   POST /finish { handle }      (JWT) Takes the held token set once. Stores
//                                it only when the caller is the person who
//                                called /start and still owns the Space;
//                                otherwise discards it without revoking (see
//                                discardHeld). A link that walks someone else through
//                                the sign-in therefore never lands their
//                                account in the starter's Space.
//   POST /revoke { integrationId } (JWT, Space owner) → { ok, revoked }
//                                Revokes the grant at the provider and clears
//                                the stored tokens. `revoked` is false when the
//                                provider could not confirm it. Disconnect
//                                calls it before deleting the row.
//
// Secrets: APP_ORIGIN (and optionally APP_RETURN_ORIGINS, more origins a
// sign-in may return to), and per provider GOOGLE_OAUTH_CLIENT_ID /
// GOOGLE_OAUTH_CLIENT_SECRET, GITHUB_OAUTH_CLIENT_ID /
// GITHUB_OAUTH_CLIENT_SECRET. A provider without its client, or any without
// APP_ORIGIN, fails closed (not_configured) on every route but /status and
// /revoke. Tokens never reach the browser or a URL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleClientFromEnv, readCapped, type IntegrationRow } from "../_shared/integrationClient.ts";
import {
  GITHUB_TOKEN_URL, GITHUB_USER_URL, buildGithubAuthorizeUrl, githubClientFromEnv, githubHasScope, githubSecretFromTokenResponse,
  isGithubOAuthRow, parseGithubSecret, type GithubClientConfig,
} from "../_shared/githubOAuth.ts";
import {
  GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, NONCE_COOKIE, STATE_TTL_MS, TICKET_TTL_MS,
  appOrigin, appReturnUrl, buildAuthorizeUrl, returnOrigin, clearNonceCookie, finishDecision, googleProfileOf, grantsRequiredScopes, isExpired,
  nonceCookie, parseOAuthSecret, randomToken, readCookie, redirectUriFor, s256Challenge, secretFromTokenResponse, sha256Hex,
  type GoogleProviderProfile,
} from "../_shared/googleOAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ROW_COLUMNS = "id, activity_space_id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation";
const NO_APP_ORIGIN = "Sign-in cannot finish because APP_ORIGIN is not set on the server. Ask an administrator to set APP_ORIGIN, then try again from Alcon.";

type Row = IntegrationRow & { activity_space_id: string };

type Provider = "google" | "github";

/** Which sign-in a row uses, or null when it signs in with none. */
function providerOf(row: Parameters<typeof googleProfileOf>[0]): Provider | null {
  return googleProfileOf(row) ? "google" : isGithubOAuthRow(row) ? "github" : null;
}

const PROVIDER_NAME: Record<Provider, string> = { google: "Google", github: "GitHub" };

interface Clients { google: { clientId: string; clientSecret: string } | null; github: GithubClientConfig | null }

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

/** Sends the browser back to the app: to where the sign-in started (see
 *  returnOrigin), else APP_ORIGIN. Supabase serves HTML from Edge Functions
 *  as plain text, so without an origin the answer is text. */
function backToApp(result: "finish" | "error", integrationId: string | null, handle?: string, origin?: string | null): Response {
  const target = appReturnUrl(origin ?? Deno.env.get("APP_ORIGIN"), result, integrationId, handle);
  if (!target) return text(result === "error" ? "The connection could not be completed. You can close this tab and try again from Alcon." : NO_APP_ORIGIN, 400);
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
  if (membership?.role !== "owner") return json({ error: "Only Space owners can connect integrations.", code: "not_owner" }, 403);
  return { userId: who.userId, row: visible as Row };
}

/** Re-checks with the service role that `userId` still owns the row's Space and the row still signs in with `provider`. */
async function stillOwned(admin: SupabaseClient, integrationId: string, userId: string, provider: Provider): Promise<Row | null> {
  const { data: row } = await admin.from("integrations").select(ROW_COLUMNS).eq("id", integrationId).maybeSingle();
  if (!row || providerOf(row) !== provider) return null;
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

async function readIntegrationId(req: Request, body?: Record<string, unknown>): Promise<string | Response> {
  if (!body) {
    const read = await readBody(req);
    if (read instanceof Response) return read;
    body = read;
  }
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
/** Sign-ins past both deadlines go, their held tokens with them (by trigger). Run on every step that touches sign-ins. */
async function sweepExpired(admin: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin.from("integration_oauth_states").delete().lt("expires_at", nowIso).is("completion_hash", null);
  await admin.from("integration_oauth_states").delete().lt("completion_expires_at", nowIso);
}

async function revokeAtGoogle(token: string): Promise<boolean> {
  const res = await postForm(GOOGLE_REVOKE_URL, { token }).catch(() => null);
  return res?.status === 200;
}

/** Revokes the person's whole grant to Alcon's GitHub OAuth App. True when GitHub confirmed it. */
async function revokeAtGithub(client: GithubClientConfig, token: string): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`https://api.github.com/applications/${encodeURIComponent(client.clientId)}/grant`, {
      method: "DELETE",
      headers: {
        authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "alcon-integration-oauth",
      },
      body: JSON.stringify({ access_token: token }),
      signal: ctl.signal,
      redirect: "manual",
    });
    return res.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function githubLogin(accessToken: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(GITHUB_USER_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "alcon-integration-oauth" },
      signal: ctl.signal, redirect: "manual",
    });
    if (!res.ok) return null;
    const body = JSON.parse(await readCapped(res, 100_000)) as { login?: unknown };
    return typeof body.login === "string" && body.login.length <= 100 ? body.login : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Who signed in, asked at the profile's account check (Drive's about,
 *  Gmail's profile). The address, or null when it cannot be read. */
async function googleAccountEmail(accessToken: string, profile: GoogleProviderProfile): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(profile.accountCheck.url, { headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: ctl.signal, redirect: "manual" });
    if (!res.ok) return null;
    const body: unknown = JSON.parse(await readCapped(res, 100_000));
    return profile.accountCheck.emailOf(body);
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
  const clients: Clients = { google: googleClientFromEnv((k) => Deno.env.get(k)), github: githubClientFromEnv((k) => Deno.env.get(k)) };
  // /finish is the only way a sign-in is stored, and it is reached through
  // the app at APP_ORIGIN — without it nothing can complete.
  const origin = appOrigin(Deno.env.get("APP_ORIGIN"));

  if (path === "/status" && req.method === "GET") return json({ google: !!clients.google && !!origin, github: !!clients.github && !!origin });
  if (!["/start", "/go", "/callback", "/finish", "/revoke"].includes(path)) return json({ error: "not found" }, 404);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  /** The refusal when `provider` cannot sign in here; null when it can. */
  const notConfigured = (provider: Provider | null): Response | null => {
    if (provider && clients[provider] && origin) return null;
    const what = provider ? `${PROVIDER_NAME[provider]} sign-in` : "Sign-in";
    if (req.method === "GET") return text(origin ? `${what} is not set up yet.` : NO_APP_ORIGIN, 503);
    return json({ error: origin ? `${what} is not set up yet` : `${what} is not set up yet (APP_ORIGIN is missing)`, code: "not_configured" }, 503);
  };
  /** The integration a sign-in belongs to. */
  const rowOfIntegration = async (integrationId: string): Promise<Row | null> => {
    const { data: row } = await admin.from("integrations").select(ROW_COLUMNS).eq("id", integrationId).maybeSingle();
    return (row as Row | null) ?? null;
  };
  /** The provider of the integration a sign-in belongs to. */
  const providerOfIntegration = async (integrationId: string): Promise<Provider | null> => {
    const row = await rowOfIntegration(integrationId);
    return row ? providerOf(row) : null;
  };
  // /finish needs APP_ORIGIN like every step; /revoke works whatever the
  // configuration, so a connection can always be ended.
  if (path === "/finish" && !origin) return notConfigured(null)!;

  // ── POST /start ─────────────────────────────────────────────────────────
  if (path === "/start") {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const integrationId = await readIntegrationId(req, body);
    if (integrationId instanceof Response) return integrationId;
    const owned = await ownedIntegration(req, env, integrationId);
    if (owned instanceof Response) return owned;
    const provider = providerOf(owned.row);
    if (!provider) return json({ error: "this integration does not sign in with OAuth", code: "not_oauth" }, 400);
    // Back to the app that started it (its origin, when allowed).
    const returnTo = returnOrigin(body.returnTo, Deno.env.get("APP_ORIGIN"), Deno.env.get("APP_RETURN_ORIGINS"));
    const refused = notConfigured(provider);
    if (refused) return refused;

    await sweepExpired(admin);
    const ticket = randomToken();
    const now = Date.now();
    const { error } = await admin.from("integration_oauth_states").insert({
      integration_id: integrationId,
      user_id: owned.userId,
      ticket_hash: await sha256Hex(ticket),
      code_verifier: randomToken(48),
      ticket_expires_at: new Date(now + TICKET_TTL_MS).toISOString(),
      expires_at: new Date(now + STATE_TTL_MS).toISOString(),
      return_origin: returnTo,
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
    const integration = await rowOfIntegration(row.integration_id as string);
    const provider = integration ? providerOf(integration) : null;
    const refused = notConfigured(provider);
    if (refused) return refused;
    const authorize = {
      clientId: clients[provider!]!.clientId,
      redirectUri: redirectUriFor(supabaseUrl),
      state,
      codeChallenge: await s256Challenge(row.code_verifier as string),
    };
    const location = provider === "github"
      ? buildGithubAuthorizeUrl(authorize)
      : buildAuthorizeUrl({ ...authorize, profile: googleProfileOf(integration) ?? undefined });
    return new Response(null, { status: 302, headers: { location, "set-cookie": nonceCookie(nonce), "cache-control": "no-store" } });
  }

  // ── GET /callback ───────────────────────────────────────────────────────
  if (path === "/callback") {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const state = url.searchParams.get("state") ?? "";
    if (!state || state.length > 100) return backToApp("error", null);
    await sweepExpired(admin);
    // Claim the state: a second callback with it finds nothing.
    const { data: flow } = await admin.from("integration_oauth_states")
      .update({ state_hash: null })
      .eq("state_hash", await sha256Hex(state))
      .select("id, integration_id, code_verifier, browser_nonce_hash, expires_at, return_origin")
      .maybeSingle();
    if (!flow) return backToApp("error", null);
    const flowId = flow.id as string;
    const integrationId = flow.integration_id as string;
    const back = (flow.return_origin as string | null) ?? null;
    const fail = async () => {
      await admin.from("integration_oauth_states").delete().eq("id", flowId);
      return backToApp("error", integrationId, undefined, back);
    };
    if (isExpired(flow.expires_at as string, Date.now())) return await fail();
    const cookieNonce = readCookie(req.headers.get("cookie"), NONCE_COOKIE);
    if (!cookieNonce || await sha256Hex(cookieNonce) !== flow.browser_nonce_hash) return await fail();
    const code = url.searchParams.get("code") ?? "";
    if (!code || url.searchParams.get("error")) return await fail();
    const provider = await providerOfIntegration(integrationId);
    if (!provider || !clients[provider]) return await fail();
    const client = clients[provider]!;

    const token = await postForm(provider === "github" ? GITHUB_TOKEN_URL : GOOGLE_TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUriFor(supabaseUrl),
      code_verifier: flow.code_verifier as string,
    }).catch(() => null);
    if (!token || token.status !== 200) return await fail();
    let held: { secret: string; account: string | null };
    if (provider === "github") {
      // GitHub answers 200 with { error } when the code is refused.
      const secret = githubSecretFromTokenResponse(token.body);
      if (!secret || !githubHasScope(secret.scope)) return await fail();
      held = { secret: JSON.stringify(secret), account: await githubLogin(secret.access_token) };
    } else {
      const secret = secretFromTokenResponse(token.body, Date.now());
      const profile = googleProfileOf(await rowOfIntegration(integrationId));
      if (!secret || !profile || !grantsRequiredScopes(secret.scope, profile)) return await fail();
      held = { secret: JSON.stringify(secret), account: await googleAccountEmail(secret.access_token, profile) };
    }

    // Held, not stored: only /finish, under the starter's own JWT, stores it.
    const handle = randomToken();
    const { error: stashErr } = await admin.rpc("stash_integration_oauth_pending", {
      p_flow_id: flowId, p_secret: held.secret, p_account: held.account, p_completion_hash: await sha256Hex(handle),
    });
    if (stashErr) return await fail();
    return backToApp("finish", integrationId, handle, back);
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
    await sweepExpired(admin);

    const { data: taken, error: takeErr } = await admin.rpc("take_integration_oauth_pending", { p_completion_hash: await sha256Hex(handle) });
    if (takeErr) return json({ error: "The sign-in could not be finished. Connect again." }, 500);
    const pending = (Array.isArray(taken) ? taken[0] : taken) as
      { flow_integration_id: string; flow_user_id: string; token_set: string | null; account: string | null; flow_expires_at: string } | undefined;
    if (!pending) return json({ error: "This sign-in has already been used or has expired.", code: "not_found" }, 404);
    const google = parseOAuthSecret(pending.token_set);
    const github = google ? null : parseGithubSecret(pending.token_set);
    const provider: Provider | null = google ? "google" : github ? "github" : null;
    const integrationId = pending.flow_integration_id;
    // Discarded, not revoked: a revoke ends Alcon's whole grant for that
    // account, which would also cut the connections that person already has
    // in their own Spaces. The held tokens are gone once taken, so nobody
    // holds a usable token for this sign-in.
    const discard = async (status: number, error: string, code: string) => json({ error, code, integrationId }, status);
    if (!provider) return json({ error: "The sign-in could not be finished. Connect again.", integrationId }, 500);

    const decision = finishDecision({ flowUserId: pending.flow_user_id, callerId: who.userId, expiresAt: pending.flow_expires_at, nowMs: Date.now() });
    if (decision === "wrong_user") return await discard(403, "This sign-in was started by someone else, so it was discarded.", "wrong_user");
    if (decision === "expired") return await discard(410, "This sign-in has expired. Connect again.", "expired");
    // The token goes only to a row of its own provider: a Google token never lands on a GitHub row.
    if (!await stillOwned(admin, integrationId, who.userId, provider)) return await discard(403, "Only Space owners can connect integrations.", "not_owner");
    const secret = google ?? github!;

    const { error: storeErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: JSON.stringify(secret) });
    if (storeErr) return await discard(500, "The connection could not be saved. Connect again.", "error");
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
  // Revoking ends Alcon's whole grant for that account, including in other
  // Spaces that connected the same account.
  let revoked = false;
  if (providerOf(owned.row) === "github") {
    const secret = parseGithubSecret(raw);
    revoked = secret && clients.github ? await revokeAtGithub(clients.github, secret.access_token) : false;
  } else {
    const secret = parseOAuthSecret(raw);
    revoked = secret ? await revokeAtGoogle(secret.refresh_token) : false;
  }
  const { error: clearErr } = await admin.rpc("store_integration_oauth_token", { p_integration_id: integrationId, p_secret: "" });
  if (clearErr) return json({ error: "could not clear the stored credential" }, 500);
  await admin.from("integrations").update({ last_test: null }).eq("id", integrationId);
  return json({ ok: true, revoked });
});

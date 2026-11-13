// asset-relay — the intake a local app or AI reaches with one line (ADR 0036).
//
// An app announces itself with no credential (POST /hello { space, name,
// … }), gets back an asset token, and from then on reports what it does
// (POST /events) with that token. The asset is "unclaimed" until a Space
// owner accepts it in Settings › Customize › Connected assets; events
// sent before that are kept but shown as unverified. A revoked asset is
// refused on its next call.
//
// Nothing here runs as a person: the function holds the service role and
// reaches the database only through the RPCs the migration grants to it
// (announce_asset / resolve_asset_token / touch_asset / record_asset_events),
// each of which does one thing. What the app says about itself goes into
// `manifest` as self-reported; what the relay sees of the connection (user
// agent, address) goes into `observed`, so the screen can keep the two apart.
//
// Routes (verify_jwt=false; the token is checked here):
//   POST /hello    { space, name, kind?, manifest?, token? }
//                  → 201 { asset_id, token, status }    (first contact)
//                  → 200 { asset_id, status }           (a hello with a known token)
//   POST /events   Authorization: Bearer <token>
//                  { events: [{ kind, summary, payload?, occurred_at? }] } or one event
//                  → 200 { recorded }
//   GET  /status   Authorization: Bearer <token> → { asset_id, name, status, space }
//   POST /calls/next          Authorization: Bearer <token>
//                  The next thing an agent asked this asset to do, waiting
//                  up to ~20 s for one: → { call: { id, tool, input } | null }.
//                  Only an accepted asset receives calls. Doubles as the
//                  asset's heartbeat (last_seen_at).
//   POST /calls/<id>/result   Authorization: Bearer <token>
//                  { ok, result?, error? } → { recorded: true }
//
// Errors: { "error": { "code", "message" } } with 400, 401, 403 (revoked),
// 404 (unknown Space), 405, 413 (too large), 429 (too many unrecognized
// assets in the Space), 500.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/delegatedAuth.ts";

const TOKEN_PREFIX = "alc_ast_";
const KINDS = new Set(["app", "ai_agent", "script", "service", "other"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;
const MAX_EVENTS_PER_CALL = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function relayPath(pathname: string): string {
  const i = pathname.indexOf("/asset-relay");
  const rest = i >= 0 ? pathname.slice(i + "/asset-relay".length) : pathname;
  return rest.replace(/\/+$/, "") || "/";
}

function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return TOKEN_PREFIX + s;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v ?? null)).length;
}

/** What the relay itself saw of this connection — not what the app claims. */
function observed(req: Request): Record<string, unknown> {
  return {
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200) || null,
    address: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
    seen_at: new Date().toISOString(),
  };
}

interface ResolvedAsset {
  id: string;
  activity_space_id: string;
  name: string;
  status: "unclaimed" | "active" | "revoked";
  claimed_at: string | null;
}

async function resolve(db: SupabaseClient, token: string): Promise<ResolvedAsset | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 32) return null;
  const { data, error } = await db.rpc("resolve_asset_token", { p_hash: await sha256Hex(token) });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as ResolvedAsset) : null;
}

interface HelloBody {
  space?: unknown;
  name?: unknown;
  kind?: unknown;
  manifest?: unknown;
  token?: unknown;
}

async function hello(req: Request, db: SupabaseClient): Promise<Response> {
  let body: HelloBody;
  try { body = await req.json(); } catch { return fail(400, "invalid_json", "the body is not JSON"); }
  if (!isObject(body)) return fail(400, "invalid_body", "the body must be an object");

  const manifest = isObject(body.manifest) ? body.manifest : {};
  if (byteLength(manifest) > MAX_MANIFEST_BYTES) return fail(413, "manifest_too_large", `manifest must be under ${MAX_MANIFEST_BYTES} bytes`);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : "app";

  // A hello that carries a token is a restart, not a new asset.
  if (typeof body.token === "string" && body.token.length > 0) {
    const asset = await resolve(db, body.token);
    if (!asset) return fail(401, "unknown_token", "the token is not known; announce again without it");
    if (asset.status === "revoked") return fail(403, "revoked", "this asset was revoked by a Space owner");
    const { error } = await db.rpc("touch_asset", { p_asset_id: asset.id, p_manifest: manifest, p_observed: observed(req) });
    if (error) return fail(500, "touch_failed", error.message);
    return json(200, { asset_id: asset.id, status: asset.status, space: asset.activity_space_id });
  }

  if (typeof body.space !== "string" || !UUID_RE.test(body.space)) return fail(400, "space_required", "space must be the Space's id");
  if (!name) return fail(400, "name_required", "name is required");

  const token = newToken();
  const { data, error } = await db.rpc("announce_asset", {
    p_space: body.space,
    p_name: name,
    p_kind: kind,
    p_manifest: manifest,
    p_observed: observed(req),
    p_token_hash: await sha256Hex(token),
    p_token_prefix: token.slice(0, TOKEN_PREFIX.length + 8),
  });
  if (error) {
    if (error.code === "P0002") return fail(404, "space_not_found", "no such Space");
    if (error.code === "P0003") return fail(429, "too_many_unrecognized", "this Space has too many unrecognized assets; ask an owner to accept or revoke some");
    return fail(500, "announce_failed", error.message);
  }
  return json(201, {
    asset_id: data,
    token,
    status: "unclaimed",
    next: "A Space owner accepts this asset in Clayware › Settings › Customize › Connected assets. Keep the token: it identifies this asset from now on.",
  });
}

interface EventIn {
  kind?: unknown;
  summary?: unknown;
  payload?: unknown;
  occurred_at?: unknown;
}

function normalizeEvent(e: unknown): { kind: string; summary: string; payload: unknown; occurred_at: string | null } | string {
  if (!isObject(e)) return "each event must be an object";
  const ev = e as EventIn;
  const kind = typeof ev.kind === "string" ? ev.kind.trim().slice(0, 60) : "";
  const summary = typeof ev.summary === "string" ? ev.summary.trim().slice(0, 300) : "";
  if (!kind) return "each event needs a kind";
  if (!summary) return "each event needs a summary";
  if (ev.payload !== undefined && byteLength(ev.payload) > MAX_EVENT_PAYLOAD_BYTES) return `payload must be under ${MAX_EVENT_PAYLOAD_BYTES} bytes`;
  let occurred_at: string | null = null;
  if (typeof ev.occurred_at === "string") {
    const t = Date.parse(ev.occurred_at);
    if (Number.isNaN(t)) return "occurred_at must be a date";
    occurred_at = new Date(t).toISOString();
  }
  return { kind, summary, payload: ev.payload ?? null, occurred_at };
}

async function events(req: Request, db: SupabaseClient, asset: ResolvedAsset): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return fail(400, "invalid_json", "the body is not JSON"); }
  const list = isObject(body) && Array.isArray((body as { events?: unknown }).events)
    ? (body as { events: unknown[] }).events
    : Array.isArray(body) ? body : [body];
  if (list.length === 0) return fail(400, "no_events", "send at least one event");
  if (list.length > MAX_EVENTS_PER_CALL) return fail(413, "too_many_events", `at most ${MAX_EVENTS_PER_CALL} events per call`);
  const normalized = [];
  for (const e of list) {
    const n = normalizeEvent(e);
    if (typeof n === "string") return fail(400, "invalid_event", n);
    normalized.push(n);
  }
  const { data, error } = await db.rpc("record_asset_events", { p_asset_id: asset.id, p_events: normalized });
  if (error) {
    if (error.code === "42501") return fail(403, "revoked", "this asset was revoked by a Space owner");
    return fail(500, "record_failed", error.message);
  }
  return json(200, { recorded: data, status: asset.status });
}

/** A staged sign-in pair, read strictly: only the two fields the
 *  fill needs, only as non-empty strings. Anything else is not a
 *  pair and the call is not delivered. */
function parsePair(text: string): { username: string; password: string } | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!isObject(v)) return null;
  const { username, password } = v as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || !username) return null;
  if (typeof password !== "string" || !password) return null;
  return { username, password };
}

const CALL_WAIT_MS = 20_000;
const CALL_POLL_MS = 800;
/** A call nobody picked up for this long is stale: the run has given up on it. */
const CALL_STALE_MS = 90_000;
const MAX_RESULT_BYTES = 256 * 1024;

/** Hands the oldest pending call to the asset, waiting a while for one. */
async function nextCall(db: SupabaseClient, asset: ResolvedAsset): Promise<Response> {
  if (asset.status !== "active") return json(200, { call: null, status: asset.status });
  await db.from("assets").update({ last_seen_at: new Date().toISOString() }).eq("id", asset.id);
  const until = Date.now() + CALL_WAIT_MS;
  while (true) {
    const { data: pending } = await db.from("asset_calls").select("id, tool, input, created_at")
      .eq("asset_id", asset.id).eq("status", "pending").order("created_at").limit(5);
    for (const c of (pending ?? []) as { id: string; tool: string; input: unknown; created_at: string }[]) {
      if (Date.now() - new Date(c.created_at).getTime() > CALL_STALE_MS) {
        await db.from("asset_calls").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", c.id).eq("status", "pending");
        continue;
      }
      // Claimed only if still pending: two pollers never take the same call.
      const { data: claimed } = await db.from("asset_calls").update({ status: "claimed", claimed_at: new Date().toISOString() })
        .eq("id", c.id).eq("status", "pending").select("id").maybeSingle();
      if (!claimed) continue;
      if (c.tool === "sign_in") {
        // A sign-in call is never delivered without its pair, and the
        // pair never sits in the call row (Space members read those):
        // it was staged in the Vault under this call's id by the
        // releasing server, and is taken — read and deleted in one
        // RPC — only now, into this token-authenticated response.
        // No pair yet (the releaser stages a moment after queueing)
        // or an unreadable one: hand the call back to pending and
        // let the poll come around again; it is never delivered dry.
        const { data: staged } = await db.rpc("take_sign_in_payload", { p_call_id: c.id });
        const pair = typeof staged === "string" ? parsePair(staged) : null;
        if (!pair) {
          await db.from("asset_calls").update({ status: "pending", claimed_at: null })
            .eq("id", c.id).eq("status", "claimed");
          continue;
        }
        const input = isObject(c.input) ? { ...c.input, pair } : { pair };
        return json(200, { call: { id: c.id, tool: c.tool, input } });
      }
      return json(200, { call: { id: c.id, tool: c.tool, input: c.input } });
    }
    if (Date.now() + CALL_POLL_MS > until) return json(200, { call: null, status: asset.status });
    await new Promise((r) => setTimeout(r, CALL_POLL_MS));
  }
}

async function callResult(req: Request, db: SupabaseClient, asset: ResolvedAsset, callId: string): Promise<Response> {
  if (!UUID_RE.test(callId)) return fail(400, "invalid_call", "no such call");
  let body: unknown;
  try { body = await req.json(); } catch { return fail(400, "invalid_json", "the body is not JSON"); }
  if (!isObject(body)) return fail(400, "invalid_body", "the body must be an object");
  if (byteLength(body.result) > MAX_RESULT_BYTES) return fail(413, "result_too_large", `result must be under ${MAX_RESULT_BYTES} bytes`);
  const ok = body.ok !== false;
  const { data } = await db.from("asset_calls").update({
    status: ok ? "done" : "failed",
    result: ok ? (body.result ?? null) : null,
    error: ok ? null : String(body.error ?? "failed").slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq("id", callId).eq("asset_id", asset.id).eq("status", "claimed").select("id").maybeSingle();
  if (!data) return fail(409, "not_claimed", "this call is not waiting for this asset's answer");
  return json(200, { recorded: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const path = relayPath(new URL(req.url).pathname);

  if (req.method === "GET" && path === "/") {
    return json(200, {
      name: "Clayware asset relay",
      hello: "POST /hello { space, name, kind?, manifest? }",
      events: "POST /events with Authorization: Bearer <token>",
      status: "GET /status with Authorization: Bearer <token>",
    });
  }

  const db = serviceClient();
  if (!db) return fail(500, "not_configured", "server not configured");

  try {
    if (path === "/hello") {
      if (req.method !== "POST") return fail(405, "method_not_allowed", "POST /hello");
      return await hello(req, db);
    }
    if (path === "/events" || path === "/status") {
      const token = bearer(req);
      if (!token) return fail(401, "unauthorized", "missing bearer token");
      const asset = await resolve(db, token);
      if (!asset) return fail(401, "unauthorized", "the token is not known");
      if (asset.status === "revoked") return fail(403, "revoked", "this asset was revoked by a Space owner");
      if (path === "/status") {
        if (req.method !== "GET") return fail(405, "method_not_allowed", "GET /status");
        return json(200, { asset_id: asset.id, name: asset.name, status: asset.status, space: asset.activity_space_id, claimed_at: asset.claimed_at });
      }
      if (req.method !== "POST") return fail(405, "method_not_allowed", "POST /events");
      return await events(req, db, asset);
    }
    const callRoute = /^\/calls\/(next|[0-9a-f-]{36}\/result)$/i.exec(path);
    if (callRoute) {
      if (req.method !== "POST") return fail(405, "method_not_allowed", "POST");
      const token = bearer(req);
      if (!token) return fail(401, "unauthorized", "missing bearer token");
      const asset = await resolve(db, token);
      if (!asset) return fail(401, "unauthorized", "the token is not known");
      if (asset.status === "revoked") return fail(403, "revoked", "this asset was revoked by a Space owner");
      return callRoute[1] === "next" ? await nextCall(db, asset) : await callResult(req, db, asset, callRoute[1].slice(0, 36));
    }
    return fail(404, "not_found", "no such route");
  } catch (e) {
    return fail(500, "internal", e instanceof Error ? e.message : String(e));
  }
});

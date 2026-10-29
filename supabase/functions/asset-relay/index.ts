// asset-relay — the intake a local app or AI reaches with one line (ADR 0036).
//
// An app announces itself with no credential (POST /hello { space, name,
// … }), gets back an asset token, and from then on reports what it does
// (POST /events) with that token. The asset is "unclaimed" until a Space
// owner accepts it in Settings › Integrations › Connected assets; events
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
    next: "A Space owner accepts this asset in Alcon › Settings › Integrations › Connected assets. Keep the token: it identifies this asset from now on.",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const path = relayPath(new URL(req.url).pathname);

  if (req.method === "GET" && path === "/") {
    return json(200, {
      name: "Alcon asset relay",
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
    return fail(404, "not_found", "no such route");
  } catch (e) {
    return fail(500, "internal", e instanceof Error ? e.message : String(e));
  }
});

// Calling a Space's external services on an agent's behalf.
//
// Two kinds of the integrations table are called here:
//   mcp   a remote MCP server over Streamable HTTP. Its tools become the
//         agent's tools; readOnlyHint decides read vs write, believed only
//         from vetted presets (trustsReadOnlyHint).
//   http  a REST API under one base URL. The agent gets one http_request tool
//         confined to that base; GET / HEAD are reads, the rest are writes.
// The third, model, is an AI model provider: run-agent talks to it as the
// model itself and never offers it as a tool.
//
// The secret is passed in by the caller (read from Vault with the service
// role) and only ever goes into the outgoing request's header. An OAuth
// integration's stored secret is a token set; resolveCredential turns it into
// a current access token, refreshing it when it is about to expire. Endpoints
// are checked before every request: https only, no localhost / private /
// link-local hosts, and an http_request path can never leave its base URL.

import {
  GOOGLE_TOKEN_URL, isGoogleDriveRow, needsRefresh, parseOAuthSecret, secretFromTokenResponse, sha256Hex,
} from "./googleOAuth.ts";
import { isGithubOAuthRow, parseGithubSecret } from "./githubOAuth.ts";

export interface IntegrationRow {
  id: string;
  preset?: string | null;
  kind: "mcp" | "http" | "model";
  name: string;
  description: string | null;
  endpoint: string;
  auth_type: "none" | "bearer" | "header" | "oauth";
  auth_header: string | null;
  delegation: "approve_each" | "full_delegation";
}

export interface RemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

const TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 20_000;

/** Pure. True when a URL is safe to call from the server: https to a public host. */
export function isSafeEndpoint(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  // A trailing dot names the same host ("localhost." is localhost).
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (!host.includes(".") && !host.includes(":")) return false;
  // IPv4 literals in private, loopback, link-local, CGNAT and metadata ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224) return false;
  }
  // IPv6 literals are refused outright: loopback, unique/site/link-local,
  // IPv4-mapped / -compatible / NAT64 forms all spell private targets, and
  // no real integration endpoint is an IPv6 literal.
  if (host.includes(":")) return false;
  return true;
}

/** Pure. True when an IPv4 address is in a private, loopback, link-local,
 *  CGNAT, benchmark, metadata, multicast or reserved range. */
function isPrivateV4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return true;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && (c === 0 || c === 2))             // IETF protocol / documentation
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // documentation
    || a >= 224;
}

/** Pure. True when a resolved address (IPv4 or IPv6) is one the server may
 *  call: public unicast. IPv6 forms that embed an IPv4 address (mapped,
 *  compatible, NAT64) are judged by that address. */
export function isPublicAddress(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!ip.includes(":")) return !isPrivateV4(ip);
  const embedded = ip.match(/^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) return !isPrivateV4(embedded[1]);
  if (ip === "::" || ip === "::1") return false;
  const first = parseInt(ip.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false;   // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false;   // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return false;   // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return false;   // ff00::/8 multicast
  if (first === 0x64 && ip.startsWith("64:ff9b:")) return false; // NAT64 in hex form
  if (first === 0x2001 && /^2001:0*db8:/.test(ip)) return false; // documentation
  return (first & 0xe000) === 0x2000;               // 2000::/3 global unicast
}

type Resolve = (host: string, type: "A" | "AAAA") => Promise<string[]>;

/** Deno's resolver, or null where the runtime does not offer one. */
function denoResolver(): Resolve | null {
  const deno = (globalThis as unknown as { Deno?: { resolveDns?(h: string, t: string): Promise<string[]> } }).Deno;
  return deno?.resolveDns ? (host, type) => deno.resolveDns!(host, type) : null;
}

/** A lookup that failed because the name has no such record, as opposed to
 *  the resolver itself being unavailable or not permitted. */
function isNoRecord(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  return name === "NotFound" || /no (?:such|data)|nxdomain|not found/i.test(String((error as Error)?.message ?? ''));
}

/**
 * True when every address the endpoint's host resolves to is public. The
 * hostname check alone let a public name that resolves to 10.x / 169.254.x
 * through (ELE_OBJ-024); this asks DNS just before the request. A name with
 * no addresses is refused. Where the runtime has no resolver, or every lookup
 * fails for a reason other than "no such record", the host-name check stands
 * alone, as before. (A rebinding answer that changes between this check and
 * the request is not covered.)
 */
export async function resolvesToPublic(raw: string, resolve: Resolve | null = denoResolver()): Promise<boolean> {
  if (!isSafeEndpoint(raw)) return false;
  const host = new URL(raw).hostname.toLowerCase().replace(/\.+$/, "");
  // An address literal is judged as written; isSafeEndpoint already did.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPublicAddress(host);
  // Where the runtime offers no resolver (or refuses it), fall back to the
  // host-name check rather than stopping every integration.
  if (!resolve) return true;
  const lookups = await Promise.allSettled([resolve(host, "A"), resolve(host, "AAAA")]);
  if (lookups.every((r) => r.status === "rejected" && !isNoRecord(r.reason))) return true;
  const addresses = lookups.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (addresses.length === 0) return false;
  return addresses.every(isPublicAddress);
}

/**
 * Pure. True when an integration points at this Alcon project itself — its
 * Supabase host or the legacy `<ref>.functions.supabase.co` host, which also
 * serves alcon-mcp (REST API, any Edge Function). Case, a trailing dot and a
 * port do not change the answer. An agent already has the board tools under
 * its starter's RLS; reaching Alcon again through a stored credential would
 * act outside that run (ADR 0032).
 */
export function pointsAtAlcon(endpoint: string, supabaseUrl: string | null | undefined): boolean {
  if (!supabaseUrl) return false;
  const host = (raw: string): string | null => {
    try {
      return new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    } catch {
      return null;
    }
  };
  const target = host(endpoint);
  const own = host(supabaseUrl);
  if (!target || !own) return false;
  const alcon = new Set([own]);
  const ref = own.match(/^([a-z0-9-]+)\.(?:functions\.)?supabase\.(co|in|net)$/);
  if (ref) {
    alcon.add(`${ref[1]}.supabase.${ref[2]}`);
    alcon.add(`${ref[1]}.functions.supabase.${ref[2]}`);
  }
  return alcon.has(target);
}

/** Pure. The URL an http_request may hit: base + path, never outside base. */
export function resolveUnderBase(base: string, path: string, query?: Record<string, unknown>): string {
  if (typeof path !== "string" || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.includes("\\")) {
    throw new Error("path must be relative to the integration's base URL");
  }
  const b = new URL(base);
  const basePath = b.pathname.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  const u = new URL(b.origin + basePath + "/" + rel);
  // Normalisation may have resolved `..` segments; the result must stay under base.
  if (u.origin !== b.origin || !(u.pathname === basePath || u.pathname.startsWith(basePath + "/"))) {
    throw new Error("path escapes the integration's base URL");
  }
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

export function authHeaders(row: IntegrationRow, secret: string | null): Record<string, string> {
  if (!secret || row.auth_type === "none") return {};
  if (row.auth_type === "header" && row.auth_header) return { [row.auth_header]: secret };
  return { Authorization: `Bearer ${secret}` };
}

function truncate(s: string): string {
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n…(${s.length - MAX_RESULT_CHARS} chars truncated)` : s;
}

const MAX_BODY_BYTES = 2_000_000;

/** Read at most MAX_BODY_BYTES of a response body as text. */
export async function readCapped(res: Response, limit = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { chunks.push(value.slice(0, value.byteLength - (size - limit))); await reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function fetchWithTimeout(url: string, init: RequestInit, fetchImpl: FetchLike = fetch): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

// ── MCP (Streamable HTTP) ──────────────────────────────────────────────────

/** Pure. The JSON-RPC response with `id` from a JSON or SSE body. */
export function parseRpcBody(contentType: string, body: string, id: number): Record<string, unknown> | null {
  const candidates: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        try { candidates.push(JSON.parse(line.slice(5).trim())); } catch { /* not JSON */ }
      }
    }
  } else {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) candidates.push(...parsed); else candidates.push(parsed);
    } catch { return null; }
  }
  for (const c of candidates) {
    if (c && typeof c === "object" && (c as Record<string, unknown>).id === id) return c as Record<string, unknown>;
  }
  return null;
}

// A remote server labels its own tools: readOnlyHint is whatever it says.
// A connection to an arbitrary server could mark a write tool read-only and
// so skip "approve each" (ELE_OBJ-025). The label is believed only from the
// vetted presets at their catalog endpoints, and never for a tool whose name
// says it writes; every other tool counts as a write.
const VETTED_MCP: readonly { preset: string; endpoint: RegExp }[] = [
  { preset: "github", endpoint: /^https:\/\/api\.githubcopilot\.com\/mcp\/?$/ },
  { preset: "linear", endpoint: /^https:\/\/mcp\.linear\.app\/mcp\/?$/ },
];
const WRITE_VERB = /(^|[_\-.])(create|update|delete|remove|merge|push|send|post|put|patch|write|add|set|assign|close|archive|move|edit|rename|upload|invite|approve|reject|cancel|comment|reply|publish|run|execute|trigger|save|share|restore|resolve|submit|fork|star|dismiss|lock|request|mark|retire)([_\-.]|$)/i;

/** Pure. Whether a tool's readOnlyHint may be believed for this connection. */
export function trustsReadOnlyHint(row: Pick<IntegrationRow, "preset" | "endpoint">, toolName: string): boolean {
  const vetted = VETTED_MCP.some((v) => v.preset === row.preset && v.endpoint.test(row.endpoint));
  return vetted && !WRITE_VERB.test(toolName);
}

export class McpSession {
  private sessionId: string | null = null;
  private nextId = 1;
  private protocolVersion = "2025-06-18";
  constructor(private row: IntegrationRow, private secret: string | null) {}

  private async rpc(method: string, params: Record<string, unknown>, notify = false): Promise<Record<string, unknown> | null> {
    if (!isSafeEndpoint(this.row.endpoint)) throw new Error("integration endpoint is not allowed");
    const id = notify ? 0 : this.nextId++;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": this.protocolVersion,
      ...authHeaders(this.row, this.secret),
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
    if (!(await resolvesToPublic(this.row.endpoint))) throw new Error("integration endpoint resolves to a non-public address");
    const res = await fetchWithTimeout(this.row.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (notify) return null;
    const text = await readCapped(res);
    if (res.status === 401 || res.status === 403) throw new Error(`${this.row.name}: 認証に失敗しました（${res.status}）`);
    if (!res.ok) throw new Error(`${this.row.name}: HTTP ${res.status} ${text.slice(0, 200)}`);
    const msg = parseRpcBody(res.headers.get("content-type") ?? "", text, id);
    if (!msg) throw new Error(`${this.row.name}: unreadable MCP response`);
    if (msg.error) throw new Error(`${this.row.name}: ${JSON.stringify(msg.error).slice(0, 300)}`);
    return (msg.result as Record<string, unknown>) ?? {};
  }

  async initialize(): Promise<void> {
    const r = await this.rpc("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "alcon-agent", version: "1.0.0" },
    });
    if (r && typeof r.protocolVersion === "string") this.protocolVersion = r.protocolVersion;
    await this.rpc("notifications/initialized", {}, true).catch(() => {});
  }

  async listTools(): Promise<RemoteTool[]> {
    const out: RemoteTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {});
      const tools = Array.isArray(r?.tools) ? (r!.tools as Record<string, unknown>[]) : [];
      for (const t of tools) {
        if (typeof t.name !== "string") continue;
        const ann = (t.annotations ?? {}) as Record<string, unknown>;
        out.push({
          name: t.name,
          description: typeof t.description === "string" ? t.description : "",
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
          readOnly: ann.readOnlyHint === true && trustsReadOnlyHint(this.row, t.name),
        });
      }
      cursor = typeof r?.nextCursor === "string" ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    const content = Array.isArray(r?.content) ? (r!.content as Record<string, unknown>[]) : [];
    const text = content
      .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : JSON.stringify(c)))
      .join("\n") || (r?.structuredContent ? JSON.stringify(r.structuredContent) : "(empty result)");
    return { text: truncate(text), isError: r?.isError === true };
  }
}

// ── HTTP API ───────────────────────────────────────────────────────────────

export const HTTP_REQUEST_SCHEMA = {
  type: "object",
  properties: {
    method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
    path: { type: "string", description: "base URL からの相対パス（例: /tasks/123）" },
    query: { type: "object", additionalProperties: true },
    body: { description: "JSON の本文（POST / PUT / PATCH）" },
  },
  required: ["method", "path"],
  additionalProperties: false,
} as const;

export function httpIsRead(input: Record<string, unknown>): boolean {
  const m = String(input.method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

export async function callHttp(row: IntegrationRow, secret: string | null, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  if (!isSafeEndpoint(row.endpoint)) throw new Error("integration endpoint is not allowed");
  const method = String(input.method ?? "GET").toUpperCase();
  const url = resolveUnderBase(row.endpoint, String(input.path ?? ""), input.query as Record<string, unknown> | undefined);
  const headers: Record<string, string> = { accept: "application/json", ...authHeaders(row, secret) };
  let body: string | undefined;
  if (input.body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["content-type"] = "application/json";
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  }
  if (!(await resolvesToPublic(url))) throw new Error("integration endpoint resolves to a non-public address");
  const res = await fetchWithTimeout(url, { method, headers, body });
  const text = method === "HEAD" ? "" : await readCapped(res);
  return { text: truncate(`HTTP ${res.status}\n${text}`), isError: !res.ok };
}

// ── Credentials ────────────────────────────────────────────────────────────

/** The part of a service-role Supabase client resolveCredential uses. */
export interface CredentialStore {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    update(values: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }> };
  };
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

/** The Google OAuth client from the Edge secrets, or null until both are set. */
export function googleClientFromEnv(get: (key: string) => string | undefined): OAuthClientConfig | null {
  const clientId = get("GOOGLE_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = get("GOOGLE_OAUTH_CLIENT_SECRET")?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function envGet(key: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get(key);
}

/**
 * The credential to send for `row`, given the raw Vault value.
 *   none / bearer / header   the raw value as stored.
 *   oauth (github)           the access token as stored (it does not expire).
 *   oauth (google-drive)     the access token, refreshed through Google when
 *                            it expires within two minutes; the new token set
 *                            is saved with store_integration_oauth_token,
 *                            only if the stored refresh token is still the
 *                            one refreshed (otherwise the result is null).
 *                            When Google refuses the refresh token
 *                            (invalid_grant) the row's last_test becomes
 *                            oauth_expired and the result is null.
 * Any other OAuth row, a malformed secret or a missing OAuth client gives
 * null. A refresh that fails for another reason throws.
 */
export async function resolveCredential(
  admin: CredentialStore,
  row: IntegrationRow,
  raw: string | null,
  opts: { client?: OAuthClientConfig | null; fetchImpl?: FetchLike; now?: number } = {},
): Promise<string | null> {
  if (row.auth_type !== "oauth") return raw && raw.length > 0 ? raw : null;
  if (isGithubOAuthRow(row)) return parseGithubSecret(raw)?.access_token ?? null;
  if (!isGoogleDriveRow(row)) return null;
  const secret = parseOAuthSecret(raw);
  if (!secret) return null;
  const now = opts.now ?? Date.now();
  if (!needsRefresh(secret, now)) return secret.access_token;

  const client = opts.client !== undefined ? opts.client : googleClientFromEnv(envGet);
  if (!client) return null;
  const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: secret.refresh_token,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }).toString(),
  }, opts.fetchImpl);
  const text = await readCapped(res, 100_000);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      await admin.from("integrations").update({
        last_test: { ok: false, at: new Date(now).toISOString(), code: "oauth_expired", detail: "" },
      }).eq("id", row.id);
      return null;
    }
    throw new Error(`Google token refresh failed: HTTP ${res.status}${typeof body.error === "string" ? ` ${body.error.slice(0, 60)}` : ""}`);
  }
  const next = secretFromTokenResponse(body, now, secret);
  if (!next) throw new Error("Google token refresh returned no access token");
  // Written only over the token set this refresh started from: a reconnect
  // (perhaps with another account) or a revoke in the meantime wins, and this
  // run gets no token rather than one for a connection that has changed.
  const { data: written, error } = await admin.rpc("store_integration_oauth_token", {
    p_integration_id: row.id, p_secret: JSON.stringify(next), p_expected_refresh_hash: await sha256Hex(secret.refresh_token),
  });
  if (error) throw new Error("could not save the refreshed token");
  return written === false ? null : next.access_token;
}

/** Pure. True when a connection failed because its credential was refused
 *  (McpSession's 認証に失敗, an HTTP 401 / 403, or the service saying so). */
export function isAuthFailure(message: string): boolean {
  return /認証に失敗|\b(401|403)\b|unauthori[sz]ed|bad credentials|credential expired/i.test(message);
}

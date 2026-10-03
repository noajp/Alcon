// Calling a Space's external services on an agent's behalf.
//
// Two kinds, matching the integrations table:
//   mcp   a remote MCP server over Streamable HTTP. Its tools become the
//         agent's tools; readOnlyHint decides read vs write.
//   http  a REST API under one base URL. The agent gets one http_request tool
//         confined to that base; GET / HEAD are reads, the rest are writes.
//
// The secret is passed in by the caller (read from Vault with the service
// role) and only ever goes into the outgoing request's header. Endpoints are
// checked before every request: https only, no localhost / private / link-
// local hosts, and an http_request path can never leave its base URL.

export interface IntegrationRow {
  id: string;
  kind: "mcp" | "http";
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

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "manual" });
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
          readOnly: ann.readOnlyHint === true,
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
  const res = await fetchWithTimeout(url, { method, headers, body });
  const text = method === "HEAD" ? "" : await readCapped(res);
  return { text: truncate(`HTTP ${res.status}\n${text}`), isError: !res.ok };
}

import type { ToolResult } from "../_shared/boardTools.ts";
import { sanitizeName } from "../_shared/callerName.ts";

export { sanitizeName };

// The MCP wire protocol, stateless: every POST carries one JSON-RPC message
// (or a batch from an older client) and gets its answer in the response
// body. No session, no server-initiated stream — the server only answers
// initialize / ping / tools/list / tools/call, which is all a tool server
// needs. Pure: the HTTP entry (index.ts) supplies the tools and the caller.

export const SERVER_INFO = { name: "clayware", version: "0.2.0" } as const;

/** Newest first. An unknown requested version is answered with the newest. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const INSTRUCTIONS = [
  "Clayware の Domain → Object → Element と Initiative を、接続したユーザー本人の権限で読み書きする。",
  "書き込む前に listElements / findByText / getElement で対象の UUID を確かめる。ELE_PLT-003 のような display_id も受け付けるが、曖昧なら候補をユーザーに示す。",
  "Element に着手する前に、所属 Object に紐づく Initiative（getInitiative）で目的と成功条件を確かめる。",
  "ステータス: backlog / todo / in_progress / review / done / blocked / cancelled。優先度: urgent / high / medium / low。日付は YYYY-MM-DD。",
  "Element を進めるときは claimElement で着手を宣言し（断られたらその Element は進めない）、節目ごとに logProgress、最後に reportOutcome（completed / partial / blocked）で締める。権限を超える判断が要るときは blocked で人に判断を求める。session には作業ごとの名前を渡し、同じ値を使い続ける。",
  "Clayware の AI（Athena）がアプリでできることを、あなたが代わりに行う。Strategy・Object・Element・Table（tableData）・ファイル・ハーネス・記憶・ボードを読み書きできる。Clayware 側のモデルは呼ばれないので、考えて進めるのはあなた。",
  "仕事のやり方はハーネスに書いてある。始める前に listHarnesses / readHarness で該当するものを読み、それに従う。",
  "書き込みは接続元の AI 名で記録される。削除・一括変更・上書きは、何が変わるかをユーザーに示して了解を得てから行う。judge / decide / approve / answer の Element は人の判断なので、代わりに閉じず reportOutcome の blocked で人に回す。",
].join("\n");

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export interface ToolHost {
  tools: readonly McpTool[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

type Id = string | number | null;
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
} as const;

function fail(id: Id, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Pure. The MCP-Protocol-Version header after initialize: absent is allowed
 * (older clients), an unsupported value is refused with 400.
 */
export function acceptsProtocolHeader(header: string | null): boolean {
  return header === null || (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(header);
}

export function negotiateVersion(requested: unknown): string {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(String(requested))
    ? String(requested)
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/**
 * One JSON-RPC message → its response, or null for a notification (no id)
 * or a client response, which the transport acknowledges with 202 and no body.
 */
export async function handleMessage(msg: unknown, host: ToolHost): Promise<JsonRpcResponse | null> {
  // A client's response (to a request this server never sends) is
  // acknowledged like a notification.
  if (isObject(msg) && msg.jsonrpc === "2.0" && msg.method === undefined && ("result" in msg || "error" in msg)) return null;
  if (!isObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isObject(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
    return fail(id, RPC.INVALID_REQUEST, "Invalid JSON-RPC request");
  }
  if (!("id" in msg) || msg.id === undefined) return null;
  const id = msg.id as Id;
  const params = isObject(msg.params) ? msg.params : {};

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: host.tools } };

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      // Only the listed tools are reachable: the shared modules also hold
      // deletes and bulk writes that this server does not offer.
      if (!host.tools.some((t) => t.name === name)) {
        return fail(id, RPC.INVALID_PARAMS, `Unknown tool: ${name || "(none)"}`);
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return fail(id, RPC.INVALID_PARAMS, "arguments must be an object");
      }
      const result = await host.call(name, (params.arguments as Record<string, unknown> | undefined) ?? {});
      return { jsonrpc: "2.0", id, result: toCallResult(result) };
    }

    default:
      return fail(id, RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/** A tool's outcome as MCP content. A refused write is a tool error the model reads, not a protocol error. */
export function toCallResult(result: ToolResult): { content: { type: "text"; text: string }[]; isError: boolean } {
  if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], isError: false };
}

/**
 * A POST body → the HTTP status and body to send. A body with only
 * notifications is acknowledged with 202 and nothing else.
 */
export async function handleBody(raw: string, host: ToolHost): Promise<{ status: number; body?: unknown }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: fail(null, RPC.PARSE_ERROR, "Parse error") };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { status: 400, body: fail(null, RPC.INVALID_REQUEST, "Empty batch") };
    const out: JsonRpcResponse[] = [];
    for (const m of parsed) {
      const r = await handleMessage(m, host);
      if (r) out.push(r);
    }
    return out.length ? { status: 200, body: out } : { status: 202 };
  }
  const r = await handleMessage(parsed, host);
  return r ? { status: 200, body: r } : { status: 202 };
}

const KNOWN_CLIENTS: [RegExp, string][] = [
  [/claude[-_ ]?code/i, "Claude Code"],
  [/claude/i, "Claude"],
  [/openai|chatgpt/i, "ChatGPT"],
  [/cursor/i, "Cursor"],
];

/**
 * Pure. The client a call came from: `?client=` on the connection URL when
 * the person set one, else the client recognised from its User-Agent.
 */
export function clientName(url: URL, userAgent: string | null): string {
  const explicit = sanitizeName(url.searchParams.get("client"));
  if (explicit) return explicit;
  const ua = userAgent ?? "";
  const known = KNOWN_CLIENTS.find(([re]) => re.test(ua));
  return known ? known[1] : "AI";
}

/** How the caller authenticated, when it adds to the record: a personal access token's name, or the OAuth client's. */
export interface ClientVia {
  token?: string | null;
  oauthClient?: string | null;
}

/**
 * Pure. The name an MCP write is recorded under: the client's name suffixed
 * "(MCP)" so the Activity rail says which door the change came through, and
 * how it signed in — "Claude Code (MCP · token: laptop)" for a personal
 * access token, "Claude (MCP · OAuth)" for an OAuth client, named as it
 * registered itself.
 */
export function clientLabel(url: URL, userAgent: string | null, via?: ClientVia | null): string {
  if (via && typeof via.oauthClient === "string") {
    const name = sanitizeName(via.oauthClient) || clientName(url, userAgent);
    return `${name} (MCP · OAuth)`;
  }
  const name = clientName(url, userAgent);
  if (via && typeof via.token === "string") {
    const token = sanitizeName(via.token);
    return token ? `${name} (MCP · token: ${token})` : `${name} (MCP · token)`;
  }
  return `${name} (MCP)`;
}

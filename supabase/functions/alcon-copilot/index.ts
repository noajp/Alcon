// alcon-copilot — the in-app "Alcon Copilot" backend.
//
// Streams an answer to a free-form user question with Claude tool-use over
// Server-Sent Events. The agent has read-only access to the user's
// Domains / Objects / Elements via a small tool set (see TOOLS below); the
// server runs the tools (with the user's auth so RLS gates every read) and
// loops back into the model until it produces a final answer.
//
// Request body:
//   {
//     messages:  Array<{ role: "user"|"assistant", content: string }>,
//     context?:  { viewLabel?: string; elementId?: string; objectId?: string; domainId?: string }
//   }
//
// Response: text/event-stream. Each event is JSON, prefixed by `event:` / `data:`.
//   event: text         → { delta: string }                  partial assistant text
//   event: tool_use     → { name: string; input: object }    a tool call started
//   event: tool_result  → { name: string; ok: boolean; rows?: number; error?: string }
//   event: done         → { stop_reason: string }            stream end
//   event: error        → { error: string }
//
// Auth: verify_jwt=true (Supabase Functions config). We forward the caller's
// JWT into a per-request Supabase client so all tool reads respect RLS — the
// Anthropic key is the only privileged secret on this function.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.1";

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const MAX_TURNS = 8;          // safety cap on the tool-use loop

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたは Alcon (work-management SaaS) の Copilot です。ユーザーの代わりに Domain / Object / Element の状況を把握し、進捗や検索の質問に答えます。

# できること
- Domain / Object / Element の一覧・検索・詳細取得
- ステータス集計（完了率、遅延件数、ステータス内訳）
- 最近の変更履歴の取得

# できないこと（このフェーズでは）
- 作成・更新・削除（ユーザーに「現在は読み取り専用です」と伝える）

# 進め方
1. 受け取った文脈チップ（現在の Domain / Object / Element）をデフォルトのスコープとして利用する。明示的に「全部の Domain」等と言われたらそちらを優先。
2. 質問に答えるのに必要な最小のツールだけ呼ぶ。最初から listElements を全件呼ばず、まず listMyDomains / listObjects でスコープを絞る。
3. 結果は簡潔な日本語で。Element を引用するときは ELE-NNN（例: ELE-021）、Object は「Object 名」、Status は短い英語ラベル（Todo / In Progress / Done / Blocked / Cancelled / Backlog / In Review）。
4. 表で見やすくなる場合は Markdown table を使う。リストは bullet で。
5. 「わかりません」「情報がありません」も正直に。ツールで取れなかったことを推測で埋めない。

# 重要
- ステータス値は内部表現: backlog / todo / in_progress / review / done / blocked / cancelled
- 日付は ISO 8601 (YYYY-MM-DD) で受け取り、必要に応じて「6/05」のような短縮表記で答える
- 全文検索は ILIKE ベース。完全一致ではなく部分一致前提。`;

// ──────────────────────────────────────────────────────────────────────────
// Tool definitions (the Claude side)
// Last tool carries cache_control so the whole tool block is cached.
// ──────────────────────────────────────────────────────────────────────────

type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: "ephemeral" };
};

const TOOLS: ToolDef[] = [
  {
    name: "listMyDomains",
    description: "ログイン中のユーザーが参加している Domain の一覧を返す。引数なし。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listObjects",
    description: "Domain 内の Object 一覧。domainId を省略すると、ユーザーが参加する全 Domain のものを返す。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain UUID (省略可)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "listElements",
    description: "Element を任意条件で一覧。デフォルトで最新 50 件、order_index asc。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain UUID で絞る" },
        objectId: { type: "string", description: "Object UUID で絞る" },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done", "blocked", "cancelled"],
        },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
        dueWithinDays: { type: "number", description: "今日から N 日以内に due のものに絞る" },
        overdueOnly: { type: "boolean", description: "true なら未完で due 過ぎたものだけ" },
        limit: { type: "number", description: "最大件数（既定 50、最大 200）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getElement",
    description: "Element 単体のフル詳細（subelements / labels / assignees / activity 抜粋を含む）",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Element UUID または ELE-NNN 形式の display_id" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "findByText",
    description: "title / description を部分一致検索する。クエリは短い日本語/英語 OK。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索クエリ" },
        domainId: { type: "string", description: "Domain で絞り込む場合のみ" },
        limit: { type: "number", description: "最大件数（既定 20、最大 100）" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "getProgress",
    description: "スコープ内のステータス内訳・完了率・遅延件数を返す。Domain か Object どちらかでスコープ指定。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string" },
        objectId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getRecentActivity",
    description: "最新の Element 更新（status / priority / title / due の変化）を返す。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string" },
        objectId: { type: "string" },
        limit: { type: "number", description: "既定 20、最大 50" },
      },
      additionalProperties: false,
    },
    cache_control: { type: "ephemeral" }, // ← last tool: caches the whole tool block
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Tool implementations (the server side, runs with the user's JWT → RLS gated)
// Each returns either { ok: true, data } or { ok: false, error }.
// ──────────────────────────────────────────────────────────────────────────

type ToolResult = { ok: true; data: unknown; meta?: { rows?: number } } | { ok: false; error: string };

async function runTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "listMyDomains": {
        const { data, error } = await supabase
          .from("domains")
          .select("id, name, prefix, created_at")
          .order("name");
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "listObjects": {
        let q = supabase
          .from("objects")
          .select("id, name, prefix, domain_id, order_index, created_at")
          .order("order_index", { ascending: true, nullsFirst: false });
        if (input.domainId) q = q.eq("domain_id", input.domainId as string);
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "listElements": {
        const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
        let q = supabase
          .from("elements")
          .select("id, display_id, seq_number, title, status, priority, type, due_date, object_id, order_index, updated_at")
          .order("order_index", { ascending: true, nullsFirst: false })
          .limit(limit);
        if (input.domainId) {
          const { data: objs } = await supabase
            .from("objects").select("id").eq("domain_id", input.domainId as string);
          const ids = (objs ?? []).map(o => o.id);
          if (ids.length === 0) return { ok: true, data: [], meta: { rows: 0 } };
          q = q.in("object_id", ids);
        }
        if (input.objectId) q = q.eq("object_id", input.objectId as string);
        if (input.status) q = q.eq("status", input.status as string);
        if (input.priority) q = q.eq("priority", input.priority as string);
        if (input.dueWithinDays != null) {
          const today = new Date(); today.setUTCHours(0,0,0,0);
          const end = new Date(today); end.setUTCDate(end.getUTCDate() + Number(input.dueWithinDays));
          q = q.gte("due_date", today.toISOString().slice(0,10))
               .lte("due_date", end.toISOString().slice(0,10));
        }
        if (input.overdueOnly) {
          const today = new Date().toISOString().slice(0,10);
          q = q.lt("due_date", today).not("status", "in", "(done,cancelled)");
        }
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "getElement": {
        const idArg = String(input.id ?? "");
        let elementId = idArg;
        // ELE-NNN style → look it up by display_id
        if (/^ELE-/i.test(idArg) || /^el_/i.test(idArg) || /-\d+$/.test(idArg)) {
          const candidates = [idArg, idArg.replace(/^ELE-/i, ""), `el_${idArg.replace(/^ELE-/i, "")}`];
          for (const c of candidates) {
            const { data: row } = await supabase
              .from("elements").select("id").or(`id.eq.${c},display_id.eq.${c}`).maybeSingle();
            if (row?.id) { elementId = row.id; break; }
          }
        }
        const { data: el, error } = await supabase
          .from("elements")
          .select("id, display_id, seq_number, title, description, status, priority, type, labels, due_date, due_time, estimate_hours, object_id, created_at, updated_at")
          .eq("id", elementId).maybeSingle();
        if (error) throw error;
        if (!el) return { ok: false, error: "Element not found" };
        const [subs, assignees] = await Promise.all([
          supabase.from("subelements")
            .select("id, seq_number, title, is_completed, order_index")
            .eq("element_id", elementId).order("order_index", { ascending: true }),
          supabase.from("element_assignees")
            .select("worker_id, worker:workers(id, name)")
            .eq("element_id", elementId),
        ]);
        return { ok: true, data: { ...el, subelements: subs.data ?? [], assignees: assignees.data ?? [] } };
      }

      case "findByText": {
        const query = String(input.query ?? "").trim();
        if (!query) return { ok: false, error: "query is required" };
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
        const pattern = `%${query.replace(/[\\%_]/g, m => "\\" + m)}%`;
        let q = supabase
          .from("elements")
          .select("id, display_id, seq_number, title, status, priority, object_id, updated_at")
          .or(`title.ilike.${pattern},description.ilike.${pattern},display_id.ilike.${pattern}`)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (input.domainId) {
          const { data: objs } = await supabase
            .from("objects").select("id").eq("domain_id", input.domainId as string);
          const ids = (objs ?? []).map(o => o.id);
          if (ids.length === 0) return { ok: true, data: [], meta: { rows: 0 } };
          q = q.in("object_id", ids);
        }
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "getProgress": {
        // Scope to objectId, or to all objects in domainId, or "all visible" if neither.
        let objectIds: string[] | null = null;
        if (input.objectId) objectIds = [input.objectId as string];
        else if (input.domainId) {
          const { data: objs } = await supabase
            .from("objects").select("id").eq("domain_id", input.domainId as string);
          objectIds = (objs ?? []).map(o => o.id);
          if (objectIds.length === 0) {
            return { ok: true, data: { total: 0, byStatus: {}, completionRate: 0, overdue: 0 } };
          }
        }
        let q = supabase.from("elements").select("status, due_date", { count: "exact" });
        if (objectIds) q = q.in("object_id", objectIds);
        const { data, error } = await q;
        if (error) throw error;
        const byStatus: Record<string, number> = {};
        const today = new Date().toISOString().slice(0,10);
        let overdue = 0;
        for (const r of data ?? []) {
          const s = r.status ?? "todo";
          byStatus[s] = (byStatus[s] ?? 0) + 1;
          if (r.due_date && r.due_date < today && s !== "done" && s !== "cancelled") overdue++;
        }
        const total = data?.length ?? 0;
        const done = byStatus["done"] ?? 0;
        const completionRate = total === 0 ? 0 : Math.round((done / total) * 100);
        return { ok: true, data: { total, byStatus, completionRate, overdue }, meta: { rows: total } };
      }

      case "getRecentActivity": {
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
        let q = supabase
          .from("elements")
          .select("id, display_id, title, status, priority, updated_at, object_id")
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (input.domainId) {
          const { data: objs } = await supabase
            .from("objects").select("id").eq("domain_id", input.domainId as string);
          const ids = (objs ?? []).map(o => o.id);
          if (ids.length === 0) return { ok: true, data: [], meta: { rows: 0 } };
          q = q.in("object_id", ids);
        }
        if (input.objectId) q = q.eq("object_id", input.objectId as string);
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HTTP entry — SSE stream + tool-use loop
// ──────────────────────────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anthropicKey || !supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: "server env not configured" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing Authorization header" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    context?: { viewLabel?: string; elementId?: string; objectId?: string; domainId?: string };
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Per-request Supabase client with the user's JWT → RLS sees auth.uid().
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const client = new Anthropic({ apiKey: anthropicKey });

  const ctx = body.context ?? {};
  const contextHint = [
    ctx.viewLabel ? `現在のビュー: ${ctx.viewLabel}` : null,
    ctx.elementId ? `現在の Element: ${ctx.elementId}` : null,
    ctx.objectId ? `現在の Object: ${ctx.objectId}` : null,
    ctx.domainId ? `現在の Domain: ${ctx.domainId}` : null,
  ].filter(Boolean).join("\n");

  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (contextHint) {
    systemBlocks.push({ type: "text", text: `# 現在の文脈\n${contextHint}\n（明示されない限りこのスコープを優先してください）` });
  }

  // Multi-turn message accumulator. We keep raw content blocks for assistant
  // turns so tool_use ids match in the next request.
  type AnyMsg = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };
  const messages: AnyMsg[] = body.messages.map(m => ({ role: m.role, content: m.content }));

  // Build the SSE response stream.
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          // ── Stream this turn ─────────────────────────────────────────────
          const turnContent: AnthropicContentBlock[] = [];
          let textBuf = "";
          let stopReason: string | null = null;
          let currentBlock: AnthropicContentBlock | null = null;
          let currentJson = "";

          const apiStream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemBlocks,
            // deno-lint-ignore no-explicit-any
            tools: TOOLS as any,
            // deno-lint-ignore no-explicit-any
            messages: messages as any,
          });

          for await (const ev of apiStream) {
            if (ev.type === "content_block_start") {
              currentBlock = { ...(ev.content_block as AnthropicContentBlock) };
              currentJson = "";
              if (currentBlock.type === "tool_use") {
                send("tool_use", { name: currentBlock.name, input: currentBlock.input ?? {} });
              }
            } else if (ev.type === "content_block_delta") {
              // deno-lint-ignore no-explicit-any
              const d = (ev as any).delta;
              if (d?.type === "text_delta" && d.text) {
                textBuf += d.text;
                send("text", { delta: d.text });
              } else if (d?.type === "input_json_delta" && d.partial_json) {
                currentJson += d.partial_json;
              }
            } else if (ev.type === "content_block_stop") {
              if (currentBlock) {
                if (currentBlock.type === "tool_use") {
                  try { currentBlock.input = JSON.parse(currentJson || "{}"); }
                  catch { currentBlock.input = {}; }
                } else if (currentBlock.type === "text") {
                  currentBlock.text = textBuf;
                  textBuf = "";
                }
                turnContent.push(currentBlock);
                currentBlock = null;
              }
            } else if (ev.type === "message_delta") {
              // deno-lint-ignore no-explicit-any
              stopReason = (ev as any).delta?.stop_reason ?? stopReason;
            }
          }

          // Assistant's reply for this turn → push into messages.
          messages.push({ role: "assistant", content: turnContent });

          // Final answer? we're done.
          if (stopReason !== "tool_use") {
            send("done", { stop_reason: stopReason ?? "end_turn" });
            controller.close();
            return;
          }

          // ── Tool loop: run every tool_use block & feed results back ────
          const toolResults: AnthropicContentBlock[] = [];
          for (const block of turnContent) {
            if (block.type !== "tool_use") continue;
            const result = await runTool(supabase, block.name!, (block.input ?? {}) as Record<string, unknown>);
            send("tool_result", {
              name: block.name,
              ok: result.ok,
              rows: result.ok ? result.meta?.rows : undefined,
              error: result.ok ? undefined : result.error,
            });
            toolResults.push({
              type: "tool_result",
              // deno-lint-ignore no-explicit-any
              ...( { tool_use_id: block.id, content: JSON.stringify(result.ok ? result.data : { error: result.error }) } as any),
            });
          }
          messages.push({ role: "user", content: toolResults });
          // → loop back to next turn
        }

        // Hit MAX_TURNS without end_turn — bail.
        send("error", { error: `max turns (${MAX_TURNS}) reached without final answer` });
        controller.close();
      } catch (e) {
        send("error", { error: e instanceof Error ? e.message : String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});

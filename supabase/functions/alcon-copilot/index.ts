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

const SYSTEM_PROMPT = `あなたは Alcon (work-management SaaS) の Copilot です。ユーザーの代わりに Domain / Object / Element を読み書き（作成・更新・削除・移動・アサイン）します。

# できること
- 読み: 一覧 / 検索 / 詳細 / 進捗集計 / 履歴 / Worker 一覧
- Element: 作成 / 更新 / 削除 / 別 Object へ移動 / multi-home 追加・解除
- Subelement: 作成 / 完了切替 / 更新 / 削除
- Object: 作成 / 更新 / 削除
- 関連: assignee の追加・削除 / labels 設定 / comment 投稿
- Bulk: 複数 Element の一括更新・一括削除

# 進め方
1. 受け取った文脈チップ（現在の Domain / Object / Element）をデフォルトのスコープにする。
2. **書き込み前に必ず UUID を取得**してから write tool を呼ぶ。
   理由: ユーザーは「ELE-024」のように seq だけで呼ぶことが多いが、同じ番号は複数 Object に存在しうる（Phase 1 の ELE-001、Phase 2 の ELE-001 ...）。文脈の Object/Domain で絞った UUID を持つこと。
   実装: まず listElements か findByText を呼んで一意の UUID を取得 → その UUID で write tool を呼ぶ。"ELE-NNN" 形式を直接 write tool に渡さない。
3. 一意に絞れない時は候補を提示してユーザーに確認を求める（例: 「Phase 1 と Phase 2 に ELE-001 があります。どちら?」）。曖昧なまま勝手に選ばない。
4. 破壊的操作（delete / 大量 update）は実行前に簡潔に予告してから即実行（Auto モード）。後から Undo は別途用意される。
5. 1 ターン内で複数 Write は可。例: 5 件作成 → createElement × 5 を並行発行。
6. 結果は簡潔な日本語。Element は ELE-NNN（例: ELE-021）、Status は短い英語ラベル（Todo / In Progress / Done / Blocked / Cancelled / Backlog / In Review）。表で見やすい場合は Markdown table。

# エラーリカバリ
- "Element not found" → 即座にユーザーに聞き直さず、まず listElements か findByText でスコープを広げて検索する。それでも 0 件なら確認を求める。
- "no resolvable Element ids" (bulk) → 同様に listElements で id を取り直してリトライ。

# 重要
- ステータス値: backlog / todo / in_progress / review / done / blocked / cancelled
- Priority: urgent / high / medium / low
- 日付は ISO 8601 (YYYY-MM-DD)。回答時は必要に応じて「6/05」等に短縮可。
- ID は UUID または display_id（ELE-NNN）どちらでも受け取れるが、write 側には UUID を渡すこと
- listObjects / listElements は cache 効くので、書き込み前後で再取得しても安い
- 全文検索は ILIKE / 部分一致
- 操作が失敗したら error メッセージを読んで原因（権限不足 / 必須項目欠落 / 存在しない id 等）をユーザーに伝える`;

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
  },
  {
    name: "listWorkers",
    description: "Worker (担当者) の一覧。assignee 追加・削除の時にこの id を渡す。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain で絞る場合のみ" },
      },
      additionalProperties: false,
    },
  },

  // ── Write: Element ──────────────────────────────────────────────────────
  {
    name: "createElement",
    description: "Element を新規作成する。primary object_id を必須に取り、element_objects junction にも自動で 1 行入る。",
    input_schema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "親 Object UUID（必須）" },
        title: { type: "string", description: "Element タイトル（必須）" },
        description: { type: "string" },
        status: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done", "blocked", "cancelled"] },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
        type: { type: "string", description: "Element type 名（Domain に既存のもの推奨）" },
        due_date: { type: "string", description: "ISO 8601 YYYY-MM-DD" },
        labels: { type: "array", items: { type: "string" } },
        assigneeWorkerIds: { type: "array", items: { type: "string" }, description: "初期アサインの worker id 群" },
      },
      required: ["objectId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "updateElement",
    description: "Element を更新する。指定したフィールドだけ patch。status を done にすると progress=100 に正規化される。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element id (UUID または ELE-NNN)" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done", "blocked", "cancelled"] },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
        type: { type: "string" },
        due_date: { type: "string", description: "ISO 8601 YYYY-MM-DD。null で解除" },
        estimate_hours: { type: "number" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteElement",
    description: "Element を削除する。subelements と element_objects は CASCADE で消える（DB 制約に従う）。破壊的なので必ず予告してから呼ぶ。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Element id (UUID または ELE-NNN)" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "moveElement",
    description: "Element の primary object_id を変更し、element_objects も新 Object 1 件に張り替える。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element id (UUID または ELE-NNN)" },
        targetObjectId: { type: "string", description: "移動先 Object UUID" },
      },
      required: ["id", "targetObjectId"],
      additionalProperties: false,
    },
  },
  {
    name: "linkElementToObject",
    description: "Element を別 Object にも multi-home する（element_objects に追加）。既にリンク済みなら no-op。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element id" },
        objectId: { type: "string", description: "追加先 Object UUID" },
      },
      required: ["id", "objectId"],
      additionalProperties: false,
    },
  },
  {
    name: "unlinkElementFromObject",
    description: "Element の multi-home リンクを 1 本解除する。それが唯一のホームで primary なら拒否される。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element id" },
        objectId: { type: "string", description: "解除する Object UUID" },
      },
      required: ["id", "objectId"],
      additionalProperties: false,
    },
  },

  // ── Write: Subelement ───────────────────────────────────────────────────
  {
    name: "createSubelement",
    description: "Subelement (チェックリスト 1 行) を Element の下に作成する。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "親 Element id" },
        title: { type: "string" },
      },
      required: ["elementId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "toggleSubelementComplete",
    description: "Subelement の完了状態をトグル、または指定値にセット。isCompleted を渡さない時は反転。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Subelement UUID" },
        isCompleted: { type: "boolean", description: "省略時は現在値を反転" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "updateSubelement",
    description: "Subelement のタイトル / 完了状態を更新。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Subelement UUID" },
        title: { type: "string" },
        is_completed: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteSubelement",
    description: "Subelement を削除。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Subelement UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
  },

  // ── Write: Object ───────────────────────────────────────────────────────
  {
    name: "createObject",
    description: "Domain 内に新しい Object を作成する。",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain UUID" },
        name: { type: "string" },
        prefix: { type: "string", description: "Element 採番用プレフィックス（任意）" },
        description: { type: "string" },
      },
      required: ["domainId", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "updateObject",
    description: "Object を更新（name / prefix / description）。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Object UUID" },
        name: { type: "string" },
        prefix: { type: "string" },
        description: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteObject",
    description: "Object を削除。配下の Element もまとめて消える可能性があるので必ず予告。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Object UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
  },

  // ── Write: Assignee / Labels / Comment ──────────────────────────────────
  {
    name: "addElementAssignee",
    description: "Element に Worker をアサイン（element_assignees に追加）。既にアサイン済みなら no-op。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        workerId: { type: "string", description: "Worker UUID" },
      },
      required: ["elementId", "workerId"],
      additionalProperties: false,
    },
  },
  {
    name: "removeElementAssignee",
    description: "Element から Worker のアサインを解除。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        workerId: { type: "string", description: "Worker UUID" },
      },
      required: ["elementId", "workerId"],
      additionalProperties: false,
    },
  },
  {
    name: "setElementLabels",
    description: "Element の labels 配列を完全置き換え。既存を消して新しい配列に。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element id" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["id", "labels"],
      additionalProperties: false,
    },
  },
  {
    name: "addElementComment",
    description: "Element にコメントを投稿する。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        body: { type: "string", description: "コメント本文 (Markdown 可)" },
      },
      required: ["elementId", "body"],
      additionalProperties: false,
    },
  },

  // ── Write: Bulk ─────────────────────────────────────────────────────────
  {
    name: "bulkUpdateElements",
    description: "複数 Element を同じ patch で一括更新（status / priority / type / due_date / labels）。",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Element id 配列 (UUID / ELE-NNN 混在可)" },
        status: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done", "blocked", "cancelled"] },
        priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
        type: { type: "string" },
        due_date: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "bulkDeleteElements",
    description: "複数 Element を一括削除。破壊的なので必ず予告してから呼ぶ。",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Element id 配列 (UUID / ELE-NNN 混在可)" },
      },
      required: ["ids"],
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

// Resolve an Element identifier into the canonical UUID. The function tries
// the increasingly forgiving forms the user might pass:
//   1. UUID — return as-is.
//   2. Exact display_id match (handles both `ELE-024` and `el_P1—FP-024`).
//   3. The `el_…` prefix toggled on / off, since the user shouldn't have to
//      remember it.
//   4. Bare sequence number (e.g. "ELE-024" / "024"): look for a display_id
//      ending in `-024`. Only counts as a hit when EXACTLY one Element
//      matches — otherwise we'd silently grab the wrong row.
// Returns null when nothing visible to this user (RLS scope) matches.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function resolveElementId(supabase: SupabaseClient, idArg: string): Promise<string | null> {
  const v = String(idArg ?? "").trim();
  if (!v) return null;
  if (UUID_RE.test(v)) return v;

  const stripped = v.replace(/^ELE-/i, "");
  const candidates = Array.from(new Set([v, stripped, `el_${stripped}`, `el_${v}`]));
  for (const c of candidates) {
    const { data } = await supabase
      .from("elements").select("id").or(`id.eq.${c},display_id.eq.${c}`).maybeSingle();
    if (data?.id) return data.id as string;
  }

  // Numeric fallback — e.g. user typed `ELE-024`. Element display_ids are
  // shaped `el_PREFIX-NNN`, so any row whose display_id ends in `-024` is a
  // candidate. Accept only when one Element across the user's visible scope
  // matches (RLS already trims to what they can see).
  const seqMatch = stripped.match(/^(\d{1,4})$/);
  if (seqMatch) {
    const seqStr = seqMatch[1].padStart(3, "0");
    const { data } = await supabase
      .from("elements").select("id").ilike("display_id", `%-${seqStr}`).limit(2);
    if (data?.length === 1) return data[0].id as string;
  }
  return null;
}

// "done" → progress 100; "todo" / "backlog" → null. Mirrors the client's
// updateElement normalization so the mark stays in sync.
function normalizeStatusPatch(patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.status === "done") return { ...patch, progress: 100 };
  if (patch.status === "todo" || patch.status === "backlog") return { ...patch, progress: null };
  return patch;
}

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
        const elementId = await resolveElementId(supabase, String(input.id ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
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

      case "listWorkers": {
        let q = supabase.from("workers").select("id, name, kind, email").order("name");
        if (input.domainId) {
          // domain_members holds user_id; map → workers via workers.user_id.
          const { data: members } = await supabase
            .from("domain_members").select("user_id").eq("domain_id", input.domainId as string);
          const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
          if (userIds.length === 0) return { ok: true, data: [], meta: { rows: 0 } };
          q = q.in("user_id", userIds);
        }
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      // ── Write: Element ────────────────────────────────────────────────
      case "createElement": {
        const objectId = String(input.objectId ?? "");
        const title = String(input.title ?? "").trim();
        if (!objectId) return { ok: false, error: "objectId is required" };
        if (!title) return { ok: false, error: "title is required" };
        const payload: Record<string, unknown> = { object_id: objectId, title };
        for (const k of ["description", "status", "priority", "type", "due_date"]) {
          if (input[k] !== undefined) payload[k] = input[k];
        }
        if (Array.isArray(input.labels)) payload.labels = input.labels;
        const normalized = normalizeStatusPatch(payload);
        const { data, error } = await supabase
          .from("elements")
          .insert(normalized)
          .select("id, display_id, seq_number, title, status, priority, object_id")
          .single();
        if (error) throw error;
        // multi-home junction (primary entry)
        await supabase.from("element_objects").insert({
          element_id: data.id, object_id: objectId, order_index: 0,
        }).then(() => {}, () => {});
        // initial assignees
        if (Array.isArray(input.assigneeWorkerIds) && input.assigneeWorkerIds.length > 0) {
          const rows = (input.assigneeWorkerIds as string[]).map((wid) => ({
            element_id: data.id, worker_id: wid,
          }));
          await supabase.from("element_assignees").insert(rows).then(() => {}, () => {});
        }
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "updateElement": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const patch: Record<string, unknown> = {};
        for (const k of ["title", "description", "status", "priority", "type", "due_date", "due_time", "estimate_hours"]) {
          if (input[k] !== undefined) patch[k] = input[k];
        }
        if (Array.isArray(input.labels)) patch.labels = input.labels;
        if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
        const normalized = normalizeStatusPatch(patch);
        const { data, error } = await supabase
          .from("elements").update(normalized).eq("id", id)
          .select("id, display_id, title, status, priority").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "deleteElement": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const { error } = await supabase.from("elements").delete().eq("id", id);
        if (error) throw error;
        return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
      }

      case "moveElement": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const targetObjectId = String(input.targetObjectId ?? "");
        if (!targetObjectId) return { ok: false, error: "targetObjectId is required" };
        const { error: elErr } = await supabase
          .from("elements").update({ object_id: targetObjectId }).eq("id", id);
        if (elErr) throw elErr;
        // refresh the multi-home junction so the new primary is the only link
        await supabase.from("element_objects").delete().eq("element_id", id);
        await supabase.from("element_objects").insert({
          element_id: id, object_id: targetObjectId, order_index: 0,
        });
        return { ok: true, data: { id, targetObjectId }, meta: { rows: 1 } };
      }

      case "linkElementToObject": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const objectId = String(input.objectId ?? "");
        if (!objectId) return { ok: false, error: "objectId is required" };
        const { data: existing } = await supabase
          .from("element_objects").select("element_id")
          .eq("element_id", id).eq("object_id", objectId).maybeSingle();
        if (existing) return { ok: true, data: { id, objectId, already: true }, meta: { rows: 0 } };
        const { error } = await supabase
          .from("element_objects").insert({ element_id: id, object_id: objectId });
        if (error) throw error;
        return { ok: true, data: { id, objectId }, meta: { rows: 1 } };
      }

      case "unlinkElementFromObject": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const objectId = String(input.objectId ?? "");
        if (!objectId) return { ok: false, error: "objectId is required" };
        const { data: el } = await supabase
          .from("elements").select("object_id").eq("id", id).maybeSingle();
        const { data: links } = await supabase
          .from("element_objects").select("object_id").eq("element_id", id);
        if (el?.object_id === objectId && (links?.length ?? 0) <= 1) {
          return { ok: false, error: "cannot remove the only home of an Element; move it first" };
        }
        const { error } = await supabase
          .from("element_objects").delete()
          .eq("element_id", id).eq("object_id", objectId);
        if (error) throw error;
        return { ok: true, data: { id, objectId }, meta: { rows: 1 } };
      }

      // ── Write: Subelement ─────────────────────────────────────────────
      case "createSubelement": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        const title = String(input.title ?? "").trim();
        if (!title) return { ok: false, error: "title is required" };
        const { data, error } = await supabase
          .from("subelements").insert({ element_id: elementId, title })
          .select("id, seq_number, title, is_completed").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "toggleSubelementComplete": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        let nextValue: boolean;
        if (input.isCompleted !== undefined) {
          nextValue = !!input.isCompleted;
        } else {
          const { data: cur } = await supabase
            .from("subelements").select("is_completed").eq("id", id).maybeSingle();
          if (!cur) return { ok: false, error: "Subelement not found" };
          nextValue = !cur.is_completed;
        }
        const { data, error } = await supabase
          .from("subelements").update({ is_completed: nextValue }).eq("id", id)
          .select("id, title, is_completed").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "updateSubelement": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const patch: Record<string, unknown> = {};
        if (input.title !== undefined) patch.title = String(input.title);
        if (input.is_completed !== undefined) patch.is_completed = !!input.is_completed;
        if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
        const { data, error } = await supabase
          .from("subelements").update(patch).eq("id", id)
          .select("id, title, is_completed").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "deleteSubelement": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const { error } = await supabase.from("subelements").delete().eq("id", id);
        if (error) throw error;
        return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
      }

      // ── Write: Object ─────────────────────────────────────────────────
      case "createObject": {
        const domainId = String(input.domainId ?? "");
        const name = String(input.name ?? "").trim();
        if (!domainId) return { ok: false, error: "domainId is required" };
        if (!name) return { ok: false, error: "name is required" };
        const payload: Record<string, unknown> = { domain_id: domainId, name };
        for (const k of ["prefix", "description"]) {
          if (input[k] !== undefined) payload[k] = input[k];
        }
        const { data, error } = await supabase
          .from("objects").insert(payload)
          .select("id, name, prefix, domain_id").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "updateObject": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const patch: Record<string, unknown> = {};
        for (const k of ["name", "prefix", "description"]) {
          if (input[k] !== undefined) patch[k] = input[k];
        }
        if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
        const { data, error } = await supabase
          .from("objects").update(patch).eq("id", id)
          .select("id, name, prefix").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "deleteObject": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const { error } = await supabase.from("objects").delete().eq("id", id);
        if (error) throw error;
        return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
      }

      // ── Write: Assignee / Labels / Comment ────────────────────────────
      case "addElementAssignee": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        const workerId = String(input.workerId ?? "");
        if (!workerId) return { ok: false, error: "workerId is required" };
        const { data: existing } = await supabase
          .from("element_assignees").select("element_id")
          .eq("element_id", elementId).eq("worker_id", workerId).maybeSingle();
        if (existing) return { ok: true, data: { elementId, workerId, already: true }, meta: { rows: 0 } };
        const { error } = await supabase
          .from("element_assignees").insert({ element_id: elementId, worker_id: workerId });
        if (error) throw error;
        return { ok: true, data: { elementId, workerId }, meta: { rows: 1 } };
      }

      case "removeElementAssignee": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        const workerId = String(input.workerId ?? "");
        if (!workerId) return { ok: false, error: "workerId is required" };
        const { error } = await supabase
          .from("element_assignees").delete()
          .eq("element_id", elementId).eq("worker_id", workerId);
        if (error) throw error;
        return { ok: true, data: { elementId, workerId, removed: true }, meta: { rows: 1 } };
      }

      case "setElementLabels": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const labels = Array.isArray(input.labels) ? input.labels : [];
        const { data, error } = await supabase
          .from("elements").update({ labels }).eq("id", id)
          .select("id, labels").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "addElementComment": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        const body = String(input.body ?? "").trim();
        if (!body) return { ok: false, error: "body is required" };
        const { data, error } = await supabase
          .from("element_comments").insert({ element_id: elementId, body })
          .select("id, body, created_at").single();
        if (error) throw error;
        return { ok: true, data, meta: { rows: 1 } };
      }

      // ── Write: Bulk ───────────────────────────────────────────────────
      case "bulkUpdateElements": {
        const idsRaw = Array.isArray(input.ids) ? input.ids as string[] : [];
        if (idsRaw.length === 0) return { ok: false, error: "ids required" };
        const patch: Record<string, unknown> = {};
        for (const k of ["status", "priority", "type", "due_date"]) {
          if (input[k] !== undefined) patch[k] = input[k];
        }
        if (Array.isArray(input.labels)) patch.labels = input.labels;
        if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
        const resolved: string[] = [];
        for (const v of idsRaw) {
          const r = await resolveElementId(supabase, v);
          if (r) resolved.push(r);
        }
        if (resolved.length === 0) return { ok: false, error: "no resolvable Element ids" };
        const normalized = normalizeStatusPatch(patch);
        const { data, error } = await supabase
          .from("elements").update(normalized).in("id", resolved)
          .select("id, display_id, status, priority");
        if (error) throw error;
        return { ok: true, data: { updated: data?.length ?? 0, patch: normalized, items: data ?? [] }, meta: { rows: data?.length ?? 0 } };
      }

      case "bulkDeleteElements": {
        const idsRaw = Array.isArray(input.ids) ? input.ids as string[] : [];
        if (idsRaw.length === 0) return { ok: false, error: "ids required" };
        const resolved: string[] = [];
        for (const v of idsRaw) {
          const r = await resolveElementId(supabase, v);
          if (r) resolved.push(r);
        }
        if (resolved.length === 0) return { ok: false, error: "no resolvable Element ids" };
        const { error } = await supabase.from("elements").delete().in("id", resolved);
        if (error) throw error;
        return { ok: true, data: { deleted: resolved.length, ids: resolved }, meta: { rows: resolved.length } };
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

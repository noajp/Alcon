import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { basisIds, bindBasis } from "./elementBasis.ts";

// Board tools — Domain / Object / Element / Sub-element reads and writes that
// run with the caller's JWT, so RLS decides what each call can see and touch.
//
// Shared by the in-app Copilot (alcon-copilot) and the MCP server
// (alcon-mcp). Each entry exposes the subset it wants by name; a write the
// entry does not list cannot be reached from it.

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolResult =
  | { ok: true; data: unknown; meta?: { rows?: number; nextOffset?: number | null; total?: number | null } }
  | { ok: false; error: string };

/**
 * Who is writing. `agent` is the AI's label ("Alcon Copilot",
 * "Claude Code (MCP)"): the comment author, and named in each Activity line.
 * `userId` is the person whose JWT the call runs under, so a comment stays
 * traceable to who delegated it.
 */
export interface BoardActor {
  agent: string;
  userId: string | null;
}

export const BOARD_TOOLS: ToolDef[] = [
  {
    name: "listMyDomains",
    description: "ログイン中のユーザーが参加している Domain の一覧を返す。引数なし。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listObjects",
    description: "Domain 内の Object 一覧。domainId を省略すると、ユーザーが参加する全 Domain のものを返す。アーカイブした Object は含まない。",
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
    description: "Element 単体のフル詳細（Sub-element（この Element を親に持つ Element）/ labels / assignees / 所属 Object / 直近のコメント10件を含む）",
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
    description: "担当にできる Worker の一覧。assignee 追加・削除の時にこの id を渡す。担当にできるのは Element と同じ Space の人と AI だけ。elementId を渡すと、その Element に実際に割り当てられる Worker だけを返す。引数なしなら、自分が属する Space 全体の Worker。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "この Element に割り当てられる Worker だけ（uuid または display_id）" },
        objectId: { type: "string", description: "この Object の Domain を見られる人に絞る" },
        domainId: { type: "string", description: "この Domain を見られる人に絞る" },
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
        basisIntentIds: { type: "array", items: { type: "string" }, description: "この Element が何のためにあるか：根拠にする Strategy の成功条件・前提・意思決定の intent id（getInitiative で読んだもの）。Strategy が変わったとき、影響を受ける Element を見つけるのに使う" },
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
        estimated_hours: { type: "number" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteElement",
    description: "Element を削除する。Sub-element（子の Element）と element_objects は CASCADE で消える（DB 制約に従う）。破壊的なので必ず予告してから呼ぶ。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Element id (UUID または ELE-NNN)" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "moveElement",
    description: "Element の primary object_id を変更する。element_objects の primary 行はトリガが追従し、他の multi-home 先は残る。",
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
    description: "Element の multi-home リンクを 1 本解除する。それが唯一のホームなら拒否され、primary のホームなら残る別のホームが primary になる。",
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

  // ── Write: Sub-element (an Element under another) ───────────────────────
  {
    name: "createSubelement",
    description: "Sub-element を Element の下に作成する。Sub-element は親 Element（parent_id）を持つ普通の Element で、親と同じ Object に入る。",
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
    description: "Sub-element を完了（status done）/ 再開（status todo）する。isCompleted を渡さない時は反転。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Sub-element の Element UUID" },
        isCompleted: { type: "boolean", description: "省略時は現在値を反転" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "updateSubelement",
    description: "Sub-element のタイトル / 完了状態を更新。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Sub-element の Element UUID" },
        title: { type: "string" },
        isCompleted: { type: "boolean", description: "true で status done、false で todo" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteSubelement",
    description: "Sub-element を削除。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Sub-element の Element UUID" } },
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
  },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure. The display_ids a person might mean by what they typed. Element
 * display_ids are `ELE_PREFIX-NNN` (older rows `el_PREFIX-NNN`); people type
 * `PLT-003`, `plt-003`, `ELE-003` or the full id, so each form maps to the
 * stored spellings it could stand for.
 */
export function displayIdCandidates(raw: string): string[] {
  const v = raw.trim();
  if (!v) return [];
  const out = new Set<string>([v]);
  const bare = v.replace(/^(ELE_|el_|ELE-)/i, "");
  for (const body of [bare, bare.toUpperCase()]) {
    out.add(body);
    out.add(`ELE_${body}`);
    out.add(`el_${body}`);
  }
  return [...out];
}

// Resolve an Element identifier into the canonical UUID:
//   1. UUID — when the caller can see that Element.
//   2. A display_id in any of the spellings displayIdCandidates() knows.
//   3. Bare sequence number ("024", "ELE-024"): a display_id ending in
//      `-024`, only when EXACTLY one visible Element matches — otherwise we'd
//      silently grab the wrong row.
// Returns null when nothing visible to this user (RLS scope) matches.
// display_id is matched on its own column: an `id.eq.<display_id>` filter
// makes Postgres reject the whole query as an invalid uuid.
export async function resolveElementId(supabase: SupabaseClient, idArg: string): Promise<string | null> {
  return (await resolveElementIdTraced(supabase, idArg)).id;
}

/** The stage a resolution reached: the last lookup it ran. A failure's
 *  stage says WHERE the identifier died — a UUID the session cannot see
 *  (stage "uuid") is a different defect from a display spelling nothing
 *  answers to ("display") or a sequence number that matched nothing or
 *  too much ("sequence") — and until failures recorded it, a failed
 *  write-back was undiagnosable: the argument was recorded nowhere. */
export type ResolveStage = "empty" | "uuid" | "display" | "sequence";

export interface TracedResolution {
  id: string | null;
  stage: ResolveStage;
}

/** resolveElementId, reporting the stage it reached either way. */
export async function resolveElementIdTraced(supabase: SupabaseClient, idArg: string): Promise<TracedResolution> {
  const v = String(idArg ?? "").trim();
  if (!v) return { id: null, stage: "empty" };
  // A UUID is checked too: some child tables (element_comments) are wider
  // than elements under RLS, so an id the caller cannot see must not pass.
  if (UUID_RE.test(v)) {
    const { data } = await supabase.from("elements").select("id").eq("id", v).maybeSingle();
    return { id: (data?.id as string | undefined) ?? null, stage: "uuid" };
  }

  const { data: hits } = await supabase
    .from("elements").select("id").in("display_id", displayIdCandidates(v)).limit(2);
  if (hits?.length === 1) return { id: hits[0].id as string, stage: "display" };
  if ((hits?.length ?? 0) > 1) return { id: null, stage: "display" };

  const seqMatch = v.replace(/^(ELE_|el_|ELE-)/i, "").match(/^(\d{1,4})$/);
  if (seqMatch) {
    const seqStr = seqMatch[1].padStart(3, "0");
    const { data } = await supabase
      .from("elements").select("id").ilike("display_id", `%-${seqStr}`).limit(2);
    return { id: data?.length === 1 ? data[0].id as string : null, stage: "sequence" };
  }
  return { id: null, stage: "display" };
}

/**
 * The visible parent of a Sub-element (an Element with a parent_id), or
 * null when the id is not a Sub-element the caller can see. The Sub-element
 * tools act only on Elements under another, never on a top-level Element.
 */
async function visibleSubelementParent(supabase: SupabaseClient, subelementId: string): Promise<string | null> {
  if (!UUID_RE.test(subelementId)) return null;
  const { data } = await supabase.from("elements").select("parent_id").eq("id", subelementId).maybeSingle();
  if (!data?.parent_id) return null;
  return await resolveElementId(supabase, data.parent_id as string);
}

// "done" → progress 100; "todo" / "backlog" → null. Mirrors the client's
// updateElement normalization so the mark stays in sync.
export function normalizeStatusPatch(patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.status === "done") return { ...patch, progress: 100 };
  if (patch.status === "todo" || patch.status === "backlog") return { ...patch, progress: null };
  return patch;
}

/**
 * One line on the Element's Activity rail for each write an agent makes, so
 * "who / which AI did what" is readable where people already look. The
 * database stamps actor_id and author from the caller's JWT
 * (stamp_element_activity) — the person who delegated — so the agent is
 * named in the detail. Status changes also get the trigger's own line; this
 * one says which agent made them.
 */
async function audit(supabase: SupabaseClient, actor: BoardActor, elementId: string, detail: string): Promise<void> {
  const { error } = await supabase
    .from("element_activity")
    .insert({ element_id: elementId, kind: "note", detail: `${detail} — via ${actor.agent}`, author: actor.agent });
  if (error) console.error("element_activity audit failed:", error.message);
}

/** Pure. The fields a patch touched, for the audit line. */
export function describePatch(patch: Record<string, unknown>): string {
  const keys = Object.keys(patch).filter((k) => k !== "progress" && k !== "updated_at");
  return keys.length ? `Updated ${keys.join(", ")}` : "Updated";
}

/**
 * updateElement's write, addressed by a canonical id the caller already
 * holds — no resolution. The board case resolves a model-supplied string
 * first and then lands here; a caller with an authoritative id (a run's
 * agent_runs.element_id, threaded by agentReportTools) lands here
 * directly, so its write never depends on the resolver's view.
 */
export async function updateElementById(
  supabase: SupabaseClient,
  id: string,
  input: Record<string, unknown>,
  actor: BoardActor,
): Promise<ToolResult> {
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "description", "status", "priority", "type", "due_date", "due_time", "estimated_hours"]) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  if (Array.isArray(input.labels)) patch.labels = input.labels;
  if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
  const normalized = normalizeStatusPatch(patch);
  const { data, error } = await supabase
    .from("elements").update({ ...normalized, updated_at: new Date().toISOString() }).eq("id", id)
    .select("id, display_id, title, status, priority, progress").single();
  if (error) throw error;
  await audit(supabase, actor, id, describePatch(patch));
  return { ok: true, data, meta: { rows: 1 } };
}

/**
 * addElementComment's write, addressed by a canonical id the caller
 * already holds — no resolution (see updateElementById for why the
 * bound form exists).
 */
export async function addElementCommentById(
  supabase: SupabaseClient,
  elementId: string,
  body: unknown,
  actor: BoardActor,
): Promise<ToolResult> {
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "body is required" };
  const { data, error } = await supabase
    .from("element_comments").insert({
      element_id: elementId,
      content: text,
      author_id: actor.userId,
      author_kind: "ai_agent",
      author_name: actor.agent,
    })
    .select("id, content, author_name, created_at").single();
  if (error) throw error;
  return { ok: true, data, meta: { rows: 1 } };
}

export async function runBoardTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
  actor: BoardActor,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "listMyDomains": {
        const { data, error } = await supabase
          .from("domains")
          .select("id, name, identifier, activity_space_id, created_at")
          .order("name");
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "listObjects": {
        let q = supabase
          .from("objects")
          .select("id, name, prefix, domain_id, order_index, created_at")
          .is("archived_at", null)
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
            .from("objects").select("id").eq("domain_id", input.domainId as string).is("archived_at", null);
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
          .select("id, display_id, seq_number, title, description, status, priority, type, labels, due_date, due_time, estimated_hours, progress, object_id, created_at, updated_at")
          .eq("id", elementId).maybeSingle();
        if (error) throw error;
        if (!el) return { ok: false, error: "Element not found" };
        const [subs, assignees, homes, comments] = await Promise.all([
          supabase.from("elements")
            .select("id, display_id, seq_number, title, status, order_index")
            .eq("parent_id", elementId)
            .order("order_index", { ascending: true }).order("seq_number", { ascending: true }),
          supabase.from("element_assignees")
            .select("worker_id, worker:workers(id, name)")
            .eq("element_id", elementId),
          supabase.from("element_objects")
            .select("object_id, is_primary")
            .eq("element_id", elementId),
          supabase.from("element_comments")
            .select("id, author_name, author_kind, content, created_at")
            .eq("element_id", elementId).order("created_at", { ascending: false }).limit(10),
        ]);
        return {
          ok: true,
          data: {
            ...el,
            subElements: subs.data ?? [],
            assignees: assignees.data ?? [],
            objects: homes.data ?? [],
            recentComments: comments.data ?? [],
          },
        };
      }

      case "findByText": {
        const query = String(input.query ?? "").trim();
        if (!query) return { ok: false, error: "query is required" };
        const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
        const pattern = quoteFilterValue(`%${query.replace(/[\\%_]/g, m => "\\" + m)}%`);
        let q = supabase
          .from("elements")
          .select("id, display_id, seq_number, title, status, priority, object_id, updated_at")
          .or(`title.ilike.${pattern},description.ilike.${pattern},display_id.ilike.${pattern}`)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (input.domainId) {
          const { data: objs } = await supabase
            .from("objects").select("id").eq("domain_id", input.domainId as string).is("archived_at", null);
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
            .from("objects").select("id").eq("domain_id", input.domainId as string).is("archived_at", null);
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
            .from("objects").select("id").eq("domain_id", input.domainId as string).is("archived_at", null);
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
        // Who can be assigned follows the Space boundary; the database decides
        // (list_assignable_workers). No arguments: every Space the caller is in.
        let elementId: string | null = null;
        if (input.elementId) {
          elementId = await resolveElementId(supabase, String(input.elementId));
          if (!elementId) return { ok: false, error: "Element not found" };
        }
        let domainId = input.domainId ? String(input.domainId) : null;
        if (!elementId && !domainId && input.objectId) {
          const { data: obj } = await supabase
            .from("objects").select("domain_id").eq("id", String(input.objectId)).maybeSingle();
          if (!obj) return { ok: false, error: "Object not found" };
          domainId = (obj as { domain_id: string | null }).domain_id;
          if (!domainId) {
            const { data: od } = await supabase
              .from("object_domains").select("domain_id").eq("object_id", String(input.objectId))
              .order("is_primary", { ascending: false }).limit(1).maybeSingle();
            domainId = (od as { domain_id: string } | null)?.domain_id ?? null;
          }
        }
        const { data, error } = await supabase
          .rpc("list_assignable_workers", { p_space_id: null, p_domain_id: domainId, p_element_id: elementId })
          .select("id, name, type, role, user_id");
        if (error) throw error;
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        return { ok: true, data: rows, meta: { rows: rows.length } };
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
        // The primary junction row is the trigger's job (sync_element_primary_object):
        // it follows elements.object_id on insert and on every move, so nothing
        // written here can disagree with it.
        await audit(supabase, actor, data.id, `Created “${title}”`);
        // initial assignees — a refused assignment is reported, not dropped:
        // the Element exists either way, and the caller should know who is on it.
        // A Worker outside the Element's Space is skipped and named here.
        let assigneeError: string | undefined;
        if (Array.isArray(input.assigneeWorkerIds) && input.assigneeWorkerIds.length > 0) {
          const requested = [...new Set((input.assigneeWorkerIds as unknown[]).map(String).filter(Boolean))];
          const allowed: string[] = [];
          const refused: string[] = [];
          for (const wid of requested) {
            const { data: ok } = await supabase.rpc("worker_assignable", { p_worker: wid, p_element: data.id });
            (ok === true ? allowed : refused).push(wid);
          }
          const problems: string[] = [];
          if (refused.length > 0) problems.push(`Worker is outside this Element's Space: ${refused.join(", ")}`);
          if (allowed.length > 0) {
            const { error: aErr } = await supabase.from("element_assignees")
              .insert(allowed.map((wid) => ({ element_id: data.id, worker_id: wid })));
            if (aErr) problems.push(aErr.message);
          }
          if (problems.length > 0) assigneeError = problems.join("; ");
        }
        // The reason it exists — like a refused assignee, an intent that did not
        // bind is reported; the Element stands either way.
        const basis = await bindBasis(supabase, [data.id], basisIds(input.basisIntentIds));
        const basisError = basis.refused.length > 0
          ? `Not bound as the reason: ${basis.refused.join(", ")}${basis.error ? ` (${basis.error})` : " (not a live intent of a Strategy)"}`
          : undefined;
        const extra = { ...(assigneeError ? { assigneeError } : {}), ...(basisError ? { basisError } : {}) };
        return { ok: true, data: { ...data, ...extra }, meta: { rows: 1 } };
      }

      case "updateElement": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        return await updateElementById(supabase, id, input, actor);
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
        // The junction follows: the trigger drops the old primary row, marks the
        // new one primary and leaves the Element's other homes alone. Deleting
        // every row here used to erase the primary the trigger had just written.
        await audit(supabase, actor, id, `Moved to Object ${targetObjectId}`);
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
        if (el?.object_id === objectId) {
          // Unlinking the primary home: another home takes over as primary
          // first, and the trigger removes the old primary row with the move.
          // Deleting the row outright would leave object_id pointing at an
          // Object the junction no longer records.
          const next = links!.find((l) => l.object_id !== objectId)!.object_id;
          const { error: mvErr } = await supabase
            .from("elements").update({ object_id: next }).eq("id", id);
          if (mvErr) throw mvErr;
          return { ok: true, data: { id, objectId, newPrimaryObjectId: next }, meta: { rows: 1 } };
        }
        const { error } = await supabase
          .from("element_objects").delete()
          .eq("element_id", id).eq("object_id", objectId);
        if (error) throw error;
        return { ok: true, data: { id, objectId }, meta: { rows: 1 } };
      }

      // ── Write: Sub-element (an Element under another) ─────────────────
      case "createSubelement": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        const title = String(input.title ?? "").trim();
        if (!title) return { ok: false, error: "title is required" };
        // A Sub-element lives where its parent lives: the parent's Object, or
        // the parent's owner when it sits in no Object.
        const { data: parent, error: parentError } = await supabase
          .from("elements").select("object_id, owner_id").eq("id", elementId).single();
        if (parentError) throw parentError;
        const { data: last } = await supabase
          .from("elements").select("order_index").eq("parent_id", elementId)
          .order("order_index", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        const { data, error } = await supabase
          .from("elements").insert({
            title, parent_id: elementId, status: "todo",
            object_id: parent.object_id ?? null,
            owner_id: parent.object_id ? null : parent.owner_id ?? null,
            order_index: ((last?.order_index as number | null) ?? -1) + 1,
          })
          .select("id, display_id, seq_number, title, status, parent_id").single();
        if (error) throw error;
        await audit(supabase, actor, elementId, `Added sub-element “${title}”`);
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "toggleSubelementComplete": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const parentId = await visibleSubelementParent(supabase, id);
        if (!parentId) return { ok: false, error: "Sub-element not found" };
        let nextDone: boolean;
        if (input.isCompleted !== undefined) {
          nextDone = !!input.isCompleted;
        } else {
          const { data: cur } = await supabase
            .from("elements").select("status").eq("id", id).maybeSingle();
          if (!cur) return { ok: false, error: "Sub-element not found" };
          nextDone = cur.status !== "done";
        }
        const { data, error } = await supabase
          .from("elements").update(normalizeStatusPatch({ status: nextDone ? "done" : "todo" }))
          .eq("id", id).not("parent_id", "is", null)
          .select("id, parent_id, title, status").single();
        if (error) throw error;
        await audit(supabase, actor, parentId, `${nextDone ? "Completed" : "Reopened"} sub-element “${data.title}”`);
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "updateSubelement": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        const parentId = await visibleSubelementParent(supabase, id);
        if (!parentId) return { ok: false, error: "Sub-element not found" };
        let patch: Record<string, unknown> = {};
        if (input.title !== undefined) patch.title = String(input.title);
        if (input.isCompleted !== undefined) patch.status = input.isCompleted ? "done" : "todo";
        if (Object.keys(patch).length === 0) return { ok: false, error: "no fields to update" };
        patch = normalizeStatusPatch(patch);
        const { data, error } = await supabase
          .from("elements").update(patch).eq("id", id).not("parent_id", "is", null)
          .select("id, parent_id, title, status").single();
        if (error) throw error;
        await audit(supabase, actor, parentId, `Updated sub-element “${data.title}”`);
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "deleteSubelement": {
        const id = String(input.id ?? "");
        if (!id) return { ok: false, error: "id is required" };
        if (!(await visibleSubelementParent(supabase, id))) return { ok: false, error: "Sub-element not found" };
        const { error } = await supabase.from("elements").delete().eq("id", id).not("parent_id", "is", null);
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
        const { data: assignable, error: aErr } = await supabase
          .rpc("worker_assignable", { p_worker: workerId, p_element: elementId });
        if (aErr) throw aErr;
        if (assignable !== true) {
          return {
            ok: false,
            error: "This Worker can't be assigned to this Element: it is in another Space, inactive, or the person can't see this Element. listWorkers with elementId returns who can be.",
          };
        }
        const { error } = await supabase
          .from("element_assignees").insert({ element_id: elementId, worker_id: workerId });
        if (error) throw error;
        await audit(supabase, actor, elementId, `Assigned Worker ${workerId}`);
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
        await audit(supabase, actor, elementId, `Unassigned Worker ${workerId}`);
        return { ok: true, data: { elementId, workerId, removed: true }, meta: { rows: 1 } };
      }

      case "setElementLabels": {
        const id = await resolveElementId(supabase, String(input.id ?? ""));
        if (!id) return { ok: false, error: "Element not found" };
        const labels = Array.isArray(input.labels) ? input.labels : [];
        const { data, error } = await supabase
          .from("elements").update({ labels, updated_at: new Date().toISOString() }).eq("id", id)
          .select("id, labels").single();
        if (error) throw error;
        await audit(supabase, actor, id, `Labels: ${labels.join(", ") || "none"}`);
        return { ok: true, data, meta: { rows: 1 } };
      }

      case "addElementComment": {
        const elementId = await resolveElementId(supabase, String(input.elementId ?? ""));
        if (!elementId) return { ok: false, error: "Element not found" };
        return await addElementCommentById(supabase, elementId, input.body, actor);
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
        for (const row of data ?? []) await audit(supabase, actor, row.id, describePatch(patch));
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
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Pure. A value for a PostgREST `.or()` filter, double-quoted so commas,
 * parentheses and dots in it stay part of the value instead of adding
 * conditions; `"` and `\\` are backslash-escaped inside the quotes.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, (m) => "\\" + m)}"`;
}

/** Pure. Supabase throws plain `{ message }` objects, not Error instances. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

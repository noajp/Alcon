import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeStatusPatch, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { basisErrorText, bindBasis, type BasisRefusal } from "./elementBasis.ts";

// Several Elements under one Object in one write. Filing a list one
// createElement at a time spent a tool call, an insert and an audit insert per
// row, and the model had to write every call out; this is one call, one
// insert and one audit insert. The rows go in as a single INSERT, so the
// display-id trigger numbers them one after another (a row-level trigger sees
// the rows of the same statement processed before it).

const MAX_ROWS = 50;
const FIELDS = ["description", "status", "priority", "type", "due_date"] as const;

export const BATCH_TOOLS: ToolDef[] = [{
  name: "createElements",
  description:
    "Create several Elements under one Object in one call. Use this instead of repeated createElement whenever you file two or more Elements. " +
    `Up to ${MAX_ROWS} per call; each item takes the same fields as createElement except objectId and assignees.`,
  input_schema: {
    type: "object",
    properties: {
      objectId: { type: "string", description: "親 Object UUID（必須）" },
      elements: {
        type: "array",
        maxItems: MAX_ROWS,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done", "blocked", "cancelled"] },
            priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
            type: { type: "string" },
            due_date: { type: "string", description: "ISO 8601 YYYY-MM-DD" },
            labels: { type: "array", items: { type: "string" } },
            basisIntentIds: { type: "array", items: { type: "string" }, description: "根拠にする Strategy の成功条件・前提・意思決定の intent id（createElement と同じ）" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["objectId", "elements"],
    additionalProperties: false,
  },
}];

export async function runBatchTool(db: SupabaseClient, input: Record<string, unknown>, actor: BoardActor): Promise<ToolResult> {
  const objectId = String(input.objectId ?? "");
  if (!objectId) return { ok: false, error: "objectId is required" };
  const items = Array.isArray(input.elements) ? input.elements as Record<string, unknown>[] : [];
  if (items.length === 0) return { ok: false, error: "elements is empty" };
  if (items.length > MAX_ROWS) return { ok: false, error: `at most ${MAX_ROWS} Elements per call` };

  const rows: Record<string, unknown>[] = [];
  // Ids chosen here, so each row's reasons find their Element without
  // relying on the order the insert returns rows in.
  const reasons = new Map<string, unknown>();
  for (const [i, item] of items.entries()) {
    const title = String(item?.title ?? "").trim();
    if (!title) return { ok: false, error: `elements[${i}].title is required` };
    const id = crypto.randomUUID();
    if (Array.isArray(item.basisIntentIds) && item.basisIntentIds.length > 0) reasons.set(id, item.basisIntentIds);
    const row: Record<string, unknown> = { id, object_id: objectId, title };
    for (const k of FIELDS) if (item[k] !== undefined) row[k] = item[k];
    if (Array.isArray(item.labels)) row.labels = item.labels;
    rows.push(normalizeStatusPatch(row));
  }

  const { data, error } = await db
    .from("elements")
    .insert(rows)
    .select("id, display_id, title, status, priority");
  if (error) return { ok: false, error: error.message };
  const created = data ?? [];

  const { error: auditError } = await db.from("element_activity").insert(created.map((e) => ({
    element_id: e.id, kind: "note", detail: `Created “${e.title}” — via ${actor.agent}`, author: actor.agent,
  })));
  if (auditError) console.error("element_activity audit failed:", auditError.message);

  // Each row's reasons on their own; a refused one is reported, the rows stand.
  const refused: BasisRefusal[] = [];
  for (const [id, raw] of reasons) {
    const result = await bindBasis(db, { id, objectId }, raw);
    refused.push(...result.refused);
  }
  const basisError = basisErrorText(refused);

  return { ok: true, data: basisError ? { created, basisError } : { created }, meta: { rows: created.length } };
}

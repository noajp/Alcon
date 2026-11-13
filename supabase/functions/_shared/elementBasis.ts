import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Why an Element exists: the part of a Strategy it serves, written as an
// intent_bindings row when the Element is made. A Strategy that changes later
// can then find the work that stood on what changed. The caller names intents
// it already read (getInitiative). Each one is judged on its own: a live
// decision, premise or success condition of a Strategy the Element's Object
// belongs to binds; anything else is refused with its reason, and the rest
// still bind.

export const MAX_BASIS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure. How an Element serves an intent of this kind; null when it cannot be a reason. */
export function basisRelationship(kind: unknown): "delivers" | "tests" | null {
  if (kind === "measure" || kind === "decision") return "delivers";
  if (kind === "assumption") return "tests";
  return null;
}

/** Pure. The ids a caller passed: strings, trimmed, once each. Past MAX_BASIS
 *  they are not dropped silently but come back as refused. */
export function basisIds(raw: unknown): { ids: string[]; overflow: string[] } {
  if (!Array.isArray(raw)) return { ids: [], overflow: [] };
  const all = [...new Set(raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))];
  return { ids: all.slice(0, MAX_BASIS), overflow: all.slice(MAX_BASIS) };
}

export interface BasisRefusal { id: string; reason: string }

/** Pure. The refusals as one line for a tool result; undefined when there are none. */
export function basisErrorText(refused: readonly BasisRefusal[]): string | undefined {
  if (refused.length === 0) return undefined;
  return `Not bound as the reason: ${refused.map((r) => `${r.id} (${r.reason})`).join(", ")}`;
}

/** Binds the Element to each intent named, one at a time. The Element stands
 *  either way; what did not bind comes back with why. */
export async function bindBasis(
  db: SupabaseClient,
  element: { id: string; objectId: string },
  raw: unknown,
): Promise<{ bound: string[]; refused: BasisRefusal[] }> {
  const { ids, overflow } = basisIds(raw);
  const refused: BasisRefusal[] = overflow.map((id) => ({ id, reason: `more than ${MAX_BASIS} reasons` }));
  const bound: string[] = [];
  const wellFormed = ids.filter((id) => UUID.test(id));
  for (const id of ids) if (!UUID.test(id)) refused.push({ id, reason: "not an intent id" });
  if (wellFormed.length === 0) return { bound, refused };

  const [intents, links] = await Promise.all([
    db.from("intents").select("id, kind, strategy_id, superseded_by_intent_id").in("id", wellFormed),
    db.from("strategy_objects").select("strategy_id").eq("object_id", element.objectId),
  ]);
  if (intents.error || links.error) {
    const reason = (intents.error ?? links.error)!.message;
    return { bound, refused: [...refused, ...wellFormed.map((id) => ({ id, reason }))] };
  }
  const found = new Map(((intents.data ?? []) as { id: string; kind: string; strategy_id: string; superseded_by_intent_id: string | null }[]).map((r) => [r.id, r]));
  const strategies = new Set(((links.data ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id));

  for (const id of wellFormed) {
    const intent = found.get(id);
    const relationship = basisRelationship(intent?.kind);
    if (!intent) { refused.push({ id, reason: "no such intent" }); continue; }
    if (intent.superseded_by_intent_id) { refused.push({ id, reason: "replaced by a newer version" }); continue; }
    if (!relationship) { refused.push({ id, reason: "a Strategy's root is not a reason" }); continue; }
    if (!strategies.has(intent.strategy_id)) { refused.push({ id, reason: "the Element's Object is not part of that Strategy" }); continue; }
    // One row per intent: RLS (only those who can edit the Strategy bind to
    // it) refuses one without taking the others down with it.
    const { error } = await db.from("intent_bindings").insert({
      intent_id: id, target_type: "element", target_id: element.id, relationship_type: relationship,
    });
    if (error) refused.push({ id, reason: error.message });
    else bound.push(id);
  }
  return { bound, refused };
}

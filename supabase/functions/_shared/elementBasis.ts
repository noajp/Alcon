import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Why an Element exists: the part of a Strategy it serves, written as an
// intent_bindings row when the Element is made. A Strategy that changes later
// can then find the work that stood on what changed. The caller names intents
// it already read (getInitiative); only live ones bind — a replaced version or
// a Strategy's master intent carries no reason of its own.

export const MAX_BASIS = 10;

/** Pure. How an Element serves an intent of this kind; null when it cannot be a reason. */
export function basisRelationship(kind: unknown): "delivers" | "tests" | null {
  if (kind === "measure" || kind === "decision") return "delivers";
  if (kind === "assumption") return "tests";
  return null;
}

/** Pure. The ids a caller passed, as they may be looked up: strings, once each, at most MAX_BASIS. */
export function basisIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, MAX_BASIS);
}

/** Binds each Element to each live intent named. Returns the ids that did not
 *  bind and why, so the caller can report them; the Elements stand either way. */
export async function bindBasis(
  db: SupabaseClient,
  elementIds: readonly string[],
  intentIds: readonly string[],
): Promise<{ bound: string[]; refused: string[]; error?: string }> {
  if (elementIds.length === 0 || intentIds.length === 0) return { bound: [], refused: [] };
  const { data, error } = await db.from("intents").select("id, kind")
    .in("id", [...intentIds]).is("superseded_by_intent_id", null);
  if (error) return { bound: [], refused: [...intentIds], error: error.message };
  const live = new Map(((data ?? []) as { id: string; kind: string }[]).map((r) => [r.id, basisRelationship(r.kind)]));
  const bound = intentIds.filter((id) => live.get(id));
  const refused = intentIds.filter((id) => !live.get(id));
  if (bound.length === 0) return { bound, refused };
  const rows = elementIds.flatMap((elementId) => bound.map((id) => ({
    intent_id: id, target_type: "element", target_id: elementId, relationship_type: live.get(id)!,
  })));
  const { error: insertError } = await db.from("intent_bindings").insert(rows);
  // RLS lets only those who can edit the Strategy bind to it.
  if (insertError) return { bound: [], refused: [...intentIds], error: insertError.message };
  return { bound, refused };
}

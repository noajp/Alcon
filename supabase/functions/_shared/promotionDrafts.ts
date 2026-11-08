// The store side of a promotion draft: the row's shape as the code
// reads it, and the moves every writer shares — the status-guarded
// transition (the draft driver's answers, the rehearsal settler, the
// tick's expiry), putting the proposed package on the record, and the
// question that parks a draft on its requester. The pure rules (which
// moves are legal, what a package is, the hashes) live in promotion.ts;
// activation itself is the owner's RPC (PR4), never this module — the
// drafting side can create neither a definition nor an Automation.

import type { SupabaseClient } from "supabase";
import {
  canPromotionTransition,
  PROMOTION_OPEN_STATUSES,
  readPromotionBinding,
  type PromotionBinding,
  type PromotionFailureClass,
  type PromotionPackage,
  type PromotionStatus,
} from "./promotion.ts";

/** One entry in the draft's material record (§4.3): what the drafter
 *  was given, where it came from, and what cleaning did to it — the
 *  reviewer sees that a source memory carried instruction-shaped text,
 *  because provenance is part of what they approve. */
export interface PromotionMaterialSource {
  kind: "memory" | "run" | "element" | "person";
  ref: string;
  tainted?: boolean;
  instructionShaped?: boolean;
  note?: string;
}

/** One lifecycle entry on the draft (activation, rollback, the
 *  unverifiable acknowledgment): small, dated, and kept on the row so
 *  the audit reads the whole story in one place. */
export interface PromotionDraftEvent {
  at: string;
  kind: string;
  by?: string | null;
  note?: string;
}

export interface PromotionDraftRow {
  id: string;
  activity_space_id: string;
  status: PromotionStatus;
  source_kind: "memory" | "run";
  source_memory_id: string | null;
  source_run_id: string | null;
  target_definition_id: string | null;
  requester_id: string | null;
  name: string | null;
  body: string | null;
  binding: unknown;
  base_definition_hash: string | null;
  tested_structure_hash: string | null;
  tested_binding_hash: string | null;
  draft_run_id: string | null;
  rehearsal_run_id: string | null;
  rehearsal_report: Record<string, unknown> | null;
  failure_class: PromotionFailureClass | null;
  awaiting_question: string | null;
  material_sources: PromotionMaterialSource[];
  activated_definition_id: string | null;
  activated_automation_id: string | null;
  activated_body: string | null;
  activated_structure_hash: string | null;
  activated_binding_hash: string | null;
  decided_by: string | null;
  decided_at: string | null;
  events: PromotionDraftEvent[];
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const asRow = (data: Record<string, unknown>): PromotionDraftRow => data as unknown as PromotionDraftRow;

/** The draft a run belongs to, in the caller's rights. */
export async function loadPromotionDraft(
  db: SupabaseClient, id: string,
): Promise<PromotionDraftRow | null> {
  const { data } = await db.from("promotion_drafts").select("*").eq("id", id).maybeSingle();
  return data ? asRow(data as Record<string, unknown>) : null;
}

/**
 * Moves a draft along the state machine, writing `patch` with the move.
 * The update matches on the status the caller read, so a racing writer
 * (the driver answering while the tick expires, say) makes one of them
 * a no-op rather than a lost update; an illegal move never reaches the
 * database. Returns the moved row, or null when the move did not
 * happen — callers treat null as "someone else settled this first".
 */
export async function transitionPromotionDraft(
  db: SupabaseClient,
  draft: PromotionDraftRow,
  to: PromotionStatus,
  patch: Record<string, unknown> = {},
): Promise<PromotionDraftRow | null> {
  if (!canPromotionTransition(draft.status, to)) return null;
  const { data } = await db.from("promotion_drafts")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("id", draft.id).eq("status", draft.status)
    .select("*").maybeSingle();
  return data ? asRow(data as Record<string, unknown>) : null;
}

/** Puts the proposed package on the record. Only while drafting: a
 *  package under rehearsal or review is the tested one, and changing it
 *  means going back through drafting (the transition enforces the
 *  order). The binding is stored as proposed; hashes are computed and
 *  frozen by the testing path, not here. */
export async function applyPromotionPackage(
  db: SupabaseClient,
  draft: PromotionDraftRow,
  pkg: PromotionPackage,
): Promise<PromotionDraftRow | null> {
  if (draft.status !== "drafting") return null;
  const { data } = await db.from("promotion_drafts")
    .update({
      name: pkg.name, body: pkg.body, binding: pkg.binding as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id).eq("status", "drafting")
    .select("*").maybeSingle();
  return data ? asRow(data as Record<string, unknown>) : null;
}

/** Parks the draft on its requester with the question it is waiting on. */
export async function askPromotionDraft(
  db: SupabaseClient,
  draft: PromotionDraftRow,
  question: string,
): Promise<PromotionDraftRow | null> {
  return transitionPromotionDraft(db, draft, "awaiting_input", { awaiting_question: question });
}

/** The package a draft currently proposes, or null before the first
 *  proposal (or for a row whose stored body is unusable). */
export function draftPackageOf(draft: PromotionDraftRow): PromotionPackage | null {
  if (typeof draft.name !== "string" || draft.name.trim() === "") return null;
  if (typeof draft.body !== "string" || draft.body.trim() === "") return null;
  return { name: draft.name, body: draft.body, binding: readPromotionBinding(draft.binding) };
}

/** Appends a lifecycle entry to the draft's events. A plain update (the
 *  row's other writers are status-guarded); used by the activation and
 *  rollback paths, whose own writes already serialise the moment. */
export async function appendPromotionEvent(
  db: SupabaseClient,
  draft: PromotionDraftRow,
  event: PromotionDraftEvent,
): Promise<void> {
  const events = [...(Array.isArray(draft.events) ? draft.events : []), event];
  await db.from("promotion_drafts")
    .update({ events: events as unknown as Record<string, unknown>[], updated_at: new Date().toISOString() })
    .eq("id", draft.id);
}

/** Open-draft counts for the caps (§4.10): the Space's open drafts and
 *  this requester's, counted the same way the creation paths check
 *  them. */
export async function countOpenPromotionDrafts(
  db: SupabaseClient,
  spaceId: string,
  requesterId: string,
): Promise<{ space: number; requester: number }> {
  const { data } = await db.from("promotion_drafts")
    .select("id, requester_id")
    .eq("activity_space_id", spaceId)
    .in("status", [...PROMOTION_OPEN_STATUSES]);
  const rows = (data ?? []) as { requester_id: string | null }[];
  return {
    space: rows.length,
    requester: rows.filter((r) => r.requester_id === requesterId).length,
  };
}

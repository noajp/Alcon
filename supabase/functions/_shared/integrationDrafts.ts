// The draft record's store: what the drafting driver (run-agent) and
// the draft test (integration-draft-test) share when they read and move
// an integration_drafts row. Every status change goes through the pure
// state machine in connectorDraft.ts, so an illegal move is refused
// here rather than written. The row never holds a secret; the staged
// integration it points at is the only place one can exist (in Vault,
// keyed by that row's id, as for every connection).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canDraftTransition, type DraftCandidate, type DraftDrop, type DraftStatus,
} from "./connectorDraft.ts";

export interface DraftRow {
  id: string;
  activity_space_id: string;
  name: string;
  name_key: string;
  kind: string;
  status: DraftStatus;
  request_context: Record<string, unknown>;
  endpoint: string | null;
  auth_type: string | null;
  auth_header: string | null;
  manifest: Record<string, unknown> | null;
  guide: string | null;
  test_inputs: Record<string, Record<string, unknown>>;
  sources: string[];
  test_results: unknown;
  required_commands: string[];
  dropped_commands: DraftDrop[];
  tested_hash: string | null;
  tested_content: Record<string, unknown> | null;
  materialized_integration_id: string | null;
  target_integration_id: string | null;
  activated_integration_id: string | null;
  draft_run_id: string | null;
  failure_class: string | null;
  awaiting_question: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const DRAFT_COLUMNS =
  "id, activity_space_id, name, name_key, kind, status, request_context, endpoint, auth_type, auth_header, " +
  "manifest, guide, test_inputs, sources, test_results, required_commands, dropped_commands, tested_hash, " +
  "tested_content, materialized_integration_id, target_integration_id, activated_integration_id, draft_run_id, " +
  "failure_class, awaiting_question, expires_at, created_by, created_at, updated_at";

export async function loadDraft(admin: SupabaseClient, draftId: string): Promise<DraftRow | null> {
  const { data } = await admin.from("integration_drafts").select(DRAFT_COLUMNS).eq("id", draftId).maybeSingle();
  return (data as DraftRow | null) ?? null;
}

/** Move a draft, refusing a move the state machine does not allow. The
 *  status is matched in the update, so a racing move loses cleanly. */
export async function transitionDraft(
  admin: SupabaseClient, draft: DraftRow, to: DraftStatus, patch: Record<string, unknown> = {},
): Promise<boolean> {
  if (!canDraftTransition(draft.status, to)) return false;
  const { data } = await admin.from("integration_drafts")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("id", draft.id).eq("status", draft.status)
    .select("id").maybeSingle();
  if (data) draft.status = to;
  return !!data;
}

/** Write a validated candidate onto the draft (drafting only — a tested
 *  candidate is frozen by the tested content, and a new proposal is what
 *  unfreezes it, back in drafting). */
export async function applyCandidate(
  admin: SupabaseClient, draft: DraftRow,
  candidate: DraftCandidate, drops: DraftDrop[],
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    endpoint: candidate.endpoint, auth_type: candidate.authType, auth_header: candidate.authHeader,
    manifest: candidate.manifest as unknown as Record<string, unknown>, guide: candidate.guide,
    test_inputs: candidate.testInputs, sources: candidate.sources,
    dropped_commands: drops, awaiting_question: null, failure_class: null,
    updated_at: new Date().toISOString(),
  };
  // The first accepted proposal fixes what the work requires; later
  // proposals may only drop from it, with a reason (connectorDraft).
  if (!draft.required_commands.length) {
    const commands = (candidate.manifest as { commands?: { name?: unknown }[] } | null)?.commands ?? [];
    patch.required_commands = commands.map((c) => String(c?.name ?? "")).filter(Boolean);
  }
  const { data } = await admin.from("integration_drafts").update(patch)
    .eq("id", draft.id).in("status", ["drafting", "testing"]).select("id").maybeSingle();
  return !!data;
}

/** Record the question a draft waits on (drafting → awaiting_input). */
export async function askDraft(admin: SupabaseClient, draft: DraftRow, question: string): Promise<boolean> {
  return transitionDraft(admin, draft, "awaiting_input", { awaiting_question: question.slice(0, 1000) });
}

/**
 * Terminal cleanup of the staged row (G4 §3): a draft that ends without
 * activating leaves no connection row behind — deleting the row takes
 * its Vault secret with it (the delete trigger). A row another draft
 * activated is never touched: it is a live connection now, and this
 * draft merely pointed at the same staging.
 */
export async function deleteStagedRow(admin: SupabaseClient, draft: DraftRow): Promise<void> {
  const staged = draft.materialized_integration_id;
  if (!staged || draft.activated_integration_id) return;
  const { data: activators } = await admin.from("integration_drafts")
    .select("id").eq("activated_integration_id", staged).eq("status", "active").limit(1);
  if (activators?.length) return;
  await admin.from("integrations").delete().eq("id", staged);
  await admin.from("integration_drafts")
    .update({ materialized_integration_id: null, updated_at: new Date().toISOString() })
    .eq("id", draft.id);
}

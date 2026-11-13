// The promotion's testing stage, server side: the static gate and the
// connector matching a package must pass before its rehearsal, and the
// freeze that records exactly what was tested (the two hashes) when
// they pass. The rehearsal itself — a real run with its writes
// blocked — is PR3's substrate (_shared/rehearsal.ts); settling a
// finished rehearsal onto the draft also lives here, beside the freeze
// it completes (settlePromotionRehearsal).
//
// The gate is the design's first two stages and nothing more: validity
// is checkHarness's judgement, the promotion floor is the gate in
// promotion.ts, and connector matching compares the body's connector
// names (folded) against the Space's enabled connections, by row name
// and by preset display name alike — the same names a harness may use.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkHarness, parseDefinition } from "./definition.ts";
import {
  MAX_PROMOTION_REVISIONS,
  missingPromotionConnectors,
  promotionBindingHash,
  promotionPackageGate,
  promotionReviewExpiresAt,
  promotionStructureHash,
  type PromotionPackage,
} from "./promotion.ts";
import { CONNECTOR_PRESET_NAMES } from "./connectorNeeds.ts";
import {
  appendPromotionEvent,
  transitionPromotionDraft,
  type PromotionDraftRow,
} from "./promotionDrafts.ts";
import {
  classifyRehearsal,
  readRehearsalReport,
  summarizeRehearsalReport,
} from "./rehearsal.ts";

export interface PromotionGateOutcome {
  /** Static failures: checkHarness errors plus the promotion floor. */
  errors: string[];
  /** Shown at review, never blocking: hints and the missing-checks note. */
  warnings: string[];
  /** Connectors the body names that the Space has not connected. */
  missing: string[];
}

/** Pure. Runs the static gate and the connector matching for a package
 *  against the Space's connected names. */
export function evaluatePromotionPackage(
  pkg: PromotionPackage,
  connectedNames: readonly string[],
): PromotionGateOutcome {
  const parsed = parseDefinition(pkg.body);
  const gate = promotionPackageGate(parsed, checkHarness(parsed));
  return {
    errors: gate.errors,
    warnings: gate.warnings,
    missing: missingPromotionConnectors(parsed, connectedNames),
  };
}

/** The names a harness in this Space may call its connectors by: every
 *  enabled connection's row name, plus its preset's display name where
 *  it has one. Disabled rows (a G4 candidate under test among them) do
 *  not count as connected. */
export async function connectedConnectorNames(
  admin: SupabaseClient, spaceId: string,
): Promise<string[]> {
  const { data } = await admin.from("integrations")
    .select("name, preset").eq("activity_space_id", spaceId).eq("enabled", true);
  const names: string[] = [];
  for (const row of (data ?? []) as { name: string; preset: string | null }[]) {
    names.push(row.name);
    const display = row.preset ? CONNECTOR_PRESET_NAMES[row.preset] : null;
    if (display && display !== row.name) names.push(display);
  }
  return names;
}

/**
 * Freezes a package that passed the gate onto its draft and moves the
 * draft to rehearsing: the name, body and binding as tested, and the
 * two hashes the owner's activation will be bound to. Returns the
 * moved draft, or null when the draft had already moved on.
 */
export async function freezePromotionPackage(
  admin: SupabaseClient,
  draft: PromotionDraftRow,
  pkg: PromotionPackage,
): Promise<PromotionDraftRow | null> {
  const [structure, binding] = await Promise.all([
    promotionStructureHash(pkg.name, pkg.body),
    promotionBindingHash(pkg),
  ]);
  return transitionPromotionDraft(admin, draft, "rehearsing", {
    name: pkg.name,
    body: pkg.body,
    binding: pkg.binding as unknown as Record<string, unknown>,
    tested_structure_hash: structure,
    tested_binding_hash: binding,
    failure_class: null,
    expires_at: null,
  });
}

// ── The rehearsal: launch and settle ───────────────────────────────────

/** Renders a binding template's one placeholder the rehearsal needs:
 *  the day the Element is for. Everything else stays literal — the
 *  rehearsal's Element is one concrete instance, honestly dated. */
function renderTemplate(template: string, today: string): string {
  return template.replace(/\{\{\s*date\s*\}\}/gi, today);
}

/** The Space's AI Worker that runs in Clayware (the automations' own
 *  choice, shared here rather than imported from an Edge Function). */
async function aiWorkerOf(admin: SupabaseClient, spaceId: string): Promise<string | null> {
  const { data } = await admin.from("workers").select("id, name, ai_config")
    .eq("activity_space_id", spaceId).eq("type", "ai_agent").eq("status", "active");
  const inClayware = ((data ?? []) as { id: string; name: string; ai_config: unknown }[])
    .filter((w) => (w.ai_config as Record<string, unknown> | null)?.runner !== "claude-code");
  return (inClayware.find((w) => w.name === "Claude") ?? inClayware[0])?.id ?? null;
}

/**
 * Launches a draft's rehearsal: a real Element on the binding's Object
 * (it stays on the board — decision 11), a run marked as a rehearsal,
 * and the package's definition carried in the run's transcript (the
 * substrate's way: the definition being tried is not a row, so nothing
 * is born before activation). Everything is created with the
 * requester's own rights — the same inserts an Automation's fire makes
 * as its owner — so a requester who cannot place work on that Object
 * hears so here, plainly. The draft stays `rehearsing`; settling is
 * settlePromotionRehearsal's, whoever calls it first.
 */
export async function launchPromotionRehearsal(args: {
  admin: SupabaseClient;
  userDb: SupabaseClient;
  draft: PromotionDraftRow;
  pkg: PromotionPackage;
  startRun: (runId: string) => Promise<void>;
}): Promise<{ runId: string; elementId: string } | { error: string }> {
  const { admin, userDb, draft, pkg } = args;
  if (!pkg.binding.objectId) return { error: "試走には置き場の Object が要ります。binding.objectId を決めてください。" };
  const requesterId = draft.requester_id ?? draft.created_by;
  if (!requesterId) return { error: "起草した人が分かりません。" };
  const workerId = await aiWorkerOf(admin, draft.activity_space_id);
  if (!workerId) return { error: "この Space に、Clayware で動く AI Worker がいません。" };
  const { data: obj } = await userDb.from("objects").select("id, domain_id").eq("id", pkg.binding.objectId).maybeSingle();
  if (!obj) return { error: "置き場の Object が見つからないか、起草した人からは見られません。" };
  const object = obj as { id: string; domain_id: string | null };

  const today = new Date().toISOString().slice(0, 10);
  const title = `【試走】${renderTemplate(pkg.binding.titleTemplate || pkg.name, today)}`.slice(0, 200);
  const description = [
    renderTemplate(pkg.binding.descriptionTemplate, today),
    "（昇格ドラフトの試走です。この Element は試走の記録として板に残ります。読み取りは実際に行われますが、書き込みは計画として記録され、実行されません。）",
  ].filter(Boolean).join("\n\n");
  const { data: el, error: elError } = await userDb.from("elements")
    .insert({ title, description, object_id: object.id, status: "todo", priority: "medium", labels: ["rehearsal"], definition_id: null })
    .select("id").single();
  if (elError || !el) return { error: `試走の Element を作れませんでした: ${elError?.message ?? "unknown"}` };
  const elementId = (el as { id: string }).id;
  const { error: asError } = await userDb.from("element_assignees")
    .insert({ element_id: elementId, worker_id: workerId, role: "assignee" });
  if (asError) return { error: `AI Worker を割り当てられませんでした: ${asError.message}` };
  const { data: run, error: runError } = await userDb.from("agent_runs")
    .insert({
      element_id: elementId, domain_id: object.domain_id, worker_id: workerId,
      triggered_from: "promotion", triggered_by: requesterId, status: "queued", mode: "execute",
      rehearsal: true,
      transcript: { messages: [], turns: 0, nudges: 0, rehearsalDefinition: { name: pkg.name, body: pkg.body } },
    })
    .select("id").single();
  if (runError || !run) return { error: `試走の実行を作れませんでした: ${runError?.message ?? "unknown"}` };
  const runId = (run as { id: string }).id;
  await admin.from("promotion_drafts")
    .update({ rehearsal_run_id: runId, updated_at: new Date().toISOString() }).eq("id", draft.id);
  await appendPromotionEvent(admin, draft, { at: new Date().toISOString(), kind: "rehearsal_started", note: runId });
  await args.startRun(runId).catch(() => {});
  return { runId, elementId };
}

/** Tells a Space's owners a promotion needs them (§4.11's kind, with
 *  the draft it is about, so the Inbox can open the review). */
export async function notifyPromotionOwners(
  admin: SupabaseClient, draft: PromotionDraftRow, title: string, body: string,
): Promise<void> {
  const { data: owners } = await admin.from("activity_space_members")
    .select("user_id").eq("activity_space_id", draft.activity_space_id).eq("role", "owner");
  for (const owner of (owners ?? []) as { user_id: string }[]) {
    await admin.from("notifications").insert({
      recipient_id: owner.user_id, actor_name: "Clayware Agent", kind: "promotion",
      promotion_draft_id: draft.id, title, body,
    }).then(() => {}, () => {});
  }
}

/**
 * Settles a finished rehearsal onto its draft — deterministic, and the
 * same whoever calls it (the automations tick, or the promote driver
 * when a person drives the draft again): a tested rehearsal freezes
 * into awaiting_review with the 7-day clock; an unverifiable one stays
 * in rehearsing with the outcome on its record, waiting for the
 * owner's acknowledgment (PR4); a failed one returns to drafting with
 * its class, or ends the draft as failed at the revision cap. A
 * rehearsal still running settles nothing. Idempotent: a draft whose
 * report already carries an outcome is settled by definition.
 */
export async function settlePromotionRehearsal(
  admin: SupabaseClient, draft: PromotionDraftRow,
): Promise<{ settled: boolean; draft: PromotionDraftRow }> {
  if (draft.status !== "rehearsing" || !draft.rehearsal_run_id) return { settled: false, draft };
  const prior = readRehearsalReport(draft.rehearsal_report);
  if (prior.outcome) return { settled: true, draft };
  const { data: runRow } = await admin.from("agent_runs")
    .select("status, transcript").eq("id", draft.rehearsal_run_id).maybeSingle();
  if (!runRow) return { settled: false, draft };
  const run = runRow as { status: string; transcript: { rehearsal?: unknown } | null };
  if (run.status !== "completed" && run.status !== "failed") return { settled: false, draft };

  const report = readRehearsalReport(run.transcript?.rehearsal);
  const outcome = classifyRehearsal(report, run.status === "failed");
  const settledReport = { ...report, outcome, at: new Date().toISOString() };
  const summary = summarizeRehearsalReport(report, outcome);
  const reportJson = settledReport as unknown as Record<string, unknown>;

  if (outcome === "tested") {
    const moved = await transitionPromotionDraft(admin, draft, "awaiting_review", {
      rehearsal_report: reportJson,
      failure_class: null,
      expires_at: promotionReviewExpiresAt(new Date()).toISOString(),
    });
    if (!moved) return { settled: false, draft };
    await notifyPromotionOwners(admin, moved,
      "昇格の審査が待っています",
      `「${moved.name ?? "定義"}」の試走が通りました。${summary.split("\n")[1] ?? ""} 有効化する前に内容を確認してください。`);
    return { settled: true, draft: moved };
  }
  if (outcome === "unverifiable") {
    await admin.from("promotion_drafts")
      .update({ rehearsal_report: reportJson, updated_at: new Date().toISOString() })
      .eq("id", draft.id).eq("status", "rehearsing");
    await notifyPromotionOwners(admin, draft,
      "昇格の試走で確かめきれませんでした",
      `「${draft.name ?? "定義"}」の試走では読み取りが実行されず、証跡が得られませんでした。審査へ進めるには owner の確認が要ります。`);
    return { settled: true, draft: { ...draft, rehearsal_report: reportJson } };
  }
  const failures = (draft.events ?? []).filter((e) => e.kind === "rehearsal_failed").length + 1;
  const patch = { rehearsal_report: reportJson, failure_class: outcome };
  if (failures >= MAX_PROMOTION_REVISIONS) {
    const moved = await transitionPromotionDraft(admin, draft, "failed", patch);
    if (!moved) return { settled: false, draft };
    await appendPromotionEvent(admin, moved, { at: new Date().toISOString(), kind: "rehearsal_failed", note: outcome });
    const requesterId = draft.requester_id ?? draft.created_by;
    if (requesterId) {
      await admin.from("notifications").insert({
        recipient_id: requesterId, actor_name: "Clayware Agent", kind: "promotion",
        promotion_draft_id: draft.id, title: "昇格の起草が失敗しました",
        body: `「${draft.name ?? "定義"}」の試走が ${MAX_PROMOTION_REVISIONS} 回失敗し、起草は失敗として記録されました（分類: ${outcome}）。`,
      }).then(() => {}, () => {});
    }
    return { settled: true, draft: moved };
  }
  const moved = await transitionPromotionDraft(admin, draft, "drafting", patch);
  if (!moved) return { settled: false, draft };
  await appendPromotionEvent(admin, moved, { at: new Date().toISOString(), kind: "rehearsal_failed", note: outcome });
  return { settled: true, draft: moved };
}

// Capture: a finished piece of work is distilled into episodes. The
// drivers call in here at their natural seams — an Element run's
// sealed finish, a conversation turn's landing — with everything the
// distillation may see and a recordUsage to charge it to the run.
// Everything in here is best-effort by construction: capture never
// throws, never blocks the finish it rides on, and silently does
// nothing when the toggle is off, the model is another provider's
// (the small auxiliary calls are Anthropic-shaped, as the verifier's
// is), or the budget is spent — memory is the layer above the record,
// never a condition of it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type Anthropic from "npm:@anthropic-ai/sdk@0.110.0";
import type { ModelUsage } from "../_shared/aiPricing.ts";
import { DISTILL_SCHEMA, DISTILL_SYSTEM, distillPrompt, readDistilledCandidates, type DistillMaterial } from "../_shared/memoryDistill.ts";
import { captureEnabled, writeDistilledEpisodes } from "../_shared/memoryDb.ts";
import type { MemoryScope } from "../_shared/memoryStore.ts";

/** Pure. Whose memory a run's work becomes: its Space's when it has
 *  one, its person's when it does not. A conversation's scope follows
 *  its boundary the same way — a personal Copilot chat never writes
 *  into a Space it was not held in. */
export function captureScopeOf(spaceId: string | null | undefined): MemoryScope {
  return spaceId ? "space" : "personal";
}

/** Pure. Whether a landed conversation turn is worth distilling: the
 *  threshold is substantive tool work — the turn changed or read the
 *  record, not just talked. Chatter leaves no episode. */
export const LANDING_TOOL_THRESHOLD = 2;
export function landingWorthDistilling(toolCallsThisTurn: number): boolean {
  return toolCallsThisTurn >= LANDING_TOOL_THRESHOLD;
}

/** Step titles of a run, in order — the only part of the steps a
 *  distillation may ever see. */
export async function loadStepTitles(admin: SupabaseClient, runId: string, limit = 60): Promise<string[]> {
  const { data } = await admin.from("agent_run_steps")
    .select("title").eq("run_id", runId).order("idx", { ascending: true }).limit(limit);
  return ((data ?? []) as { title: string }[]).map((s) => s.title);
}

export interface DistillCall {
  client: Anthropic;
  model: string;
  recordUsage: (u: ModelUsage) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * One distillation: the model reads the digest at low effort and
 * answers in the schema; the candidates come back validated (capped,
 * scrubbed, cleared of instruction shapes) by memoryDistill. Any
 * failure — unreadable answer included — is zero candidates.
 */
export async function distillOnce(call: DistillCall, material: DistillMaterial) {
  // deno-lint-ignore no-explicit-any
  const res: any = await call.client.messages.create({
    model: call.model,
    max_tokens: 2000,
    system: DISTILL_SYSTEM,
    messages: [{ role: "user", content: distillPrompt(material) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: DISTILL_SCHEMA } },
  // deno-lint-ignore no-explicit-any
  } as any, call.signal ? { signal: call.signal } : undefined);
  await call.recordUsage((res.usage ?? {}) as ModelUsage);
  const text = ((res.content ?? []) as { type: string; text?: string }[])
    .find((b) => b.type === "text")?.text ?? "";
  return readDistilledCandidates(text);
}

export interface CaptureArgs {
  admin: SupabaseClient;
  userId: string;
  scope: MemoryScope;
  spaceId: string | null;
  material: DistillMaterial;
  call: DistillCall | null; // null: no Anthropic-shaped call available
  budgetOk: boolean;
  sourceRunId: string | null;
  sourceSessionId: string | null;
  links: { elementId?: string | null; domainId?: string | null; strategyId?: string | null };
  /** The driver's step writer, so the keeping is on the run's record. */
  noteKept?: (titles: string[]) => Promise<void>;
}

/**
 * The one capture path every driver shares: toggle, budget and model
 * gates, then distill and write episodes through the store's dedupe.
 * Returns how many memories were kept. Never throws.
 */
export async function captureMemories(args: CaptureArgs): Promise<number> {
  try {
    if (!args.call || !args.budgetOk) return 0;
    if (!(await captureEnabled(args.admin, args.scope, args.spaceId, args.userId))) return 0;
    const candidates = await distillOnce(args.call, args.material);
    if (!candidates.length) return 0;
    const written = await writeDistilledEpisodes(args.admin, {
      scope: args.scope, spaceId: args.spaceId, userId: args.userId, candidates,
      sourceRunId: args.sourceRunId, sourceSessionId: args.sourceSessionId, links: args.links,
    });
    if (written > 0 && args.noteKept) {
      await args.noteKept(candidates.slice(0, written).map((c) => c.title)).catch(() => {});
    }
    return written;
  } catch (e) {
    console.error("run-agent: memory capture failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

// Memory's database movements, in one place for every driver: the
// capture toggle's reading, the context load (index + ranked bodies +
// the Element's episodes), the use recording that promotes, and the
// writes (distilled episodes, a durable with its supersede). The
// decisions are memoryStore.ts's; this file only moves rows. Capture
// and use-recording run on the service role (Athena's bookkeeping —
// RLS grants people their own acts, not the engine's), while the
// context load runs on the caller's client where a userDb exists, so
// what a run is reminded of is exactly what its person may read —
// plus, for a run, its Space's memories read as its starter.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decideEpisodeWrite, episodeExpiry, fingerprintOf, promotionDue, supersedeTargetFor, topicKeyOf,
  type MemoryCandidate, type MemoryRow, type MemoryScope,
} from "./memoryStore.ts";
import { memorySection, pickBodies, type RankedMemory } from "./memoryRetrieve.ts";
import { promotionOfferCandidate, promotionOfferText } from "./promotion.ts";

const ROW_COLS = "id, layer, kind, status, scope, activity_space_id, user_id, title, gist, body, topic_key, fingerprint, element_id, domain_id, strategy_id, integration_name, origin, created_by, edited_by, source_run_id, source_session_id, supersedes_id, pinned, use_count, last_used_at, expires_at, created_at, updated_at, promotion_offered_at";

/**
 * Whether automatic capture stands for a scope: the Space's toggle
 * for Space work, the person's own toggle for personal work. A row
 * that cannot be read reads as ON only when it does not exist —
 * capture is the default Athena carries, and a missing profile row
 * must not silently switch a person's memory off.
 */
export async function captureEnabled(
  admin: SupabaseClient, scope: MemoryScope, spaceId: string | null, userId: string,
): Promise<boolean> {
  if (scope === "space" && spaceId) {
    const { data } = await admin.from("activity_spaces").select("memory_auto_capture").eq("id", spaceId).maybeSingle();
    return (data as { memory_auto_capture?: boolean } | null)?.memory_auto_capture !== false;
  }
  const { data } = await admin.from("profiles").select("memory_auto_capture").eq("id", userId).maybeSingle();
  return (data as { memory_auto_capture?: boolean } | null)?.memory_auto_capture !== false;
}

export interface MemoryContextLoad {
  /** The rendered memory section for the run's context, and the ids
   *  whose BODY entered it (exactly those count as used). This composed
   *  shape is what every call site consumes. */
  text: string;
  usedIds: string[];
  /** Active durable rows of the scope (the index's raw material). */
  indexRows: MemoryRow[];
  /** Bodies picked for this work: search hits + the Element's own
   *  recent episodes. */
  bodies: MemoryRow[];
}

/**
 * Loads what a piece of work is reminded of. The search runs as the
 * caller (the RPC is security-invoker: RLS is the scope), ranked by
 * trigram over title+gist+body, boosted toward this Element. The
 * durable index loads whole for the scope — it is small by design
 * (the render caps it), and loading it through the same client keeps
 * one visibility rule for both tiers.
 */
export async function loadMemoryContext(
  db: SupabaseClient,
  args: { query: string; spaceId: string | null; elementId: string | null },
  admin?: SupabaseClient,
): Promise<MemoryContextLoad> {
  const indexQuery = db.from("memories").select(ROW_COLS)
    .eq("layer", "durable").eq("status", "active")
    .order("pinned", { ascending: false }).order("use_count", { ascending: false })
    .order("created_at", { ascending: false }).limit(200);
  const scoped = args.spaceId ? indexQuery.eq("activity_space_id", args.spaceId) : indexQuery;
  const [{ data: indexData }, { data: searchData }, { data: episodeData }] = await Promise.all([
    scoped,
    args.query.trim()
      ? db.rpc("search_memories", { p_query: args.query, p_space_id: args.spaceId, p_element_id: args.elementId, p_limit: 12 })
      : Promise.resolve({ data: [] as unknown[] }),
    args.elementId
      ? db.from("memories").select(ROW_COLS).eq("element_id", args.elementId)
        .eq("layer", "episode").eq("status", "active")
        .order("created_at", { ascending: false }).limit(6)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const indexRows = (indexData ?? []) as unknown as MemoryRow[];
  const ranked = (searchData ?? []) as unknown as RankedMemory[];
  const episodes = (episodeData ?? []) as unknown as MemoryRow[];
  const bodies = pickBodies(ranked, episodes, args.elementId);
  const section = memorySection(indexRows, bodies);
  let text = section.text;
  // The promotion path's conversational offer (condition 5, decision
  // 9): when a durable procedure's body actually enters a conversation,
  // the offer to make it standing may ride the section — once per
  // memory, ever. The stamp is the engine's bookkeeping, so it goes
  // through the service role when the caller provides it; without one,
  // no offer is made (an offer that cannot be marked is not made at
  // all — under-offer rather than nag). A memory already promoted is
  // stamped silently: the question is settled.
  if (admin) {
    try {
      const candidate = promotionOfferCandidate(bodies);
      if (candidate) {
        const { data: promoted } = await admin.from("promotion_drafts")
          .select("id").eq("source_memory_id", candidate.id).eq("status", "active").limit(1);
        await admin.from("memories")
          .update({ promotion_offered_at: new Date().toISOString() })
          .eq("id", candidate.id).is("promotion_offered_at", null);
        if (!(promoted ?? []).length) text = `${text}\n\n${promotionOfferText(candidate)}`;
      }
    } catch { /* the offer is a courtesy; retrieval never fails for it */ }
  }
  return { text, usedIds: section.usedIds, indexRows, bodies };
}

/**
 * Records that these memories' bodies entered a run's context (or a
 * recall returned them): one memory_uses row per (memory, run) — the
 * unique index makes a second recording in the same run a no-op — the
 * count and last-used stamp, and the promotion an episode has earned
 * at 3 uses. Returns the ids actually recorded and any promotions, so
 * the driver can step them. Never throws: a use unrecorded is a
 * smaller memory, never a failed run.
 */
export async function recordMemoryUses(
  admin: SupabaseClient, runId: string, memoryIds: readonly string[],
): Promise<{ recorded: string[]; promoted: string[] }> {
  const recorded: string[] = [];
  const promoted: string[] = [];
  for (const id of [...new Set(memoryIds)]) {
    try {
      const { data: use, error } = await admin.from("memory_uses")
        .insert({ memory_id: id, run_id: runId }).select("id").maybeSingle();
      if (error || !use) continue; // already recorded for this run
      recorded.push(id);
      const { data: row } = await admin.from("memories").select(ROW_COLS).eq("id", id).maybeSingle();
      if (!row) continue;
      const m = row as unknown as MemoryRow;
      const nextCount = m.use_count + 1;
      await admin.from("memories").update({
        use_count: nextCount, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (promotionDue({ ...m, use_count: nextCount })) {
        await promoteMemory(admin, { ...m, use_count: nextCount });
        promoted.push(id);
      }
    } catch { /* best-effort bookkeeping */ }
  }
  return { recorded, promoted };
}

/**
 * An episode becomes durable: same row, new layer — its provenance
 * and chain stay one row deep — claiming its topic's durable slot:
 * an active durable already holding the topic is superseded by this
 * one (the episode's knowledge is the newer, work-proved one), and
 * the expiry falls away. A keyless episode takes a key from its
 * title, so its fact can be held singly from here on.
 */
export async function promoteMemory(admin: SupabaseClient, m: MemoryRow): Promise<void> {
  const topicKey = m.topic_key ?? topicKeyOf(m.title);
  if (topicKey) {
    const { data: existing } = await admin.from("memories").select(ROW_COLS)
      .eq("layer", "durable").eq("status", "active").eq("topic_key", topicKey)
      .eq(m.scope === "space" ? "activity_space_id" : "user_id", m.scope === "space" ? m.activity_space_id : m.user_id);
    const target = supersedeTargetFor(topicKey, m.scope, m.activity_space_id, m.user_id,
      (existing ?? []) as unknown as MemoryRow[], m.id);
    if (target) {
      await admin.from("memories").update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("id", target).eq("status", "active");
      await admin.from("memories").update({ supersedes_id: target }).eq("id", m.id);
    }
  }
  await admin.from("memories").update({
    layer: "durable", topic_key: topicKey, expires_at: null, updated_at: new Date().toISOString(),
  }).eq("id", m.id).eq("layer", "episode");
}

/**
 * Writes distilled candidates as episodes of one scope, through the
 * store's dedupe decision. Returns how many were written. Expiry is
 * stamped at write time (90 days); the sweep retires them.
 */
export async function writeDistilledEpisodes(
  admin: SupabaseClient,
  args: {
    scope: MemoryScope; spaceId: string | null; userId: string;
    candidates: readonly (MemoryCandidate & { topicKey: string | null })[];
    sourceRunId: string | null; sourceSessionId: string | null;
    links: { elementId?: string | null; domainId?: string | null; strategyId?: string | null };
  },
): Promise<number> {
  if (!args.candidates.length) return 0;
  const { data: existing } = await admin.from("memories")
    .select("id, fingerprint, status")
    .eq(args.scope === "space" ? "activity_space_id" : "user_id", args.scope === "space" ? args.spaceId : args.userId)
    .eq("status", "active").not("fingerprint", "is", null).limit(500);
  const rows = (existing ?? []) as Pick<MemoryRow, "id" | "fingerprint" | "status">[];
  let written = 0;
  const now = new Date();
  for (const c of args.candidates) {
    const candidate: MemoryCandidate = {
      ...c,
      elementId: c.elementId ?? args.links.elementId ?? null,
      domainId: c.domainId ?? args.links.domainId ?? null,
      strategyId: c.strategyId ?? args.links.strategyId ?? null,
    };
    if (decideEpisodeWrite(candidate, args.scope, args.spaceId, args.userId, rows).action === "drop-duplicate") continue;
    const { error } = await admin.from("memories").insert({
      layer: "episode", kind: candidate.kind, status: "active", scope: args.scope,
      activity_space_id: args.scope === "space" ? args.spaceId : null,
      user_id: args.scope === "personal" ? args.userId : null,
      title: candidate.title, gist: candidate.gist, body: candidate.body,
      topic_key: c.topicKey,
      fingerprint: fingerprintOf(candidate, args.scope, args.spaceId, args.userId),
      element_id: candidate.elementId ?? null, domain_id: candidate.domainId ?? null,
      strategy_id: candidate.strategyId ?? null, integration_name: candidate.integrationName ?? null,
      origin: "athena", created_by: null,
      source_run_id: args.sourceRunId, source_session_id: args.sourceSessionId,
      expires_at: episodeExpiry(now).toISOString(),
    });
    if (!error) written += 1;
  }
  return written;
}

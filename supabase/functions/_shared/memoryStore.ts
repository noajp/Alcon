// Memory's shape and its discipline, as pure logic: what a memory is,
// how a candidate is keyed and fingerprinted, when a new durable
// replaces an old one, and how uses promote an episode. The engines
// (run-agent's capture and retrieval, the automations sweep) and the
// web settings share these decisions through this one module — the
// twin in web/src/Function/settings/memoryModel.ts is pinned to it by
// tests, so the judgement can never drift between the writer and the
// screen. The rows are the truth (migration 20261129090000); everything
// here is a decision over rows, never a second store.

export type MemoryKind = "event" | "procedure" | "fact";
export type MemoryLayer = "episode" | "durable";
export type MemoryStatus = "active" | "superseded" | "archived" | "expired";
export type MemoryScope = "space" | "personal";
export type MemoryOrigin = "athena" | "person";

/** One memory row, as the engines and the screen both read it. */
export interface MemoryRow {
  id: string;
  layer: MemoryLayer;
  kind: MemoryKind;
  status: MemoryStatus;
  scope: MemoryScope;
  activity_space_id: string | null;
  user_id: string | null;
  title: string;
  gist: string;
  body: string;
  topic_key: string | null;
  fingerprint: string | null;
  element_id: string | null;
  domain_id: string | null;
  strategy_id: string | null;
  integration_name: string | null;
  origin: MemoryOrigin;
  created_by: string | null;
  edited_by: string | null;
  source_run_id: string | null;
  source_session_id: string | null;
  supersedes_id: string | null;
  pinned: boolean;
  use_count: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What a write proposes, before it is a row. Targets and provenance
 *  ride along; the store decides the rest (layer, status, expiry). */
export interface MemoryCandidate {
  kind: MemoryKind;
  title: string;
  gist: string;
  body: string;
  /** The fact this memory is about, in the writer's words; normalized
   *  by topicKeyOf before it keys anything. Absent = no single fact,
   *  so no durable slot is claimed. */
  topic?: string | null;
  elementId?: string | null;
  domainId?: string | null;
  strategyId?: string | null;
  integrationName?: string | null;
}

export const MEMORY_KINDS: readonly MemoryKind[] = ["event", "procedure", "fact"];

/** An episode's life: written after work, it expires unless it is used
 *  into durability or a person pins it first. */
export const EPISODE_TTL_DAYS = 90;
/** Uses at which an episode has proved itself and promotes itself. */
export const PROMOTE_USE_COUNT = 3;

/**
 * Pure. A topic's key: the same fact, written a little differently,
 * keys the same. Unicode-normalized, case-folded, whitespace-folded —
 * deliberately shallow (this is a key, not a search): two writings of
 * one fact meet here, and the partial unique index does the rest.
 */
export function topicKeyOf(topic: string | null | undefined): string | null {
  if (typeof topic !== "string") return null;
  const key = topic.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  return key || null;
}

const scopeKeyOf = (scope: MemoryScope, spaceId: string | null, userId: string | null): string =>
  scope === "space" ? `space:${spaceId ?? ""}` : `person:${userId ?? ""}`;

/**
 * Pure. What makes two candidate episodes the same memory: same scope,
 * same topic (or, with no topic, the same title), same target. The
 * unique index on fingerprint makes the second write a no-op — a run
 * re-driven after a slice cut cannot distill its finish twice.
 */
export function fingerprintOf(
  c: MemoryCandidate, scope: MemoryScope, spaceId: string | null, userId: string | null,
): string {
  const topic = topicKeyOf(c.topic);
  const about = topic ?? `title:${c.title.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ")}`;
  const target = c.elementId ?? c.strategyId ?? c.integrationName ?? "";
  return `${scopeKeyOf(scope, spaceId, userId)}|${about}|${target}`;
}

/**
 * Pure. The store's decision for one distilled candidate against the
 * scope's existing rows — one place, so every writer (finish capture,
 * conversation capture, the remember tool, the sweep) judges alike:
 * an identical active episode already stands → drop the duplicate;
 * a durable with the candidate's topic already stands → the candidate
 * enters as an episode and the durable stands (a contradiction is
 * settled by promotion, never by a silent overwrite at capture time);
 * otherwise the candidate is written as proposed.
 */
export type StoreDecision =
  | { action: "drop-duplicate"; existingId: string }
  | { action: "write" };

export function decideEpisodeWrite(
  c: MemoryCandidate, scope: MemoryScope, spaceId: string | null, userId: string | null,
  existing: readonly Pick<MemoryRow, "id" | "fingerprint" | "status">[],
): StoreDecision {
  const fp = fingerprintOf(c, scope, spaceId, userId);
  const dup = existing.find((m) => m.status === "active" && m.fingerprint === fp);
  return dup ? { action: "drop-duplicate", existingId: dup.id } : { action: "write" };
}

/**
 * Pure. The replace decision for a durable write (a person's remember,
 * an episode's promotion): an active durable in the same scope holding
 * the same topic_key is superseded by the new row — never edited in
 * place, so the chain stays readable and the old fact stays citable.
 * A keyless durable replaces nothing.
 */
export function supersedeTargetFor(
  topicKey: string | null, scope: MemoryScope, spaceId: string | null, userId: string | null,
  existing: readonly Pick<MemoryRow, "id" | "layer" | "status" | "scope" | "activity_space_id" | "user_id" | "topic_key">[],
  selfId?: string | null,
): string | null {
  if (!topicKey) return null;
  const hit = existing.find((m) =>
    m.id !== selfId && m.layer === "durable" && m.status === "active" && m.topic_key === topicKey
    && m.scope === scope
    && (scope === "space" ? m.activity_space_id === spaceId : m.user_id === userId));
  return hit?.id ?? null;
}

/**
 * Pure. Whether this use promotes the memory: an episode, unpinned or
 * not, that has now been used PROMOTE_USE_COUNT times has proved it is
 * not noise. (Pinning is a person's own promotion, decided at the pin.)
 */
export function promotionDue(m: Pick<MemoryRow, "layer" | "status" | "use_count">): boolean {
  return m.layer === "episode" && m.status === "active" && m.use_count >= PROMOTE_USE_COUNT;
}

/** Pure. An episode's expiry instant, EPISODE_TTL_DAYS after a time. */
export function episodeExpiry(from: Date): Date {
  return new Date(from.getTime() + EPISODE_TTL_DAYS * 24 * 3_600_000);
}

/** Pure. Due for the sweep: an active episode past its expiry. Pinned
 *  episodes are a person's keep — the sweep never retires those. */
export function episodeExpired(m: Pick<MemoryRow, "layer" | "status" | "expires_at" | "pinned">, now: Date): boolean {
  return m.layer === "episode" && m.status === "active" && !m.pinned
    && m.expires_at !== null && new Date(m.expires_at).getTime() <= now.getTime();
}

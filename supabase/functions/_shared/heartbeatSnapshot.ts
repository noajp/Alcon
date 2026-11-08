// The heartbeat's inspection, as pure functions: waiting signals in,
// the wake's candidates out. The driver reads the Space's rows (as the
// enabling owner, under their RLS) and maps them to signals; everything
// judgement-shaped — the threshold, the per-kind and total caps, dedup
// against the last digest, escalation — is decided here, where tests
// can pin it. The model never sees a wait this file did not pass, and
// has no way to loosen what it applies: thresholds are code's.
//
// The vocabulary mirrors the chain's waiting reasons (web's waiting.ts)
// in meaning; the two are twins by necessity (Deno cannot import the
// web tree), with the correspondence fixed by the design.

export type HeartbeatSignalKind =
  | "approval_element" | "approval_copilot"
  | "run_answer" | "run_review" | "element_review" | "readings"
  | "run_paused" | "run_failed"
  | "draft_review" | "draft_input"
  | "automation_failed";

/** One thing waiting for a person, as the driver's reads found it. */
export interface HeartbeatSignal {
  kind: HeartbeatSignalKind;
  /** The waiting thing's own id (action, run, draft, automation…). */
  id: string;
  /** When this wait began (ISO timestamp). */
  since: string;
  /** The state's version, when the same thing can wait again in a new
   *  state (a run that pauses, resumes and pauses again waits twice;
   *  a draft's review is a different wait from its question). Part of
   *  the fingerprint when present. */
  version?: string | null;
  /** When the wait lapses on its own, if it does (a Copilot approval's
   *  seven days, a draft's review window). An approaching lapse is a
   *  candidacy of its own: the deadline can matter more than the age. */
  expiresAt?: string | null;
  /** What waits, in a person's words (an Element's title, an action's
   *  summary, a draft's name). */
  label: string;
  /** Where the person decides it, in words ("Element で判断できます"). */
  place: string;
}

export interface HeartbeatCandidate {
  /** The id the model may name in notify_digest: the fingerprint. A
   *  candidate outside this list cannot be notified about — the model
   *  picks from the snapshot, it does not invent items. */
  signalId: string;
  kind: HeartbeatSignalKind;
  label: string;
  place: string;
  waitedHours: number;
  /** Hours until the wait lapses, when that is what raised it. */
  expiryHours: number | null;
  /** True when this is the one escalation re-raise of a wait already
   *  notified once (its fingerprint carries the :esc1 version). */
  escalated: boolean;
}

export interface HeartbeatInspection {
  /** Every wait over the threshold, before dedup: the wake's step
   *  reports these, notified or not. */
  pending: { kind: HeartbeatSignalKind; waitedHours: number }[];
  /** What the model may raise, after dedup and escalation. */
  candidates: HeartbeatCandidate[];
  /** Over-threshold waits kept quiet this wake: already told, and not
   *  yet at the escalation line — or told twice, which is all the
   *  heartbeat will say about them. */
  silenced: number;
}

export const HEARTBEAT_KIND_LABEL: Record<HeartbeatSignalKind, string> = {
  approval_element: "承認待ち",
  approval_copilot: "承認待ち",
  run_answer: "回答待ち",
  run_review: "レビュー待ち",
  element_review: "レビュー待ち",
  readings: "測定値の受入待ち",
  run_paused: "エラーで停止した実行",
  run_failed: "失敗した実行",
  draft_review: "接続ドラフトの審査待ち",
  draft_input: "起草の回答待ち",
  automation_failed: "自動化の失敗",
};

const FINGERPRINT_BASE: Record<HeartbeatSignalKind, string> = {
  approval_element: "approval",
  approval_copilot: "approval",
  run_answer: "run_answer",
  run_review: "run_review",
  element_review: "element_review",
  readings: "readings",
  run_paused: "run_paused",
  run_failed: "run_failed",
  draft_review: "draft_review",
  draft_input: "draft_input",
  automation_failed: "automation_failed",
};

/** Pure. A wait's identity across wakes: its kind, its thing, and its
 *  state's version — `approval:<action_id>`, `draft_review:<id>:awaiting_review`. */
export function fingerprintOf(signal: HeartbeatSignal): string {
  const base = `${FINGERPRINT_BASE[signal.kind]}:${signal.id}`;
  return signal.version ? `${base}:${signal.version}` : base;
}

export const ESCALATION_SUFFIX = ":esc1";
/** How many thresholds old a told wait must grow before it is raised
 *  once more (the design's 3×: 24h → 72h). */
export const ESCALATION_MULTIPLE = 3;

const PER_KIND_CAP = 20;
const TOTAL_CAP = 50;

const hoursBetween = (from: string, to: Date) => (to.getTime() - new Date(from).getTime()) / 3_600_000;

/**
 * Pure. The snapshot one wake judges: signals over the threshold (by
 * age, or by an approaching lapse), capped per kind and in total,
 * oldest first, with the last digest's fingerprints applied — a told
 * wait stays quiet until it crosses the escalation line, and after
 * its one escalation it is quiet for good (it stays in `pending`, so
 * the wake's record still counts it).
 */
export function buildHeartbeatSnapshot(
  signals: readonly HeartbeatSignal[],
  opts: { now: Date; thresholdHours: number; previousFingerprints: readonly string[] },
): HeartbeatInspection {
  const threshold = Math.max(0, opts.thresholdHours);
  const over: { signal: HeartbeatSignal; waitedHours: number; expiryHours: number | null }[] = [];
  for (const s of signals) {
    const waited = hoursBetween(s.since, opts.now);
    const expiry = s.expiresAt ? hoursBetween(opts.now.toISOString(), new Date(s.expiresAt)) : null;
    const lapsing = expiry !== null && expiry >= 0 && expiry < threshold;
    if (waited >= threshold || lapsing) over.push({ signal: s, waitedHours: Math.max(0, waited), expiryHours: expiry });
  }
  over.sort((x, y) => x.signal.since.localeCompare(y.signal.since));

  const perKind = new Map<HeartbeatSignalKind, number>();
  const capped: typeof over = [];
  for (const row of over) {
    const n = perKind.get(row.signal.kind) ?? 0;
    if (n >= PER_KIND_CAP) continue;
    perKind.set(row.signal.kind, n + 1);
    capped.push(row);
    if (capped.length >= TOTAL_CAP) break;
  }

  const prev = new Set(opts.previousFingerprints);
  const candidates: HeartbeatCandidate[] = [];
  let silenced = 0;
  for (const { signal, waitedHours, expiryHours } of capped) {
    const fp = fingerprintOf(signal);
    const escalatedFp = fp + ESCALATION_SUFFIX;
    if (prev.has(escalatedFp)) { silenced += 1; continue; }
    if (prev.has(fp)) {
      if (waitedHours >= threshold * ESCALATION_MULTIPLE) {
        candidates.push({ signalId: escalatedFp, kind: signal.kind, label: signal.label, place: signal.place, waitedHours, expiryHours, escalated: true });
      } else silenced += 1;
      continue;
    }
    candidates.push({ signalId: fp, kind: signal.kind, label: signal.label, place: signal.place, waitedHours, expiryHours, escalated: false });
  }
  return {
    pending: capped.map(({ signal, waitedHours }) => ({ kind: signal.kind, waitedHours })),
    candidates,
    silenced,
  };
}

/**
 * Pure. What the next wake remembers of this one: the fingerprints of
 * everything notified so far whose wait is still pending (carried in
 * the form they were notified under — an escalated wait stays
 * escalated), plus what this wake notified. Resolved waits drop out,
 * because their fingerprint no longer appears among the pending.
 */
export function carryDigestFingerprints(
  previous: readonly string[],
  stillPending: readonly string[],
  notifiedNow: readonly string[],
): string[] {
  const pending = new Set(stillPending);
  const out = new Set<string>();
  for (const fp of previous) {
    const base = fp.endsWith(ESCALATION_SUFFIX) ? fp.slice(0, -ESCALATION_SUFFIX.length) : fp;
    if (pending.has(base)) out.add(fp);
  }
  for (const fp of notifiedNow) out.add(fp);
  return [...out];
}

/** Pure. The digest's title: how many wait, and how long the oldest
 *  has — one kind named when the digest is all one kind. */
export function digestTitleFor(candidates: readonly HeartbeatCandidate[]): string {
  const n = candidates.length;
  const oldest = candidates.reduce((m, c) => Math.max(m, c.waitedHours), 0);
  const hours = Math.floor(oldest);
  const labels = new Set(candidates.map((c) => HEARTBEAT_KIND_LABEL[c.kind]));
  if (labels.size === 1) return `${[...labels][0]}が ${n} 件、最古は ${hours} 時間待っています`;
  return `この Space で ${n} 件が待っています（最古 ${hours} 時間）`;
}

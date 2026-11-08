// Constraint drafts (B6): the learning edge. Outcomes (B4) say what
// happened; calibration (B5) says where the verifier and the humans
// disagree; neither changes what runs next. This piece closes the
// long return path: code clusters trailing outcomes by (target, failure
// signature); a model may phrase one candidate constraint per cluster
// (drafting only — it cannot set hashes, evidence or state); code
// writes the draft; a Space owner activates it through the hash-bound
// RPC; and the activated constraint lands where future work is cut —
// the planner's brief and the Strategy conversation (strategy scope),
// the definition's effective body at resolution (definition scope).
// Its effect is then measured against the baseline it claimed it
// would move, and a constraint that does not move it is flagged
// ineffective — never auto-retired: retiring is a person's call,
// because a flat rate can mean the metric, not the constraint, is
// wrong.
//
// The discipline mirrors the collector's and the evaluator's: pure
// builders first (signatures, clusters, the draft plan, hashes, the
// effect rule, the heartbeat signals), thin database shells at the
// bottom, and the model confined to phrasing — it receives clusters
// (ids + verdict/signal rows, as data) and returns text keyed to
// cluster ids; code validates the text and writes the draft with the
// evidence and hashes attached. A cluster whose evidence includes
// externally sourced content — the run's own records mark it, a Web
// step or a claim sourced from a URL — is dropped whole, never
// cleaned: a poisoned constraint is worse than a poisoned memory,
// because it steers every future run of its target.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalJson } from "./integrationPlans.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { scrubText } from "./memoryScrub.ts";
import { parseDefinition } from "./definition.ts";
import { parseRunVerdict } from "./runVerdict.ts";
import { parseFinishDetail } from "./finishClaims.ts";
import { windowStartOf } from "./outcomeCollector.ts";
import type { HeartbeatSignal } from "./heartbeatSnapshot.ts";

/** The B6 policy — the program's numbers, in one named place
 *  (design §3.6, owner-adopted defaults). They are policy, not
 *  engineering: below the cluster floor the system stays silent,
 *  because concluding from one hiccup is how a system learns
 *  superstitions — and constraint spam is the risk the design names. */
export const CONSTRAINT_POLICY = {
  /** The trailing window clusters are counted over. */
  windowDays: 28,
  /** Outcomes sharing a signature before any lesson may be drafted. */
  minClusterOutcomes: 3,
  /** Of a rejection cluster's outcomes, how many must carry a human
   *  signal — a rejected write is only a lesson when a person has
   *  actually judged some of it (§3.3, scoped to rejection clusters:
   *  verifier-gap clusters carry repetition as their pairing, §3.2). */
  minSignalledForRejection: 2,
  /** Open drafts one Space may hold at once (the promotion cap). */
  maxOpenDraftsPerSpace: 10,
  /** Clusters phrased per tick — the phraser's one bounded call. */
  phrasePerTick: 3,
  /** How long a draft waits for review before it lapses. */
  reviewDays: 7,
  /** Under-constraint outcomes before an effect may be judged. */
  minUnderOutcomesForEffect: 5,
  /** Days an improvement must hold before it counts as established. */
  establishedGapDays: 7,
  /** Evidence outcome ids kept on a draft. */
  evidenceLimit: 20,
  /** Outcome rows one derivation reads at most (the collector's scale). */
  readLimit: 5000,
  /** Active constraints one effect evaluation reads at most. */
  constraintReadLimit: 500,
} as const;

export type ConstraintScope = "definition" | "strategy";
export type ConstraintDerivedFrom = "verifier_gap" | "rejection_cluster" | "correction_pattern";

// ── Signatures ────────────────────────────────────────────────────────

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/**
 * Pure. A gap/reason string normalized for clustering: quoted spans
 * （「…」/『…』/"…" — the concrete claim, price or name a gap names),
 * URLs, UUIDs, dates and bare numbers stripped, case and whitespace
 * folded, punctuation collapsed. What is left is the shape of the
 * failure, not the fact it was about.
 */
export function normalizeGapText(text: string): string {
  let s = text
    .replace(/[「『“"](?:[^」』”"]*)[」』”"]/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, "")
    .replace(/[\d,]+(?:\.\d+)?\s*(?:円|ドル|USD|\$|件|周|回|分|時間|日|%)?/g, "");
  s = s.toLowerCase().replace(/[。、.,;:!?()（）「」『』"']/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, 120);
}

/**
 * Pure. The mechanical finding a claim-gap template names — the
 * finish's own class, read off the templates checkFinishClaims
 * writes, not the prose around them. A template whose wording
 * changes stops classifying (null), and the gap falls through to
 * the generic normalization below — never to a guessed class.
 */
export function claimGapClassOf(gap: string): string | null {
  if (/出典がありません/.test(gap)) return "missing-source";
  if (/取得時刻がなく、鮮度を確かめられません/.test(gap)) return "freshness-unverifiable";
  if (/取得時刻が未来になっています/.test(gap)) return "freshness-future";
  if (/鮮度の上限/.test(gap) && /超えています/.test(gap)) return "stale-source";
  return null;
}

/**
 * Pure. One verifier gap's signature. The definition's `checks`
 * section names the items a reviewer holds work to — a gap naming
 * one of them (either way, folded containment) clusters under that
 * item (`check:<folded item>`), which is why B1/B13's structure
 * matters. A mechanical claim gap clusters under its class
 * (`claim:<class>`). Anything else normalizes to its failure shape
 * (`gap:<normalized>`); a gap that normalizes to nothing has no
 * signature and cannot cluster.
 */
export function gapSignatureOf(gap: string, checkItems: readonly string[]): string | null {
  const claimClass = claimGapClassOf(gap);
  if (claimClass) return `claim:${claimClass}`;
  const foldedGap = fold(gap);
  for (const item of checkItems) {
    const foldedItem = fold(item);
    if (foldedItem && (foldedGap.includes(foldedItem) || foldedItem.includes(foldedGap))) return `check:${foldedItem}`;
  }
  const norm = normalizeGapText(gap);
  return norm ? `gap:${norm}` : null;
}

/**
 * Pure. One correction's signature. A mechanical correction's reason
 * is a claim gap — its class carries. A verifier correction names the
 * same gaps the verifier wrote, so it takes the gap signature; an
 * empty reason has no signature. (The design's full form — a gap
 * present in run k and absent in the constrained successors — needs
 * constraints to exist; this v1 form is the same correction recurring
 * across runs of the definition, which is what the records hold.)
 */
export function correctionSignatureOf(reason: string, source: "mechanical" | "verifier", checkItems: readonly string[]): string | null {
  if (source === "mechanical") {
    const cls = claimGapClassOf(reason);
    if (cls) return `claim:${cls}`;
  }
  return gapSignatureOf(reason, checkItems);
}

/**
 * Pure. One rejection's signature: the action's identity (connector
 * + tool) and whether the person left a note — the rejection reason
 * class, from `decision_note` presence + action identity (§3.3).
 * A note says the person explained; silence is its own class.
 */
export function rejectionSignatureOf(action: { integrationId: string | null; tool: string; noted: boolean }): string {
  return `reject:${action.integrationId ?? "none"}:${action.tool}:${action.noted ? "noted" : "silent"}`;
}

// ── The cluster ───────────────────────────────────────────────────────

/** One outcome, as the derivation reads it — the sealed records only:
 *  the verdict the engine wrote, the actions the person decided, the
 *  steps the run left. Nothing here is model text the derivation
 *  re-trusts: gap strings are the verifier's words, clustered by
 *  signature; the phrasing model later receives them as data. */
export interface OutcomeEvidenceFact {
  /** run_outcomes.id — the draft's evidence names these rows. */
  id: string;
  runId: string;
  spaceId: string;
  definitionId: string | null;
  strategyId: string | null;
  humanSignal: "accepted" | "rejected" | "rework" | "none";
  finishedAt: string;
  /** The run's own records mark external content as data (a Web step
   *  or a claim sourced from a URL): a tainted outcome can belong to
   *  no cluster — the cluster it would join is dropped whole. */
  tainted: boolean;
  /** The verifier's gaps, as issued (RunVerdict.gaps). */
  gaps: string[];
  /** The mechanical findings, as issued (RunVerdict.claimGaps). */
  claimGaps: string[];
  /** The corrections this run's finishes were sent back with. */
  corrections: { source: "mechanical" | "verifier"; reason: string[] }[];
  /** The run's rejected writes, a person having decided each. */
  rejections: { integrationId: string | null; tool: string; noted: boolean }[];
  /** The connectors the run's actions span (the binding hash's set). */
  connectorIds: string[];
}

export interface ConstraintCluster {
  clusterKey: string;
  spaceId: string;
  scope: ConstraintScope;
  targetId: string;
  derivedFrom: ConstraintDerivedFrom;
  signature: string;
  /** The evidence outcome ids, newest first, capped — the draft's
   *  evidence is exactly these rows. */
  evidenceOutcomeIds: string[];
  /** All outcomes carrying the signature in the window (uncapped). */
  withSignature: number;
  /** The target's outcomes in the window, all signatures — the
   *  baseline's denominator (4 of 9 runs = 4 with, 9 of the target). */
  windowOutcomes: number;
  /** The signature's rate over the window: the baseline the
   *  constraint claims it will move (§3.6). */
  baselineRate: number;
  /** Evidence outcomes a human has spoken about. */
  signalledCount: number;
  /** Raw gap/reason texts for the signature (≤3) — what the phrasing
   *  model is shown, as data. */
  sampleTexts: string[];
  /** The connectors the evidence runs span, sorted — the binding
   *  hash's set. */
  connectorIds: string[];
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface GroupAcc {
  key: string;
  spaceId: string;
  scope: ConstraintScope;
  targetId: string;
  derivedFrom: ConstraintDerivedFrom;
  signature: string;
  ids: string[];
  signalled: number;
  /** Outcome ids whose human signal has been counted (an outcome
   *  contributes several entries to one group — its signal is one). */
  signalledIds: Set<string>;
  tainted: boolean;
  samples: string[];
  connectors: Set<string>;
}

/**
 * Pure. Trailing-window outcome facts → clusters. Groups are
 * (scope, target, kind, signature); a group drafts only at ≥3
 * outcomes — and a rejection cluster only when ≥2 of them carry a
 * human signal, because a rejected write is a lesson when a person
 * has actually judged some of it. A group whose evidence includes a
 * tainted outcome is dropped whole, not cleaned, and counted in
 * `taintedDropped` so the tick's record says why the silence fell.
 * Strategy groups stand only when the signature spans more than one
 * definition (or a definition-less run): one definition's cluster
 * belongs to that definition, never drafted twice.
 */
export function clustersOf(
  facts: readonly OutcomeEvidenceFact[],
  checksByDefinition: ReadonlyMap<string, readonly string[]>,
): { clusters: ConstraintCluster[]; taintedDropped: number } {
  const sorted = [...facts].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || a.id.localeCompare(b.id));
  const windowByTarget = new Map<string, number>();
  for (const f of sorted) {
    if (f.definitionId) windowByTarget.set(`definition:${f.definitionId}`, (windowByTarget.get(`definition:${f.definitionId}`) ?? 0) + 1);
    if (f.strategyId) windowByTarget.set(`strategy:${f.strategyId}`, (windowByTarget.get(`strategy:${f.strategyId}`) ?? 0) + 1);
  }

  const groups = new Map<string, GroupAcc>();
  const add = (
    scope: ConstraintScope, targetId: string, spaceId: string,
    derivedFrom: ConstraintDerivedFrom, signature: string,
    fact: OutcomeEvidenceFact, sample: string,
  ) => {
    const key = `${scope}:${targetId}:${derivedFrom}:${signature}`;
    const g = groups.get(key) ?? {
      key, spaceId, scope, targetId, derivedFrom, signature,
      ids: [], signalled: 0, signalledIds: new Set<string>(), tainted: false, samples: [], connectors: new Set<string>(),
    };
    if (!g.ids.includes(fact.id)) g.ids.push(fact.id);
    if (fact.humanSignal !== "none" && !g.signalledIds.has(fact.id)) {
      g.signalledIds.add(fact.id);
      g.signalled += 1;
    }
    if (fact.tainted) g.tainted = true;
    if (sample && g.samples.length < 3 && !g.samples.includes(sample)) g.samples.push(sample);
    for (const c of fact.connectorIds) g.connectors.add(c);
    groups.set(key, g);
  };

  for (const f of sorted) {
    const checkItems = f.definitionId ? (checksByDefinition.get(f.definitionId) ?? []) : [];
    if (f.definitionId) {
      for (const gap of f.gaps) {
        const sig = gapSignatureOf(gap, checkItems);
        if (sig) add("definition", f.definitionId, f.spaceId, "verifier_gap", sig, f, gap);
      }
      for (const gap of f.claimGaps) {
        const sig = gapSignatureOf(gap, checkItems);
        if (sig) add("definition", f.definitionId, f.spaceId, "verifier_gap", sig, f, gap);
      }
      for (const env of f.corrections) {
        for (const reason of env.reason) {
          const sig = correctionSignatureOf(reason, env.source, checkItems);
          if (sig) add("definition", f.definitionId, f.spaceId, "correction_pattern", sig, f, reason);
        }
      }
      for (const rej of f.rejections) {
        add("definition", f.definitionId, f.spaceId, "rejection_cluster", rejectionSignatureOf(rej), f, `${rej.tool}${rej.noted ? "（指摘あり）" : "（指摘なし）"}`);
      }
    }
    if (f.strategyId) {
      // Strategy groups are formed the same way, then filtered below
      // on the definitions they span — the span is a property of the
      // group, not of one fact.
      for (const gap of f.gaps) {
        const sig = gapSignatureOf(gap, checkItems);
        if (sig) add("strategy", f.strategyId, f.spaceId, "verifier_gap", sig, f, gap);
      }
      for (const gap of f.claimGaps) {
        const sig = gapSignatureOf(gap, checkItems);
        if (sig) add("strategy", f.strategyId, f.spaceId, "verifier_gap", sig, f, gap);
      }
      for (const env of f.corrections) {
        for (const reason of env.reason) {
          const sig = correctionSignatureOf(reason, env.source, checkItems);
          if (sig) add("strategy", f.strategyId, f.spaceId, "correction_pattern", sig, f, reason);
        }
      }
      for (const rej of f.rejections) {
        add("strategy", f.strategyId, f.spaceId, "rejection_cluster", rejectionSignatureOf(rej), f, `${rej.tool}${rej.noted ? "（指摘あり）" : "（指摘なし）"}`);
      }
    }
  }

  // The definition span of a strategy group: the distinct definitions
  // (plus "none" for definition-less runs) its facts carry. The facts
  // are looked up through the group's outcome ids.
  const byId = new Map(sorted.map((f) => [f.id, f]));
  let taintedDropped = 0;
  const clusters: ConstraintCluster[] = [];
  for (const g of groups.values()) {
    if (g.tainted) { taintedDropped += 1; continue; }
    if (g.ids.length < CONSTRAINT_POLICY.minClusterOutcomes) continue;
    if (g.derivedFrom === "rejection_cluster" && g.signalled < CONSTRAINT_POLICY.minSignalledForRejection) continue;
    if (g.scope === "strategy") {
      const defs = new Set<string>();
      for (const id of g.ids) {
        const f = byId.get(id);
        defs.add(f?.definitionId ?? "none");
      }
      if (defs.size < 2) continue; // one definition's cluster stays its own
    }
    const windowOutcomes = windowByTarget.get(`${g.scope}:${g.targetId}`) ?? g.ids.length;
    const withSignature = g.ids.length;
    clusters.push({
      clusterKey: g.key,
      spaceId: g.spaceId,
      scope: g.scope,
      targetId: g.targetId,
      derivedFrom: g.derivedFrom,
      signature: g.signature,
      evidenceOutcomeIds: g.ids.slice(0, CONSTRAINT_POLICY.evidenceLimit),
      withSignature,
      windowOutcomes,
      baselineRate: round4(withSignature / Math.max(1, windowOutcomes)),
      signalledCount: g.signalled,
      sampleTexts: g.samples,
      connectorIds: [...g.connectors].sort(),
    });
  }
  // Strongest first (most outcomes, then key order) — the draft plan
  // takes them in this order, and one target keeps only its strongest.
  clusters.sort((a, b) => b.withSignature - a.withSignature || a.clusterKey.localeCompare(b.clusterKey));
  return { clusters, taintedDropped };
}

// ── The draft plan ────────────────────────────────────────────────────

export interface OpenDraftRef {
  scope: ConstraintScope;
  targetDefinitionId: string | null;
  targetStrategyId: string | null;
}

/**
 * Pure. Which clusters may draft, given the queue as it stands:
 * one open draft per target (the promotion pattern — a second
 * lesson for the same target waits its turn, and the strongest
 * cluster of the target takes the slot), and the per-Space cap of
 * 10 open drafts across targets (open + newly planned). The
 * phraser receives at most phrasePerTick clusters, strongest first.
 */
export function draftPlanOf(
  clusters: readonly ConstraintCluster[],
  openDrafts: readonly OpenDraftRef[],
  openCountBySpace: ReadonlyMap<string, number> = new Map(),
): ConstraintCluster[] {
  const openTarget = new Set<string>();
  for (const d of openDrafts) {
    if (d.scope === "definition" && d.targetDefinitionId) openTarget.add(`definition:${d.targetDefinitionId}`);
    if (d.scope === "strategy" && d.targetStrategyId) openTarget.add(`strategy:${d.targetStrategyId}`);
  }
  const plannedPerSpace = new Map<string, number>();
  const takenTarget = new Set<string>();
  const out: ConstraintCluster[] = [];
  for (const c of clusters) {
    const targetKey = `${c.scope}:${c.targetId}`;
    if (openTarget.has(targetKey) || takenTarget.has(targetKey)) continue;
    const standing = (openCountBySpace.get(c.spaceId) ?? 0) + (plannedPerSpace.get(c.spaceId) ?? 0);
    if (standing >= CONSTRAINT_POLICY.maxOpenDraftsPerSpace) continue;
    takenTarget.add(targetKey);
    plannedPerSpace.set(c.spaceId, (plannedPerSpace.get(c.spaceId) ?? 0) + 1);
    out.push(c);
    if (out.length >= CONSTRAINT_POLICY.phrasePerTick) break;
  }
  return out;
}

// ── Hashes: the stored-trust gate ─────────────────────────────────────

/** Pure. The target version a binding is stamped with: the hash of
 *  the definition's BODY for a definition target (the body is the
 *  input the work follows — B3's precedent, over the version
 *  counter, which is bookkeeping about the body), and of the
 *  Strategy's name + description for a strategy target. */
export async function constraintTargetVersionOf(
  target: { kind: "definition"; body: string } | { kind: "strategy"; name: string; description: string | null },
): Promise<string> {
  return target.kind === "definition"
    ? sha256Hex(canonicalJson({ kind: "definition", body: target.body }))
    : sha256Hex(canonicalJson({ kind: "strategy", name: target.name, description: target.description ?? "" }));
}

/** Pure. The structure hash: the constraint text + its scope — what
 *  the owner activates is exactly the text that was drafted. */
export async function constraintStructureHash(text: string, scope: ConstraintScope): Promise<string> {
  return sha256Hex(canonicalJson({ text, scope }));
}

/** Pure. The binding hash: the target + its version at draft time +
 *  the connector set the evidence spans (sorted — the set, not the
 *  spelling order). */
export async function constraintBindingHash(args: {
  scope: ConstraintScope;
  targetId: string;
  targetVersion: string;
  connectorIds: readonly string[];
}): Promise<string> {
  return sha256Hex(canonicalJson({
    scope: args.scope, targetId: args.targetId, targetVersion: args.targetVersion,
    connectors: [...new Set(args.connectorIds)].sort(),
  }));
}

/** Pure. The snapshot the activation RPC compares against the live
 *  target: the definition's body verbatim, or the Strategy's name +
 *  description — the promotion pattern's base snapshot, compared in
 *  the RPC itself. */
export function targetSnapshotOf(
  target: { kind: "definition"; body: string } | { kind: "strategy"; name: string; description: string | null },
): string {
  return target.kind === "definition"
    ? target.body
    : `${target.name}\n${target.description ?? ""}`;
}

// ── Phrasing validation ───────────────────────────────────────────────

/**
 * Pure. What the phrasing model returned, judged by code: one
 * sentence, imperative-shaped, 10–220 characters, one line, and
 * clean of secret-shaped content (the Memory scrub — a secret in a
 * draft's text would land in every future brief of its target).
 * Invalid text drafts nothing this tick; the cluster re-derives
 * next tick. The model cannot launder a secret into a constraint.
 */
export function validateConstraintText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.includes("\n")) return null; // one sentence, one line — judged before whitespace folds
  const t = trimmed.replace(/\s+/g, " ");
  if (t.length < 10 || t.length > 220) return null;
  if (!scrubText(t).clean) return null;
  return t;
}

// ── The landing: where the text enters planning ───────────────────────

export interface ActiveConstraintFact {
  id: string;
  draftId: string;
  text: string;
  signature: string;
  derivedFrom: ConstraintDerivedFrom;
  activatedAt: string;
}

/** Pure. The Strategy-scope section the planner and the Strategy
 *  conversation read: a constraints block in the driver context,
 *  never the cached system prompt — so withdrawing one takes effect
 *  on the next run, not the next deploy. */
export function strategyConstraintSection(constraints: readonly ActiveConstraintFact[]): string {
  if (!constraints.length) return "";
  const lines = constraints.map((c) =>
    `- ${c.text}（学んだ制約: ${c.signature} の失敗から。ドラフト ${c.draftId.slice(0, 8)}…、${c.activatedAt.slice(0, 10)} に有効化）`);
  return [
    "# 学んだ制約（この Strategy の仕事の進め方）",
    "過去の仕事の結果から学び、Space の持ち主が有効化した決まりです。計画を立てるときはこれを守ってください。守れない場合は計画にその理由を書き、無視しないでください。",
    ...lines,
  ].join("\n");
}

/** Pure. The definition-scope block, rendered into the definition's
 *  effective body at resolution under its own heading, with a
 *  provenance line (draft id + activation date) per constraint. The
 *  stored body a person wrote is never rewritten — this is computed
 *  at read time, and rollback is deactivating the constraint. */
export function definitionConstraintBlock(constraints: readonly ActiveConstraintFact[]): string {
  if (!constraints.length) return "";
  const lines = constraints.map((c) =>
    `- ${c.text}（学んだ制約: ${c.signature} の失敗から。ドラフト ${c.draftId.slice(0, 8)}…、${c.activatedAt.slice(0, 10)} に有効化）`);
  return [
    "\n\n## 制約（過去の仕事から学んだ決まり — Space の持ち主が有効化したもの。定義そのものではなく、後から重ねた決まりです）",
    ...lines,
  ].join("\n");
}

/** Pure. The section a run's definition prompt carries — the
 *  definition-scoped constraints for the resolved definition,
 *  rendered the same way the planner sees the strategy ones. */
export function effectiveDefinitionText(body: string, constraints: readonly ActiveConstraintFact[]): string {
  return body + definitionConstraintBlock(constraints);
}

// ── The heartbeat surface ─────────────────────────────────────────────

export interface ConstraintDraftFact {
  id: string;
  text: string;
  targetName: string;
  createdAt: string;
  expiresAt: string | null;
}

const CONSTRAINT_PLACE = "Settings › AI › Harnesses で審査できます";

/** Pure. One signal per awaiting-review draft, fingerprinted by the
 *  draft's own id (the snapshot dedups it to one telling, plus the
 *  one escalation): the queue's review wait, raised like every other
 *  heartbeat signal — a candidate for a telling, never an action. */
export function constraintDraftSignals(
  drafts: readonly ConstraintDraftFact[],
): HeartbeatSignal[] {
  return drafts.map((d) => ({
    kind: "constraint_review",
    id: d.id,
    since: d.createdAt,
    version: "awaiting_review",
    expiresAt: d.expiresAt,
    label: `制約の草案「${d.text.slice(0, 60)}」が審査を待っています（${d.targetName}）`.slice(0, 200),
    place: CONSTRAINT_PLACE,
  })).sort((a, b) => a.since.localeCompare(b.since));
}

// ── The conversational offer ──────────────────────────────────────────

export interface ConstraintOfferCandidate {
  id: string;
  text: string;
  targetName: string;
}

/** Pure. The draft an offer may be made for, among the Space's
 *  awaiting-review drafts: the oldest never offered before, one at a
 *  time — the stamp settles the rest (the promotion pattern). */
export function constraintOfferCandidate(
  drafts: readonly (ConstraintOfferCandidate & { offeredAt: string | null })[],
): ConstraintOfferCandidate | null {
  for (const d of [...drafts].sort((a, b) => a.id.localeCompare(b.id))) {
    if (d.offeredAt) continue;
    return { id: d.id, text: d.text, targetName: d.targetName };
  }
  return null;
}

/** The offer as it rides the conversation: a possibility named once
 *  for the agent to raise if the conversation invites it — never a
 *  standing instruction, and never repeated (the stamp sees to that). */
export function constraintOfferText(candidate: ConstraintOfferCandidate): string {
  return [
    "# 制約の草案（この草案については今回かぎり）",
    `仕事の結果から学んだ制約の草案「${candidate.text}」があります（対象: ${candidate.targetName}）。会話の流れで自然なときだけ、本人に一度「この制約を有効化しますか」と提案できます。`,
    "本人が言葉で望んだら、Settings › AI › Harnesses の審査キューで Activate します（有効化は Space の owner の審査によります）。本人が望まなければ、この提案は繰り返さないでください。",
  ].join("\n");
}

// ── Effect measurement (§3.6) ─────────────────────────────────────────

export interface ConstraintEffectInput {
  /** The rate the constraint claimed it would move (at activation). */
  baselineRate: number;
  /** Under-constraint outcomes so far: whether each carried the
   *  constraint's signature (the same rate, over the runs that ran
   *  under it — the collector's evidence block names them). */
  under: { outcomeId: string; carriesSignature: boolean }[];
  /** The previous evaluation's state (null: never judged). */
  prior: { status: "measuring" | "improving" | "established" | "ineffective"; firstImprovingAt: string | null } | null;
  now: Date;
}

export interface ConstraintEffectResult {
  status: "measuring" | "improving" | "established" | "ineffective";
  under: number;
  withSignature: number;
  rate: number;
  firstImprovingAt: string | null;
}

/**
 * Pure. The effect rule, in one place:
 *   - fewer than minUnderOutcomesForEffect outcomes under the
 *     constraint → measuring: the sample is too small to conclude
 *     anything, and silence is the correct behavior.
 *   - the signature rate has fallen below baseline → improving, and
 *     stays down across two evaluations ≥7 days apart → established
 *     (informational only — the natural candidate for a person to
 *     fold into the definition body proper, at which point the
 *     projection retires).
 *   - the rate has not fallen below baseline → ineffective: flagged
 *     in the review queue, NEVER auto-retired — retiring is a
 *     person's call, because a flat rate can mean the metric, not
 *     the constraint, is wrong.
 * An improving run that slips back loses its established clock: a
 * later improvement starts a fresh 7-day hold.
 */
export function effectOf(input: ConstraintEffectInput): ConstraintEffectResult {
  const under = input.under.length;
  const withSignature = input.under.filter((u) => u.carriesSignature).length;
  const rate = under ? round4(withSignature / under) : 0;
  if (under < CONSTRAINT_POLICY.minUnderOutcomesForEffect) {
    return { status: "measuring", under, withSignature, rate, firstImprovingAt: input.prior?.firstImprovingAt ?? null };
  }
  if (rate >= input.baselineRate) {
    return { status: "ineffective", under, withSignature, rate, firstImprovingAt: null };
  }
  const first = input.prior?.firstImprovingAt ?? input.now.toISOString();
  const heldMs = input.now.getTime() - new Date(first).getTime();
  if (heldMs >= CONSTRAINT_POLICY.establishedGapDays * 86_400_000) {
    return { status: "established", under, withSignature, rate, firstImprovingAt: first };
  }
  return { status: "improving", under, withSignature, rate, firstImprovingAt: first };
}

/** Pure. The constraints a run ran under: the active ones for its
 *  definition or Strategy whose activation predates the run and
 *  whose retirement (if any) postdates it. The collector stamps
 *  these ids onto the outcome's evidence block at settle time. */
export function activeConstraintIdsAt(
  constraints: readonly {
    id: string; scope: ConstraintScope;
    targetDefinitionId: string | null; targetStrategyId: string | null;
    activatedAt: string; retiredAt: string | null;
  }[],
  run: { definitionId: string | null; strategyId: string | null; createdAt: string },
): string[] {
  const at = run.createdAt;
  const out: string[] = [];
  for (const c of constraints) {
    const matches = c.scope === "definition"
      ? run.definitionId != null && c.targetDefinitionId === run.definitionId
      : run.strategyId != null && c.targetStrategyId === run.strategyId;
    if (!matches) continue;
    if (c.activatedAt > at) continue;
    if (c.retiredAt != null && c.retiredAt <= at) continue;
    out.push(c.id);
  }
  return out;
}

// ── The derivation (database shell) ───────────────────────────────────

export type ConstraintPhraser = (clusters: ConstraintCluster[]) => Promise<Map<string, string>>;

interface OutcomeRow {
  id: string;
  run_id: string;
  activity_space_id: string | null;
  definition_id: string | null;
  strategy_id: string | null;
  human_signal: string;
  finished_at: string;
}

interface RunRow {
  id: string;
  verdict: unknown;
  finish_detail: unknown;
  created_at: string | null;
}

interface ActionRow {
  run_id: string;
  status: string;
  decision_source: string | null;
  integration_id: string | null;
  tool: string;
  decision_note: string | null;
}

interface DraftRow {
  id: string;
  activity_space_id: string;
  scope: string;
  target_definition_id: string | null;
  target_strategy_id: string | null;
  status: string;
  expires_at: string | null;
}

const EXTERNAL_SOURCE = /^https?:\/\//i;

/**
 * One derivation, on the automations tick beside the collector and
 * the calibration evaluator. Stage 1 (code) clusters the window's
 * outcomes; stage 2 (the injected phraser) may phrase text for the
 * planned clusters; code validates the text and writes the drafts
 * with their evidence and hashes. Idempotent: a second pass over
 * the same world plans nothing, because the first pass's drafts are
 * open on their targets.
 */
export async function deriveConstraintDrafts(
  admin: SupabaseClient,
  now: Date,
  phraser: ConstraintPhraser,
): Promise<{ expired: number; clusters: number; planned: number; drafted: number; taintedDropped: number }> {
  const windowStart = windowStartOf(now, CONSTRAINT_POLICY.windowDays);
  const nowIso = now.toISOString();

  // Drafts whose review window lapsed leave the queue on their own —
  // the reviewer never has to clear a stale lesson by hand.
  let expired = 0;
  const { data: lapsed } = await admin.from("constraint_drafts")
    .update({ status: "expired", expires_at: null, updated_at: nowIso })
    .eq("status", "awaiting_review").lt("expires_at", nowIso)
    .select("id");
  expired = (lapsed ?? []).length;

  const { data: outcomeRows } = await admin.from("run_outcomes")
    .select("id, run_id, activity_space_id, definition_id, strategy_id, human_signal, finished_at")
    .gte("finished_at", windowStart)
    .order("finished_at", { ascending: false })
    .limit(CONSTRAINT_POLICY.readLimit);
  const outcomes = (outcomeRows ?? []) as OutcomeRow[];
  if (!outcomes.length) return { expired, clusters: 0, planned: 0, drafted: 0, taintedDropped: 0 };

  const runIds = [...new Set(outcomes.map((o) => o.run_id))];
  const runsById = new Map<string, RunRow>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await admin.from("agent_runs").select("id, verdict, finish_detail, created_at").in("id", runIds.slice(i, i + 200));
    for (const r of (data ?? []) as RunRow[]) runsById.set(r.id, r);
  }
  const actionsByRun = new Map<string, ActionRow[]>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await admin.from("agent_actions")
      .select("run_id, status, decision_source, integration_id, tool, decision_note")
      .in("run_id", runIds.slice(i, i + 200));
    for (const a of (data ?? []) as ActionRow[]) {
      const list = actionsByRun.get(a.run_id) ?? [];
      list.push(a);
      actionsByRun.set(a.run_id, list);
    }
  }
  const taintedRuns = new Set<string>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await admin.from("agent_run_steps").select("run_id").in("run_id", runIds.slice(i, i + 200)).like("title", "Web %");
    for (const s of (data ?? []) as { run_id: string }[]) taintedRuns.add(s.run_id);
  }

  const facts: OutcomeEvidenceFact[] = [];
  for (const o of outcomes) {
    const run = runsById.get(o.run_id);
    const verdict = run ? parseRunVerdict(run.verdict) : null;
    const detail = run ? parseFinishDetail(run.finish_detail) : null;
    const actions = actionsByRun.get(o.run_id) ?? [];
    const externalClaim = (detail?.claims ?? []).some((c) => c.source != null && EXTERNAL_SOURCE.test(c.source));
    facts.push({
      id: o.id,
      runId: o.run_id,
      spaceId: o.activity_space_id ?? "",
      definitionId: o.definition_id,
      strategyId: o.strategy_id,
      humanSignal: (o.human_signal as OutcomeEvidenceFact["humanSignal"]) ?? "none",
      finishedAt: o.finished_at,
      tainted: taintedRuns.has(o.run_id) || externalClaim,
      gaps: verdict?.gaps ?? [],
      claimGaps: verdict?.claimGaps ?? [],
      corrections: (verdict?.corrections ?? []).map((e) => ({ source: e.source, reason: e.reason })),
      rejections: actions
        .filter((a) => a.status === "rejected" && a.decision_source !== "policy")
        .map((a) => ({ integrationId: a.integration_id, tool: a.tool, noted: !!a.decision_note?.trim() })),
      connectorIds: [...new Set(actions.map((a) => a.integration_id).filter((x): x is string => !!x))],
    });
  }

  const definitionIds = [...new Set(facts.map((f) => f.definitionId).filter((x): x is string => !!x))];
  const strategyIds = [...new Set(facts.map((f) => f.strategyId).filter((x): x is string => !!x))];
  const checksByDefinition = new Map<string, readonly string[]>();
  const definitionTargets = new Map<string, { name: string; body: string }>();
  if (definitionIds.length) {
    const { data } = await admin.from("definitions").select("id, name, body").in("id", definitionIds);
    for (const d of (data ?? []) as { id: string; name: string; body: string }[]) {
      checksByDefinition.set(d.id, parseDefinition(d.body).checks.items);
      definitionTargets.set(d.id, { name: d.name, body: d.body });
    }
  }
  const strategyTargets = new Map<string, { name: string; description: string | null }>();
  if (strategyIds.length) {
    const { data } = await admin.from("strategies").select("id, name, description").in("id", strategyIds);
    for (const s of (data ?? []) as { id: string; name: string; description: string | null }[]) {
      strategyTargets.set(s.id, { name: s.name, description: s.description });
    }
  }

  const { clusters, taintedDropped } = clustersOf(facts, checksByDefinition);

  const { data: openRows } = await admin.from("constraint_drafts")
    .select("id, activity_space_id, scope, target_definition_id, target_strategy_id, status, expires_at")
    .in("status", ["draft", "awaiting_review"])
    .order("created_at", { ascending: true })
    .limit(500);
  const open = (openRows ?? []) as DraftRow[];
  const openPerSpace = new Map<string, number>();
  for (const d of open) openPerSpace.set(d.activity_space_id, (openPerSpace.get(d.activity_space_id) ?? 0) + 1);
  const planned = draftPlanOf(clusters, open, openPerSpace);
  if (!planned.length) return { expired, clusters: clusters.length, planned: 0, drafted: 0, taintedDropped };

  // The calibration bridge: an open revision candidate for the same
  // definition rides on the draft, so the review surface can show
  // the constraint as the one-action response to the calibration
  // claim (§3, B5's reserved 'gap_cluster' reason stays B6's to
  // write — B6 does not write candidates, it links them).
  const candidateByDefinition = new Map<string, string>();
  const plannedDefinitionIds = [...new Set(planned.filter((c) => c.scope === "definition").map((c) => c.targetId))];
  if (plannedDefinitionIds.length) {
    const { data } = await admin.from("definition_revision_candidates")
      .select("id, definition_id").eq("status", "open").in("definition_id", plannedDefinitionIds)
      .order("created_at", { ascending: true });
    for (const r of (data ?? []) as { id: string; definition_id: string }[]) {
      if (!candidateByDefinition.has(r.definition_id)) candidateByDefinition.set(r.definition_id, r.id);
    }
  }

  const texts = await phraser(planned);
  let drafted = 0;
  for (const cluster of planned) {
    const text = validateConstraintText(texts.get(cluster.clusterKey));
    if (!text) continue;
    const target = cluster.scope === "definition"
      ? definitionTargets.get(cluster.targetId)
      : strategyTargets.get(cluster.targetId);
    if (!target) continue;
    const targetVersion = await constraintTargetVersionOf(
      cluster.scope === "definition"
        ? { kind: "definition", body: (target as { body: string }).body }
        : { kind: "strategy", name: (target as { name: string }).name, description: (target as { description: string | null }).description },
    );
    const [structureHash, bindingHash] = await Promise.all([
      constraintStructureHash(text, cluster.scope),
      constraintBindingHash({ scope: cluster.scope, targetId: cluster.targetId, targetVersion, connectorIds: cluster.connectorIds }),
    ]);
    const snapshot = targetSnapshotOf(
      cluster.scope === "definition"
        ? { kind: "definition", body: (target as { body: string }).body }
        : { kind: "strategy", name: (target as { name: string }).name, description: (target as { description: string | null }).description },
    );
    const { error } = await admin.from("constraint_drafts").insert({
      activity_space_id: cluster.spaceId,
      scope: cluster.scope,
      target_definition_id: cluster.scope === "definition" ? cluster.targetId : null,
      target_strategy_id: cluster.scope === "strategy" ? cluster.targetId : null,
      constraint_text: text,
      derived_from: cluster.derivedFrom,
      signature: cluster.signature,
      evidence_outcome_ids: cluster.evidenceOutcomeIds,
      cluster: {
        outcomes: cluster.withSignature,
        withSignature: cluster.withSignature,
        windowOutcomes: cluster.windowOutcomes,
        baselineRate: cluster.baselineRate,
        signalled: cluster.signalledCount,
        samples: cluster.sampleTexts,
      },
      calibration_candidate_id: cluster.scope === "definition" ? (candidateByDefinition.get(cluster.targetId) ?? null) : null,
      structure_hash: structureHash,
      binding_hash: bindingHash,
      target_version: targetVersion,
      target_snapshot: snapshot,
      status: "awaiting_review",
      expires_at: new Date(now.getTime() + CONSTRAINT_POLICY.reviewDays * 86_400_000).toISOString(),
    });
    // A racing tick drafted the same target first (the one-open
    // index holds the line); that is a refresh's outcome, not an error.
    if (error && error.code !== "23505") console.error("constraints: draft insert failed", error.message);
    else if (!error) drafted += 1;
  }
  return { expired, clusters: clusters.length, planned: planned.length, drafted, taintedDropped };
}

// ── The effect evaluator (database shell) ─────────────────────────────

interface PlanningConstraintRow {
  id: string;
  activity_space_id: string;
  scope: string;
  target_definition_id: string | null;
  target_strategy_id: string | null;
  signature: string;
  derived_from: string;
  baseline_rate: number | string;
  effect_status: string;
  effect: Record<string, unknown>;
  activated_at: string;
}

interface EvidenceOutcomeRow {
  id: string;
  run_id: string;
  definition_id: string | null;
  strategy_id: string | null;
  evidence: { constraint_ids?: unknown } | null;
  finished_at: string;
}

/** Pure. Whether one under-constraint outcome carries the
 *  constraint's signature, from its sealed verdict and its actions. */
export function carriesSignature(args: {
  signature: string;
  derivedFrom: ConstraintDerivedFrom;
  verdict: ReturnType<typeof parseRunVerdict>;
  corrections: { source: "mechanical" | "verifier"; reason: string[] }[];
  rejections: { integrationId: string | null; tool: string; noted: boolean }[];
  checkItems: readonly string[];
}): boolean {
  const { signature, derivedFrom } = args;
  if (derivedFrom === "verifier_gap") {
    for (const gap of args.verdict?.gaps ?? []) if (gapSignatureOf(gap, args.checkItems) === signature) return true;
    for (const gap of args.verdict?.claimGaps ?? []) if (gapSignatureOf(gap, args.checkItems) === signature) return true;
    return false;
  }
  if (derivedFrom === "correction_pattern") {
    for (const env of args.corrections) {
      for (const reason of env.reason) {
        if (correctionSignatureOf(reason, env.source, args.checkItems) === signature) return true;
      }
    }
    return false;
  }
  return args.rejections.some((r) => rejectionSignatureOf(r) === signature);
}

/**
 * One evaluation of the constraints' effects, on the automations
 * tick beside the derivation. Reads the active constraints and the
 * outcomes that ran under them (the collector's evidence block),
 * re-derives each outcome's signature from its sealed verdict and
 * actions — the same code the derivation clusters with, so the
 * baseline and the follow-up cannot disagree about what counts —
 * and writes the effect status where it changed. A constraint
 * whose rate is not falling is flagged, never retired: the
 * measurement cannot act, only report.
 */
export async function evaluateConstraintEffects(
  admin: SupabaseClient,
  now: Date,
): Promise<{ evaluated: number; ineffective: number; established: number }> {
  let evaluated = 0, ineffective = 0, established = 0;
  const { data: constraintRows } = await admin.from("planning_constraints")
    .select("id, activity_space_id, scope, target_definition_id, target_strategy_id, signature, derived_from, baseline_rate, effect_status, effect, activated_at")
    .eq("status", "active")
    .order("activated_at", { ascending: true })
    .limit(CONSTRAINT_POLICY.constraintReadLimit);
  const constraints = (constraintRows ?? []) as PlanningConstraintRow[];
  if (!constraints.length) return { evaluated, ineffective, established };

  const earliest = constraints.reduce((m, c) => (c.activated_at < m ? c.activated_at : m), constraints[0].activated_at);
  const { data: outcomeRows } = await admin.from("run_outcomes")
    .select("id, run_id, definition_id, strategy_id, evidence, finished_at")
    .gte("finished_at", earliest)
    .order("finished_at", { ascending: true })
    .limit(CONSTRAINT_POLICY.readLimit);
  const outcomes = (outcomeRows ?? []) as EvidenceOutcomeRow[];
  const underByConstraint = new Map<string, EvidenceOutcomeRow[]>();
  for (const o of outcomes) {
    const ids = Array.isArray((o.evidence as { constraint_ids?: unknown } | null)?.constraint_ids)
      ? ((o.evidence as { constraint_ids: unknown[] }).constraint_ids.filter((x): x is string => typeof x === "string"))
      : [];
    for (const id of ids) {
      const list = underByConstraint.get(id) ?? [];
      list.push(o);
      underByConstraint.set(id, list);
    }
  }

  const runIds = [...new Set(outcomes.map((o) => o.run_id))];
  const runsById = new Map<string, RunRow>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await admin.from("agent_runs").select("id, verdict, finish_detail, created_at").in("id", runIds.slice(i, i + 200));
    for (const r of (data ?? []) as RunRow[]) runsById.set(r.id, r);
  }
  const actionsByRun = new Map<string, ActionRow[]>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data } = await admin.from("agent_actions")
      .select("run_id, status, decision_source, integration_id, tool, decision_note")
      .in("run_id", runIds.slice(i, i + 200));
    for (const a of (data ?? []) as ActionRow[]) {
      const list = actionsByRun.get(a.run_id) ?? [];
      list.push(a);
      actionsByRun.set(a.run_id, list);
    }
  }
  const definitionIds = [...new Set(constraints.map((c) => c.target_definition_id).filter((x): x is string => !!x))];
  const checksByDefinition = new Map<string, readonly string[]>();
  if (definitionIds.length) {
    const { data } = await admin.from("definitions").select("id, body").in("id", definitionIds);
    for (const d of (data ?? []) as { id: string; body: string }[]) {
      checksByDefinition.set(d.id, parseDefinition(d.body).checks.items);
    }
  }

  for (const c of constraints) {
    const checkItems = c.target_definition_id ? (checksByDefinition.get(c.target_definition_id) ?? []) : [];
    const under = (underByConstraint.get(c.id) ?? []).map((o) => {
      const run = runsById.get(o.run_id);
      const verdict = run ? parseRunVerdict(run.verdict) : null;
      const actions = actionsByRun.get(o.run_id) ?? [];
      return {
        outcomeId: o.id,
        carriesSignature: carriesSignature({
          signature: c.signature,
          derivedFrom: c.derived_from as ConstraintDerivedFrom,
          verdict,
          corrections: (verdict?.corrections ?? []).map((e) => ({ source: e.source, reason: e.reason })),
          rejections: actions
            .filter((a) => a.status === "rejected" && a.decision_source !== "policy")
            .map((a) => ({ integrationId: a.integration_id, tool: a.tool, noted: !!a.decision_note?.trim() })),
          checkItems,
        }),
      };
    });
    const prior = c.effect && typeof c.effect === "object" && typeof c.effect.firstImprovingAt === "string"
      ? { status: (c.effect_status as ConstraintEffectResult["status"]) ?? "measuring", firstImprovingAt: c.effect.firstImprovingAt as string | null }
      : { status: (c.effect_status as ConstraintEffectResult["status"]) ?? "measuring", firstImprovingAt: null };
    const result = effectOf({ baselineRate: Number(c.baseline_rate), under, prior, now });
    evaluated += 1;
    if (result.status === "ineffective") ineffective += 1;
    if (result.status === "established") established += 1;
    if (result.status !== c.effect_status || result.under !== (c.effect?.under as number | undefined)) {
      const { error } = await admin.from("planning_constraints").update({
        effect_status: result.status,
        effect: {
          under: result.under,
          withSignature: result.withSignature,
          rate: result.rate,
          baselineRate: Number(c.baseline_rate),
          firstImprovingAt: result.firstImprovingAt,
          evaluatedAt: now.toISOString(),
        },
        updated_at: now.toISOString(),
      }).eq("id", c.id).eq("status", "active");
      if (error) console.error("constraints: effect update failed", error.message);
    }
  }
  return { evaluated, ineffective, established };
}

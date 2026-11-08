// Promotion's pure half: the vocabulary the promotion path runs on —
//
//   - the draft's state machine (which moves are legal, from where),
//   - the package: a definition (name + body) and its binding (the
//     Object its Elements land on, their title and description
//     templates, and a schedule trigger — v1 drafts schedules only),
//   - the two hashes activation binds: the structure (name + body) and
//     the binding (Object + templates + trigger + the connector set
//     the body names), computed through the one canonical-JSON
//     implementation the G4 path already uses — never a fork,
//   - the pre-drafting reconcile (design §4.5): the checks that run
//     before anything is written, so a promotion never makes a second
//     route to work that already has one (pattern #7),
//   - the drafting policy's gate on top of checkHarness: what a
//     promoted definition must carry beyond being valid (§4.4),
//   - drift: which edits to a promoted definition are structural, and
//   - the failure classes a rehearsal can end in (§4.6).
//
// Nothing here touches the database or the network; the store lives in
// promotionDrafts.ts, the driver in run-agent, the rehearsal substrate
// in rehearsal.ts.

import { canonicalJson } from "./integrationPlans.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { parseDefinition, type ParsedDefinition, type Diagnostic } from "./definition.ts";
import { foldConnectorName } from "./connectorNeeds.ts";
import { scrubText } from "./memoryScrub.ts";
import type { MemoryRow } from "./memoryStore.ts";

// ── The state machine ──────────────────────────────────────────────────

export type PromotionStatus =
  | "drafting"
  | "awaiting_input"
  | "rehearsing"
  | "awaiting_review"
  | "active"
  | "rejected"
  | "expired"
  | "failed";

/** The statuses a draft can still be worked on or decided in — the
 *  caps and the one-open-draft rule count these. */
export const PROMOTION_OPEN_STATUSES: readonly PromotionStatus[] = [
  "drafting", "awaiting_input", "rehearsing", "awaiting_review",
];

const TRANSITIONS: Readonly<Record<PromotionStatus, readonly PromotionStatus[]>> = {
  // `failed` is the drafter's honest end (§4.6): the material cannot be
  // drafted from, or the revision rounds ran out — returned to the
  // person as failed rather than left open against the caps.
  drafting: ["awaiting_input", "rehearsing", "rejected", "failed"],
  awaiting_input: ["drafting", "rejected", "failed"],
  // A rehearsal whose report says a class other than `tested` returns
  // to drafting with the failure recorded; an unverifiable one may be
  // acknowledged forward to review (decision 4's only substitution).
  rehearsing: ["awaiting_review", "drafting", "rejected", "failed"],
  awaiting_review: ["active", "drafting", "rejected", "expired"],
  active: [],
  rejected: [],
  expired: [],
  failed: [],
};

export function canPromotionTransition(from: PromotionStatus, to: PromotionStatus): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

// ── Bounds (the approved defaults) ────────────────────────────────────

/** Review expiry: 7 days, as G4's — a person reviews while the
 *  rehearsal is still representative. */
export const PROMOTION_REVIEW_DAYS = 7;
export function promotionReviewExpiresAt(from: Date): Date {
  return new Date(from.getTime() + PROMOTION_REVIEW_DAYS * 24 * 60 * 60 * 1000);
}

export const MAX_OPEN_PROMOTION_DRAFTS_PER_SPACE = 10;
export const MAX_OPEN_PROMOTION_DRAFTS_PER_REQUESTER = 5;

/** Revision rounds a rehearsal failure may send back (G4's bound, the
 *  same cost discipline). */
export const MAX_PROMOTION_REVISIONS = 3;

/** The rehearsal's cost cap, per run (decision 4). A drafting-policy
 *  constant, not part of the binding a person approves. */
export const REHEARSAL_COST_CAP_USD = 1;

// ── The package ────────────────────────────────────────────────────────

export interface PromotionTrigger {
  kind: "schedule";
  cron: string;
  timezone: string;
}

export interface PromotionBinding {
  objectId: string | null;
  titleTemplate: string;
  descriptionTemplate: string;
  /** Null: no Automation is created at activation (decision 2 allows
   *  a trigger-less package — the harness exists, a person runs it). */
  trigger: PromotionTrigger | null;
}

export interface PromotionPackage {
  name: string;
  body: string;
  binding: PromotionBinding;
}

export const EMPTY_PROMOTION_BINDING: PromotionBinding = {
  objectId: null, titleTemplate: "", descriptionTemplate: "", trigger: null,
};

/** Tolerant reader for a stored binding (the row is jsonb; a hand-made
 *  or older row must read as the empty binding, never throw). */
export function readPromotionBinding(json: unknown): PromotionBinding {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ...EMPTY_PROMOTION_BINDING };
  const b = json as Record<string, unknown>;
  const t = b.trigger && typeof b.trigger === "object" && !Array.isArray(b.trigger)
    ? (b.trigger as Record<string, unknown>) : null;
  const trigger: PromotionTrigger | null = t && t.kind === "schedule"
    && typeof t.cron === "string" && t.cron.trim() !== ""
    ? {
      kind: "schedule",
      cron: t.cron,
      timezone: typeof t.timezone === "string" && t.timezone.trim() !== "" ? t.timezone : "Asia/Tokyo",
    }
    : null;
  return {
    objectId: typeof b.objectId === "string" && b.objectId !== "" ? b.objectId : null,
    titleTemplate: typeof b.titleTemplate === "string" ? b.titleTemplate : "",
    descriptionTemplate: typeof b.descriptionTemplate === "string" ? b.descriptionTemplate : "",
    trigger,
  };
}

// ── The hashes activation binds ────────────────────────────────────────

/** The structure hash: the definition itself (name + body). One
 *  definition of "the definition a person tested", shared by the
 *  draft's tested hash, the activation's stored hashes and the base
 *  hash of an update — a definition row and a draft package fingerprint
 *  through the same function, so they can be compared. */
export async function promotionStructureHash(name: string, body: string): Promise<string> {
  return sha256Hex(canonicalJson({ name, body }));
}

/** The binding hash: everything outside the body that decides what the
 *  Automation will do — where Elements land, what they are called, when
 *  they fire, and which connectors the body names (sorted, folded: the
 *  set, not the spelling order). */
export async function promotionBindingHash(pkg: PromotionPackage): Promise<string> {
  const parsed = parseDefinition(pkg.body);
  const connectors = [...new Set(parsed.connectors.map((name) => foldConnectorName(name)))].sort();
  return sha256Hex(canonicalJson({
    objectId: pkg.binding.objectId,
    titleTemplate: pkg.binding.titleTemplate,
    descriptionTemplate: pkg.binding.descriptionTemplate,
    trigger: pkg.binding.trigger,
    connectors,
  }));
}

// ── Failure classes (§4.6) ─────────────────────────────────────────────

export type PromotionFailureClass =
  | "definition_invalid"
  | "connector_missing"
  | "read_failed"
  | "write_plan_invalid"
  | "unverifiable";

/** Precedence when a rehearsal shows several: the earliest stage's
 *  problem is the one worth surfacing (a definition that does not parse
 *  makes the read errors beside it noise). `unverifiable` ranks last —
 *  it is the absence of evidence, not a failure found. */
export const PROMOTION_FAILURE_ORDER: readonly PromotionFailureClass[] = [
  "definition_invalid", "connector_missing", "read_failed", "write_plan_invalid", "unverifiable",
];

export function primaryPromotionFailure(
  classes: readonly PromotionFailureClass[],
): PromotionFailureClass | null {
  for (const c of PROMOTION_FAILURE_ORDER) if (classes.includes(c)) return c;
  return null;
}

// ── The reconcile (§4.5): before anything is written ──────────────────

export interface PromotionSourceRef {
  kind: "memory" | "run";
  memoryId?: string | null;
  runId?: string | null;
}

export interface PromotionOpenDraftRef {
  id: string;
  sourceMemoryId: string | null;
  sourceRunId: string | null;
}

/** Rules 1 and 2, decidable at draft start: an open draft for the same
 *  source is joined, and a source that already produced a definition
 *  drafts an update against it, not a rival. */
export function reconcilePromotionSource(args: {
  source: PromotionSourceRef;
  openDrafts: readonly PromotionOpenDraftRef[];
  /** The definition this source already produced (resolved through the
   *  active draft's activated id), if any. */
  promotedDefinition: { id: string; name: string } | null;
}): { joinDraftId: string | null; asUpdateOf: { id: string; name: string } | null } {
  const join = args.openDrafts.find((d) =>
    (args.source.kind === "memory" && args.source.memoryId != null && d.sourceMemoryId === args.source.memoryId)
    || (args.source.kind === "run" && args.source.runId != null && d.sourceRunId === args.source.runId),
  ) ?? null;
  return {
    joinDraftId: join?.id ?? null,
    asUpdateOf: join ? null : args.promotedDefinition,
  };
}

const foldName = (name: string): string => name.trim().toLowerCase();

/** Rules 3 and 4, decidable once a package is proposed: a *different*
 *  definition already carrying the proposed name is shown, not silently
 *  collided with; and an Automation already binding this definition to
 *  this Object is reported before review, so the reviewer decides with
 *  the duplication in view. */
export function reconcilePromotionPackage(args: {
  pkg: PromotionPackage;
  /** The update target, when the draft updates an existing definition:
   *  the package's own definition is not a conflict with itself. */
  targetDefinitionId: string | null;
  definitions: readonly { id: string; name: string }[];
  automations: readonly { definitionId: string | null; objectId: string | null }[];
}): { nameConflict: { id: string; name: string } | null; bindingDuplicate: boolean } {
  const wanted = foldName(args.pkg.name);
  const conflict = args.definitions.find((d) =>
    d.id !== args.targetDefinitionId && foldName(d.name) === wanted) ?? null;
  const candidateId = args.targetDefinitionId ?? conflict?.id ?? null;
  const bindingDuplicate = candidateId != null && args.pkg.binding.objectId != null
    && args.automations.some((a) => a.definitionId === candidateId && a.objectId === args.pkg.binding.objectId);
  return { nameConflict: conflict, bindingDuplicate };
}

// ── The drafting policy's gate (§4.4, on top of checkHarness) ─────────

export interface PromotionGate {
  errors: string[];
  warnings: string[];
}

/** What a promoted definition must satisfy beyond being a valid harness
 *  (checkHarness's diagnostics are the base): a *numeric* cost ceiling in
 *  `# 止める条件` — the floor for work nobody watches (decision 7). A
 *  missing `# 点検` is a warning, not a block: the harness is usable,
 *  but §4.9's report would have nothing to measure against. */
export function promotionPackageGate(
  parsed: ParsedDefinition,
  diagnostics: readonly Diagnostic[],
): PromotionGate {
  const errors: string[] = diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const warnings: string[] = diagnostics
    .filter((d) => d.severity === "warning" || d.severity === "hint").map((d) => d.message);
  if (parsed.stop.budgetUsd == null) {
    errors.push(
      "昇格する定義には「# 止める条件」に費用の数値上限が要ります（例:「- 費用 $2 まで」）。"
      + "誰も見ていない仕事の床です。",
    );
  }
  if (parsed.checks.items.length === 0) {
    warnings.push("「# 点検」がありません。成果の報告で測る物差しがなくなります。");
  }
  return { errors, warnings };
}

/** The connector stage of testing: the connectors the body names that
 *  are not connected. Folded comparison, the same equality the rest of
 *  the product uses. */
export function missingPromotionConnectors(
  parsed: ParsedDefinition,
  connectedNames: readonly string[],
): string[] {
  const have = new Set(connectedNames.map((n) => foldConnectorName(n)));
  const missing: string[] = [];
  for (const name of parsed.connectors) {
    if (name === "") continue;
    if (!have.has(foldConnectorName(name)) && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

// ── Drift (§4.8): cosmetic vs structural ───────────────────────────────

export interface PromotionDrift {
  drifted: boolean;
  /** The structural aspects that changed, in words for the review
   *  screen: goal / connectors / stop conditions / measure / output. */
  aspects: string[];
}

const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** Compares the activated form of a definition with its current form.
 *  Structural = the work itself changed (what it aims at, which
 *  connectors it drives, where it stops, what counts as done, what it
 *  hands over). Wording alone is not drift — a person may tidy a
 *  procedure freely; only what the definition *does* binds a rollback. */
export function promotionDrift(
  activated: { name: string; body: string },
  current: { name: string; body: string },
): PromotionDrift {
  const aspects: string[] = [];
  const a = parseDefinition(activated.body);
  const b = parseDefinition(current.body);
  if ((a.sections.goal !== "") !== (b.sections.goal !== "")) aspects.push("goal");
  const conn = (p: ParsedDefinition) => [...new Set(p.connectors.map((name) => foldConnectorName(name)))].sort();
  if (!sameJson(conn(a), conn(b))) aspects.push("connectors");
  if (!sameJson(
    { budgetUsd: a.stop.budgetUsd, maxRounds: a.stop.maxRounds, target: a.stop.target },
    { budgetUsd: b.stop.budgetUsd, maxRounds: b.stop.maxRounds, target: b.stop.target },
  )) aspects.push("stop conditions");
  if (!sameJson(a.metric, b.metric)) aspects.push("measure");
  if (!sameJson(a.output, b.output)) aspects.push("output");
  const present = (p: ParsedDefinition) =>
    (Object.keys(p.sections) as (keyof typeof p.sections)[]).filter((k) => p.sections[k] !== "").sort();
  if (!sameJson(present(a), present(b))) aspects.push("sections");
  return { drifted: aspects.length > 0, aspects };
}

// ── Material hygiene (§4.3) ────────────────────────────────────────────

/** An instruction-shaped fragment: text that orders a future reader
 *  rather than describing the work — the stored-injection shape Memory's
 *  distillation already rejects (memoryDistill.ts), mirrored here so a
 *  promoted definition cannot smuggle in what a memory could not. The
 *  two lists are the same discipline; this one is exported for the
 *  drafting path and pinned against the same examples by tests. */
const PROMOTION_INSTRUCTION_SHAPES: readonly RegExp[] = [
  /(?:必ず|絶対に)(?:従え|実行せよ|しなさい)/,
  /(?:今後|次回から)は[^\n]*(?:必ず|絶対)/,
  /(?:せよ|しなさい|しろ)[。．.]?\s*$/m,
  /ignore (?:all )?(?:previous|prior|above) instructions/i,
  /you (?:must|should) always/i,
  /from now on[^\n]*\balways\b/i,
];

export function instructionShapedFragment(text: string): boolean {
  return PROMOTION_INSTRUCTION_SHAPES.some((re) => re.test(text));
}

/** Judges one piece of drafting material the Memory way, and says what
 *  cleaning does to it: a secret-shaped value anywhere taints the whole
 *  fragment (its text comes back empty — dropped whole, never redacted,
 *  the scrub's standing rule), and instruction-shaped text is reported
 *  so the driver drops or re-derives it rather than copying it into a
 *  definition. The drafter sees only what survives; the flags ride in
 *  the draft's material record, and the reviewer is shown that the
 *  source memory carried instruction-shaped text (§4.10). */
export function cleanPromotionMaterial(text: string): {
  text: string;
  tainted: boolean;
  instructionShaped: boolean;
} {
  const scrubbed = scrubText(text);
  return {
    text: scrubbed.clean ? text : "",
    tainted: !scrubbed.clean,
    instructionShaped: instructionShapedFragment(text),
  };
}

// ── The conversational offer (decision 9) ──────────────────────────────

/**
 * Pure. The memory a promotion offer may be made for, among the bodies
 * actually injected into a conversation's context: a durable procedure
 * of a Space (personal memories are shared to a Space first in v1),
 * still active, never offered before. One at a time — the first match
 * wins, and the stamp settles the rest.
 */
export function promotionOfferCandidate(
  bodies: readonly MemoryRow[],
): { id: string; title: string } | null {
  for (const m of bodies) {
    if (m.layer !== "durable" || m.kind !== "procedure" || m.status !== "active") continue;
    if (!m.activity_space_id) continue;
    if (m.promotion_offered_at) continue;
    return { id: m.id, title: m.title };
  }
  return null;
}

/** The offer as it rides the memory section: a possibility named once
 *  for the agent to raise if the conversation invites it — never a
 *  standing instruction, and never repeated (the stamp sees to that). */
export function promotionOfferText(candidate: { id: string; title: string }): string {
  return [
    "# 定常化の提案（この記憶については今回かぎり）",
    `本文が読み込まれた durable な手順「${candidate.title}」は、繰り返し使われている知見です。会話の流れで自然なときだけ、本人に一度「この手順をハーネスとして定常化しますか」と提案できます。`,
    `本人が言葉で望んだら start_promotion（memoryId: ${candidate.id}）を呼ぶと起草が始まります（起草は下書きまでで、有効化は Space の owner の審査によります）。本人が望まなければ、この提案は繰り返さないでください。`,
  ].join("\n");
}

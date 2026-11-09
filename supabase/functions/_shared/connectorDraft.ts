// G4: a connection the AI drafts, a test verifies, and a person activates.
//
// This module is the pure half: the draft's state machine, the reconcile
// that runs before any drafting (an existing route is never drafted
// around — pattern #7, no duplicate tools), the drafting rules a
// candidate must pass on the server (never the model's self-report), the
// failure vocabulary a test round speaks, and the hashes a tested draft
// is bound by. The database half lives in integrationDrafts.ts; the
// command-test executor in draftTest.ts. Design:
// ~/workspace/dev/alcon-g4-design.md (with its 2026-11-08 addendum).

import { parseManifest, type Manifest } from "./connectorManifest.ts";
import { foldConnectorName } from "./connectorNeeds.ts";
import { isSafeEndpoint, WRITE_VERB } from "./integrationClient.ts";
import { canonicalJson } from "./integrationPlans.ts";
import { sha256Hex } from "./googleOAuth.ts";

// ── The draft and its states ─────────────────────────────────────────────

export type DraftStatus =
  | "drafting" | "awaiting_input" | "testing" | "awaiting_review"
  | "active" | "rejected" | "failed" | "expired" | "superseded" | "rerouted";

/** The statuses a draft is still open in (one per Space + name, capped per Space and requester). */
export const DRAFT_OPEN_STATUSES: readonly DraftStatus[] = ["drafting", "awaiting_input", "testing", "awaiting_review"];

export function isDraftOpen(status: string): status is DraftStatus {
  return (DRAFT_OPEN_STATUSES as readonly string[]).includes(status);
}

/** Pure. The transitions the state machine allows; every writer (the
 *  draft driver, the test, the RPCs, the tick) is held to this table. */
export const DRAFT_TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  drafting: ["awaiting_input", "testing", "failed", "rerouted", "superseded"],
  awaiting_input: ["drafting", "failed", "superseded"],
  testing: ["awaiting_review", "drafting", "failed", "superseded"],
  awaiting_review: ["active", "rejected", "expired", "superseded"],
  active: ["superseded"],
  rejected: [],
  failed: [],
  expired: [],
  superseded: [],
  rerouted: [],
};

export function canDraftTransition(from: string, to: DraftStatus): boolean {
  return (DRAFT_TRANSITIONS[from as DraftStatus] ?? []).includes(to);
}

/** The preset a drafted connection carries, so its provenance is visible everywhere a preset is. */
export const AI_DRAFTED_PRESET = "ai-drafted";

/** A draft's review waits this long for its owner (the Copilot approval's seven days). */
export const DRAFT_REVIEW_DAYS = 7;

export function draftReviewExpiresAt(from: Date): string {
  return new Date(from.getTime() + DRAFT_REVIEW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** One draft may declare at most this many commands. */
export const MAX_DRAFT_COMMANDS = 30;
/** Test rounds per draft before it fails with its evidence kept. */
export const MAX_DRAFT_TEST_ROUNDS = 3;
/** Open drafts a Space / one requester may hold at once (drafting spends the Space's budget). */
export const MAX_OPEN_DRAFTS_PER_SPACE = 10;
export const MAX_OPEN_DRAFTS_PER_REQUESTER = 5;
/** A drafted guide is advice an agent reads; it is kept short and on-host (validateDraftCandidate). */
export const GUIDE_MAX_CHARS = 4000;

/** The key a draft's name is matched and de-duplicated by (the connector fold). */
export const draftNameKey = foldConnectorName;

// ── Reconcile: is there already a route to this service? ─────────────────

export interface ReconcileRow {
  id: string;
  name: string;
  preset: string | null;
  enabled: boolean;
  endpoint: string;
}

export interface ReconcilePreset { id: string; name: string }

export interface ReconcileDraft { id: string; name_key: string; status: string }

export type ReconcileOutcome =
  | { kind: "connected"; rowId: string }
  | { kind: "preset"; presetId: string }
  | { kind: "registry"; title: string; endpoint: string }
  | { kind: "update"; rowId: string }
  | { kind: "join"; draftId: string }
  | { kind: "create" };

const fold = foldConnectorName;

function rowAliases(row: ReconcileRow, presets: readonly ReconcilePreset[]): string[] {
  const presetName = presets.find((p) => p.id === row.preset)?.name ?? "";
  return [row.name, row.preset ?? "", presetName].filter(Boolean);
}

function hostOf(raw: string): string | null {
  try { return new URL(raw).hostname.toLowerCase().replace(/\.+$/, ""); } catch { return null; }
}

/**
 * Pure. Whether a service already has a route, checked in the design's
 * order — an enabled connection, a built-in preset, the MCP Registry, an
 * existing (even disabled) connection to update, an open draft to join —
 * and only then a new draft. Callers gather the inputs (the registry hit
 * is a network answer everywhere else); the decision itself is this one
 * function, on the server and in the web's twin (draftModel.ts), so the
 * two cannot disagree.
 */
export function reconcileDraft(args: {
  name: string;
  rows: readonly ReconcileRow[];
  presets: readonly ReconcilePreset[];
  registryHit: { title: string; endpoint: string } | null;
  drafts: readonly ReconcileDraft[];
  selfDraftId?: string | null;
  /** The host of a URL the person supplied (docs or endpoint), when known. */
  knownHost?: string | null;
}): ReconcileOutcome {
  const key = fold(args.name);
  if (!key) return { kind: "create" };
  const matches = (row: ReconcileRow) => rowAliases(row, args.presets).some((a) => fold(a) === key);
  const connected = args.rows.find((r) => r.enabled && matches(r));
  if (connected) return { kind: "connected", rowId: connected.id };
  const preset = args.presets.find((p) => fold(p.id) === key || fold(p.name) === key);
  if (preset) return { kind: "preset", presetId: preset.id };
  if (args.registryHit) return { kind: "registry", title: args.registryHit.title, endpoint: args.registryHit.endpoint };
  const existing = args.rows.find((r) => matches(r))
    ?? (args.knownHost ? args.rows.find((r) => hostOf(r.endpoint) === args.knownHost) : undefined);
  if (existing) return { kind: "update", rowId: existing.id };
  const open = args.drafts.find((d) => d.id !== args.selfDraftId && d.name_key === key && isDraftOpen(d.status));
  if (open) return { kind: "join", draftId: open.id };
  return { kind: "create" };
}

/** Pure. The open drafts answering these names, in the order named —
 *  what a surface that names a missing connector (a conversation's
 *  context, a start card) says about the connection already in flight
 *  for it: being drafted or tested, or waiting for its review or for a
 *  person's answer. Closed drafts answer nothing. */
export function openDraftsForNames(
  names: readonly string[],
  drafts: readonly ReconcileDraft[],
): { name: string; status: DraftStatus }[] {
  const byKey = new Map<string, DraftStatus>();
  for (const d of drafts) if (isDraftOpen(d.status) && !byKey.has(d.name_key)) byKey.set(d.name_key, d.status);
  return names.flatMap((name) => {
    const status = byKey.get(draftNameKey(name));
    return status ? [{ name, status }] : [];
  });
}

// ── Hosts: what "the official host" means ────────────────────────────────

// Two-level public suffixes this product's services commonly sit under.
// A simplification, stated as one: registrableDomain is eTLD+1 for the
// common cases, not a full public-suffix database.
const TWO_LEVEL_SUFFIXES = new Set([
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "ed.jp", "lg.jp",
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz",
  "com.br", "com.cn", "com.tw", "co.kr", "ne.kr", "com.mx", "co.in",
  "com.sg", "com.hk", "com.ar", "com.co", "co.za", "com.pl", "com.tr",
]);

/** Pure. A host's registrable domain (eTLD+1): api.example.com and
 *  docs.example.com share one; example.com and example.net do not. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(last2) ? labels.slice(-3).join(".") : last2;
}

/** Pure. Whether two hosts are the same registrable domain — the only
 *  sense in which a spec's alternative server may be picked automatically. */
export function sameRegistrableDomain(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

// ── The candidate and the drafting rules ─────────────────────────────────

export interface DraftCandidate {
  name: string;
  endpoint: string;
  authType: string;
  authHeader: string | null;
  manifest: unknown;
  guide: string | null;
  testInputs: Record<string, Record<string, unknown>>;
  sources: string[];
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
// The same reserved set the web's buildIntegrationRow refuses: a credential
// must not ride in a header the client or the protocol owns.
const RESERVED_HEADERS = new Set(["host", "content-type", "content-length", "accept", "mcp-session-id", "mcp-protocol-version"]);

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

const CREDENTIAL_WORD = /(api[-_ ]?key|apiキー|apikey|token|トークン|secret|password|パスワード|認証情報|credential|authorization)/i;
const SEND_WORD = /(送|転送|共有|渡し|渡す|送信|send|post|share|upload|アップロード|forward)/i;

/**
 * Pure. The rules for a drafted guide: short, no URL off the endpoint's
 * host (a guide is read by future runs; an off-host URL is an instruction
 * to carry data — and with it, context — somewhere nobody reviewed), and
 * no sentence that puts a credential together with sending it anywhere.
 * The wording checks are a floor, stated as one in the design; the real
 * binding is that the tested guide is the activated guide (the content
 * hash covers it).
 */
export function validateGuide(guide: string | null, endpointHost: string | null): string[] {
  if (guide == null || guide.trim() === "") return [];
  const errors: string[] = [];
  if (guide.length > GUIDE_MAX_CHARS) errors.push(`guide は ${GUIDE_MAX_CHARS} 文字以内にしてください`);
  for (const m of guide.matchAll(/https?:\/\/[^\s)'"<>]+/g)) {
    const host = hostOf(m[0]);
    if (host && endpointHost && host !== endpointHost) {
      errors.push(`guide に endpoint のホスト（${endpointHost}）以外の URL は書けません: ${m[0].slice(0, 80)}`);
    }
  }
  // URLs are checked above; strip them before the sentence scan so their
  // own punctuation does not split a sentence around the words it joins.
  const prose = guide.replace(/https?:\/\/[^\s)'"<>]+/g, " ");
  for (const sentence of prose.split(/[。.!?\n]+/)) {
    if (CREDENTIAL_WORD.test(sentence) && SEND_WORD.test(sentence)) {
      errors.push("guide に認証情報を扱う指示は書けません");
      break;
    }
  }
  return errors;
}

/**
 * Pure. A drafted candidate against the drafting rules — the server's
 * check, never the model's word: the manifest must parse, its defaults
 * stay read=allow / write=ask, a write's permission is exactly ask with
 * no allow rule anywhere on it, a read's name must not carry a writing
 * verb, the endpoint must pass the same guard every request passes, the
 * auth is a key-shaped one (OAuth cannot be drafted), no command may
 * name a response transform (a code reference is first-party only),
 * the guide obeys validateGuide, and — when the person's own host is
 * known — the endpoint must sit in that host's registrable domain.
 * Errors are Japanese, in parseManifest's voice, because they go
 * straight back to the drafting model as its feedback.
 */
export function validateDraftCandidate(
  c: DraftCandidate,
  opts: { officialHost?: string | null } = {},
): { errors: string[]; manifest: Manifest | null } {
  const errors: string[] = [];
  const name = (c.name ?? "").trim();
  if (!name) errors.push("名前が要ります");
  if (name.length > 120) errors.push("名前は 120 文字以内にしてください");

  const endpointHost = hostOf(c.endpoint ?? "");
  if (!isSafeEndpoint(c.endpoint ?? "")) errors.push("endpoint は https の公開ホストにしてください");
  if (opts.officialHost && endpointHost && !sameRegistrableDomain(endpointHost, opts.officialHost)) {
    errors.push(`endpoint のホスト（${endpointHost}）が、公式ホスト（${opts.officialHost}）と同じドメインにありません。公式の API ホストが分からない場合は推測せず、人に確認してください`);
  }

  if (c.authType === "oauth") {
    errors.push("サインイン方式（OAuth）のサービスはまだ起草できません。人に、その旨を伝えてください");
  } else if (c.authType !== "none" && c.authType !== "bearer" && c.authType !== "header") {
    errors.push("auth は none / bearer / header のいずれかにしてください");
  }
  if (c.authType === "header") {
    const header = (c.authHeader ?? "").trim();
    if (!HEADER_NAME.test(header) || RESERVED_HEADERS.has(header.toLowerCase())) {
      errors.push("認証ヘッダ名が正しくありません（予約済みのヘッダは使えません）");
    }
  } else if (c.authHeader) {
    errors.push("auth が header でない場合、authHeader は空にしてください");
  }

  const { manifest, errors: manifestErrors } = parseManifest(c.manifest);
  errors.push(...manifestErrors);
  const raw = obj(c.manifest);
  const defaults = obj(raw?.defaults);
  if (defaults) {
    if (defaults.read !== undefined && defaults.read !== "allow") errors.push("defaults.read は allow のままにしてください（起草では緩められません）");
    if (defaults.write !== undefined && defaults.write !== "ask") errors.push("defaults.write は ask のままにしてください（起草では緩められません）");
  }
  if (manifest.commands.length > MAX_DRAFT_COMMANDS) {
    errors.push(`command は1ドラフト ${MAX_DRAFT_COMMANDS} 件までです（仕事に近いものを優先してください）`);
  }
  for (const cmd of manifest.commands) {
    // A named transform is a code reference, and code references are
    // first-party equipment: the drafting model does not get to point
    // a command at one (design §3.4). An unknown name has already
    // failed in parseManifest; a known one fails here.
    if (cmd.transform) errors.push(`${cmd.name}: transform（名前付きのレスポンス整形）は起草では使えません（第一者のマニフェスト専用です）`);
    if (cmd.effect === "write") {
      if (cmd.permission !== "ask") errors.push(`${cmd.name}: 書き込みの permission は ask にしてください（起草では allow にも deny にもできません）`);
      if (cmd.rules.some((r) => r.permission === "allow")) errors.push(`${cmd.name}: 書き込みに allow の rule は付けられません（永続許可は人が後から設定します）`);
    } else if (WRITE_VERB.test(cmd.name)) {
      errors.push(`${cmd.name}: 名前に変更を思わせる動詞があるため read にはできません。読み取り専用である根拠を示すか、write としてください`);
    }
  }

  errors.push(...validateGuide(c.guide, endpointHost));

  for (const [command, input] of Object.entries(c.testInputs ?? {})) {
    if (!manifest.commands.some((cmd) => cmd.name === command)) errors.push(`test_inputs の ${command} は command にありません`);
    else if (!obj(input)) errors.push(`test_inputs.${command} はオブジェクトにしてください`);
  }
  for (const s of c.sources ?? []) {
    if (typeof s !== "string" || !/^https:\/\//.test(s)) errors.push(`出典は https の URL で記録してください: ${String(s).slice(0, 80)}`);
  }
  return { errors, manifest };
}

/** A required command the drafter wants to drop, with the reason a person will read. */
export interface DraftDrop { name: string; reason: string }

/**
 * Pure. The required commands a candidate leaves out without a stated
 * drop: the first accepted candidate fixes the draft's required set, and
 * from then on a required command leaves only through a drop with a
 * reason — never silently, and never just because its test failed.
 * Returns error strings (empty when every absence is accounted for).
 */
export function unaccountedDrops(
  required: readonly string[],
  candidate: Manifest,
  drops: readonly DraftDrop[],
): string[] {
  const present = new Set(candidate.commands.map((c) => c.name));
  const explained = new Set(drops.filter((d) => d.reason?.trim()).map((d) => d.name));
  return required
    .filter((name) => !present.has(name) && !explained.has(name))
    .map((name) => `${name} は必須 command です。外す場合は drops に理由を書いてください`);
}

// ── What a draft is bound by: the content hashes ─────────────────────────

/** The content a test binds and activation checks: everything a future
 *  run will act on — where requests go, how they authenticate, what the
 *  commands are, what they are called, and the guide that advises them. */
export interface DraftContent {
  name: string;
  endpoint: string;
  auth_type: string;
  auth_header: string | null;
  manifest: unknown;
  guide: string | null;
}

export function draftContentOf(d: {
  name: string; endpoint: string | null; auth_type: string | null; auth_header: string | null;
  manifest: unknown; guide: string | null;
}): DraftContent {
  return {
    name: d.name, endpoint: d.endpoint ?? "", auth_type: d.auth_type ?? "none",
    auth_header: d.auth_header ?? null, manifest: d.manifest ?? null, guide: d.guide ?? null,
  };
}

/** Pure but for the digest. The one canonicalization (integrationPlans'
 *  canonicalJson) and the one hash of the whole content. */
export async function draftContentHash(c: DraftContent): Promise<string> {
  return sha256Hex(canonicalJson({
    name: c.name, endpoint: c.endpoint, auth_type: c.auth_type,
    auth_header: c.auth_header, manifest: c.manifest ?? null, guide: c.guide,
  }));
}

/** Pure but for the digest. The draft's shape with permissions stripped:
 *  names, endpoint, auth, guide, and each command's structure. Manifest
 *  v2's verify and reversibility ride here (B2), and its quota rides
 *  here too (B11): they are structure — what the command promises, how
 *  far it reaches, and how fast it may write — not permission, so a
 *  draft cannot gain or lose one without the structure hash moving,
 *  exactly like an http mapping. (The content hash already binds the
 *  raw manifest whole.) The undo declaration rides here as well (B9):
 *  how a write is cleaned up after is part of what the command is,
 *  not of who may run it, so it moves the structure hash and never
 *  the permission hash. A command's transform reference rides here
 *  too (P1T), on the same reasoning: how an answer is shaped is what
 *  the command is. (A draft itself may never carry one —
 *  validateDraftCandidate refuses; the projection still reads it, so
 *  a first-party manifest's structure is hashed the same way.) */
export function draftStructureOf(c: DraftContent): unknown {
  const { manifest } = parseManifest(c.manifest);
  return {
    name: c.name, endpoint: c.endpoint, auth_type: c.auth_type, auth_header: c.auth_header, guide: c.guide,
    commands: manifest.commands
      .map((cmd) => ({
        name: cmd.name, action: cmd.action, effect: cmd.effect,
        http: cmd.http, mcp: cmd.mcp, input: cmd.input, required: cmd.required,
        verify: cmd.verify, reversibility: cmd.reversibility, quota: cmd.quota, undo: cmd.undo,
        transform: cmd.transform,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    aliases: manifest.aliases,
  };
}

export async function draftStructureHash(c: DraftContent): Promise<string> {
  return sha256Hex(canonicalJson(draftStructureOf(c)));
}

/** Pure but for the digest. Only what a permission edit changes: the
 *  defaults and each command's permission and rules. */
export function draftPermissionsOf(c: DraftContent): unknown {
  const { manifest } = parseManifest(c.manifest);
  const raw = obj(c.manifest);
  return {
    defaults: obj(raw?.defaults) ?? { read: "allow", write: "ask" },
    commands: manifest.commands
      .map((cmd) => ({ name: cmd.name, permission: cmd.permission, rules: cmd.rules }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

export async function draftPermissionHash(c: DraftContent): Promise<string> {
  return sha256Hex(canonicalJson(draftPermissionsOf(c)));
}

// ── Test outcomes: the failure vocabulary ────────────────────────────────

export type DraftFailureClass =
  | "manifest_invalid" | "blocked" | "unreachable" | "auth_failed" | "auth_unverified"
  | "endpoint_error" | "schema_mismatch" | "server_error" | "unverifiable";

/** Where a classification sits in "most actionable first" — a round that
 *  failed several ways is summarised by the first of these it hit. */
export const FAILURE_CLASS_ORDER: readonly DraftFailureClass[] = [
  "manifest_invalid", "blocked", "auth_failed", "unreachable",
  "endpoint_error", "schema_mismatch", "server_error", "auth_unverified", "unverifiable",
];

export function primaryFailureClass(classes: readonly (DraftFailureClass | null | undefined)[]): DraftFailureClass | null {
  const present = new Set(classes.filter((c): c is DraftFailureClass => !!c));
  return FAILURE_CLASS_ORDER.find((c) => present.has(c)) ?? null;
}

/**
 * Pure. One executed read's outcome as a failure class, or null when it
 * answered. Guard refusals (the endpoint checks, a path escaping its
 * base) are `blocked`; a call that never got an answer is `unreachable`;
 * statuses divide as the design's table says.
 */
export function classifyCommandOutcome(o: { status?: number | null; error?: string | null }): DraftFailureClass | null {
  const err = o.error ?? "";
  if (/not allowed|non-public|escapes|must be relative/i.test(err)) return "blocked";
  if (/認証に失敗|unauthori[sz]ed/i.test(err)) return "auth_failed";
  const status = o.status ?? null;
  if (status === null) return err ? "unreachable" : null;
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || status === 405) return "endpoint_error";
  if (status === 400 || status === 422) return "schema_mismatch";
  if (status >= 500) return "server_error";
  if (status >= 300) return "endpoint_error";
  return null;
}

/** Input fields that bound how much a call returns: a test run always
 *  sets one of these to its minimum, so a read-all test cannot pull a
 *  whole account through the door (design addendum, §4.4). */
export const LIMIT_FIELDS: readonly string[] = [
  "limit", "count", "per_page", "page_size", "max_results", "maxresults", "pagesize", "take", "first", "top",
];

/** Pure. The limit field a command declares, if any. */
export function limitFieldOf(input: Record<string, unknown>): string | null {
  return LIMIT_FIELDS.find((f) => Object.prototype.hasOwnProperty.call(input, f)) ?? null;
}

/** Pure. A test input with its limit field set to 1 when the command
 *  declares one and the input does not already carry a value. */
export function withLimitFloor(
  commandInput: Record<string, unknown>,
  input: Record<string, unknown>,
): { input: Record<string, unknown>; limitedBy: string | null } {
  const field = limitFieldOf(commandInput);
  if (!field || input[field] !== undefined) return { input, limitedBy: null };
  return { input: { ...input, [field]: 1 }, limitedBy: field };
}

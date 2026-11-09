// Definition tests (back-half B14): a fixture a person cuts from a
// real run's record, replayed at the integration seam so a definition
// can be regression-tested the way a rehearsal classifies — but
// reproducibly, against what the source run actually saw.
//
// The spine of the piece: the fixture is the transcript's integration
// exchanges (tool_use / tool_result pairs), each resolved to a
// canonical action and hashed by its full canonical arguments — the
// plan mode recipe, one canonicalization — and replay answers from
// the record, never from the service. The binding layer refuses
// non-replay outright, so a test run can read no Vault secret, open
// no MCP session and spend no credential, by code shape rather than
// by policy. Matching is CONSUMING, not sequential: the loop
// dispatches a turn's calls in parallel, so the earliest unconsumed
// exchange with the same (action, argHash) answers, whatever order
// the model chose this time. An exchange whose recorded answer was
// an error is STICKY — it keeps answering that error to repeat
// dispatches of the same call — which is what lets a definition's
// failure rows (B13 retry, give-up) be exercised deterministically.
//
// This module holds the pure parts (fixture shape and its
// fail-closed parse, transcript extraction, the scrub application,
// expected derivation, the replay transport, the verdict) and, below
// them, the DB shells (capture / launch / settle) the drivers call.
// The driver glue in run-agent stays thin on purpose (§10): every
// decision here is importable and unit-tested from the web suite.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalCalls, type Msg } from "./agentLoop.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { canonicalJson } from "./integrationPlans.ts";
import { scrubText } from "./memoryScrub.ts";
import { classifyRehearsal, readRehearsalReport, type RehearsalReport } from "./rehearsal.ts";
import { httpPseudoAction, isAuthFailure } from "./integrationClient.ts";
import { canonicalAction, parseManifest, type Manifest } from "./connectorManifest.ts";
import { DRIVE_TOOLS } from "./googleDrive.ts";
import { isGoogleDriveRow } from "./googleOAuth.ts";
import { INTEGRATION_SEPARATOR, integrationPrefix } from "./integrationTools.ts";
import { resolveDefinition, type DefinitionCandidate } from "./definitionResolution.ts";
import { parseFinishDetail } from "./finishClaims.ts";

// ── The fixture ─────────────────────────────────────────────────────

/** One recorded integration exchange: what the model called, the
 *  canonical action it resolved to, the hash of its (scrubbed) full
 *  arguments, and the response the model saw — transport-truncated,
 *  verify-annotated, exactly the string the source run worked from. */
export interface FixtureExchange {
  seq: number;
  kind: "read" | "write";
  action: string;
  integrationName: string;
  argHash: string;
  args: Record<string, unknown>;
  summary: string;
  response: { text: string; isError: boolean };
  /** Top-level argument keys a person marked volatile at capture:
   *  the effective set for this exchange's action (the union over
   *  the action's exchanges), dropped before hashing — identically
   *  at capture-store time and at dispatch. Always visible, never
   *  editable after capture; re-capture is the way to change them. */
  volatile?: string[];
}

export interface DefinitionFixture {
  v: 1;
  exchanges: FixtureExchange[];
}

export interface ExpectedWritePlan {
  action: string;
  argHash: string;
  summary: string;
}

/** What a replay of the fixture must reproduce, derived from the
 *  fixture itself at capture and stored beside it. The settle
 *  compares against THIS, never against a re-derivation: re-capture
 *  is the only way the expectation moves. */
export interface FixtureExpected {
  classification: string;
  writePlans: ExpectedWritePlan[];
}

export const FIXTURE_LIMITS = {
  maxExchanges: 200,
  maxBytes: 1_000_000,
} as const;

const ARG_HASH_RE = /^[0-9a-f]{64}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseExchange(v: unknown, index: number): FixtureExchange | null {
  if (!isPlainObject(v)) return null;
  if (v.seq !== index + 1) return null;
  if (v.kind !== "read" && v.kind !== "write") return null;
  if (typeof v.action !== "string" || !v.action) return null;
  if (typeof v.integrationName !== "string") return null;
  if (typeof v.argHash !== "string" || !ARG_HASH_RE.test(v.argHash)) return null;
  if (!isPlainObject(v.args)) return null;
  if (typeof v.summary !== "string") return null;
  if (!isPlainObject(v.response)) return null;
  if (typeof v.response.text !== "string" || typeof v.response.isError !== "boolean") return null;
  let volatile: string[] | undefined;
  if (v.volatile !== undefined) {
    if (!Array.isArray(v.volatile) || v.volatile.some((k) => typeof k !== "string")) return null;
    volatile = [...new Set(v.volatile as string[])].sort();
  }
  return {
    seq: v.seq, kind: v.kind, action: v.action, integrationName: v.integrationName,
    argHash: v.argHash, args: v.args, summary: v.summary,
    response: { text: v.response.text, isError: v.response.isError },
    ...(volatile && volatile.length ? { volatile } : {}),
  };
}

/** The stored fixture, read back fail-closed: anything the writer
 *  here would not have produced reads as no fixture at all, and a
 *  test run that cannot load its fixture cannot start (the launch
 *  says so) rather than improvising live calls. */
export function parseFixture(value: unknown): DefinitionFixture | null {
  if (!isPlainObject(value) || value.v !== 1) return null;
  if (!Array.isArray(value.exchanges)) return null;
  if (value.exchanges.length > FIXTURE_LIMITS.maxExchanges) return null;
  const exchanges: FixtureExchange[] = [];
  for (let i = 0; i < value.exchanges.length; i++) {
    const ex = parseExchange(value.exchanges[i], i);
    if (!ex) return null;
    exchanges.push(ex);
  }
  return { v: 1, exchanges };
}

/** The stored expectation, read back with the same discipline. */
export function parseFixtureExpected(value: unknown): FixtureExpected | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.classification !== "string" || !value.classification) return null;
  if (!Array.isArray(value.writePlans)) return null;
  const writePlans: ExpectedWritePlan[] = [];
  for (const p of value.writePlans) {
    if (!isPlainObject(p)) return null;
    if (typeof p.action !== "string" || !p.action) return null;
    if (typeof p.argHash !== "string" || !ARG_HASH_RE.test(p.argHash)) return null;
    if (typeof p.summary !== "string") return null;
    writePlans.push({ action: p.action, argHash: p.argHash, summary: p.summary });
  }
  return { classification: value.classification, writePlans };
}

// ── Argument hashing (the plan-mode recipe, one canonicalization) ──

/** The volatile keys in force for one action: the union of the marks
 *  on that action's exchanges. One rule at capture and at dispatch,
 *  so a mark means the same thing at both ends. */
export function volatileKeysOf(fixture: DefinitionFixture): Map<string, string[]> {
  const byAction = new Map<string, Set<string>>();
  for (const ex of fixture.exchanges) {
    if (!ex.volatile?.length) continue;
    const set = byAction.get(ex.action) ?? new Set<string>();
    for (const k of ex.volatile) set.add(k);
    byAction.set(ex.action, set);
  }
  return new Map([...byAction].map(([a, s]) => [a, [...s].sort()]));
}

/** sha256 of the canonical call with the volatile keys dropped from
 *  the input's top level. D4: the FULL argument set is hashed — a
 *  procedure that starts sending different arguments is a different
 *  procedure, and the test exists to say so. */
export async function actionArgHash(
  action: string,
  input: Record<string, unknown>,
  volatileKeys: readonly string[] = [],
): Promise<string> {
  let cleaned = input;
  if (volatileKeys.length) {
    cleaned = { ...input };
    for (const k of volatileKeys) delete cleaned[k];
  }
  return await sha256Hex(canonicalCalls([{ id: "", name: action, input: cleaned }]));
}

/** The definition body hash a test result binds to — the B6 recipe,
 *  shared verbatim so a result's "which body was this" and a
 *  constraint's "which version was that" are the same question. */
export async function definitionBodyHash(body: string): Promise<string> {
  return await sha256Hex(canonicalJson({ kind: "definition", body }));
}

// ── Extraction: transcript → exchanges ──────────────────────────────

/** One tool_use / tool_result pair from a run's transcript, before
 *  resolution: the raw material capture works from. */
export interface ExtractedCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  response: { text: string; isError: boolean };
}

/** Pairs the transcript's tool_use blocks with their results, in
 *  order. Only tool_use blocks enter; server-side blocks
 *  (server_tool_use) are web reads the run made outside any
 *  connection — not integration exchanges, and not replayable
 *  material. A tool_use whose result is missing keeps an empty
 *  error result: the loop guarantees a result for every call, and
 *  dropping the call silently would falsify the fixture. */
export function extractCalls(transcript: { messages?: Msg[] } | null | undefined): ExtractedCall[] {
  const messages = transcript?.messages ?? [];
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        results.set(b.tool_use_id, {
          text: typeof b.content === "string" ? b.content : "",
          isError: b.is_error === true,
        });
      }
    }
  }
  const calls: ExtractedCall[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_use" || typeof b.id !== "string" || typeof b.name !== "string") continue;
      calls.push({
        toolUseId: b.id,
        toolName: b.name,
        input: isPlainObject(b.input) ? b.input : {},
        response: results.get(b.id) ?? { text: "", isError: true },
      });
    }
  }
  return calls;
}

/** What the resolver knows about one call: the canonical action it
 *  dispatches as today, its kind, the connection's display name and
 *  the one-line summary the fixture keeps. Null means the call was
 *  MEANT to be an integration call but cannot be resolved — the
 *  manifest moved, the connection is gone — and capture fails,
 *  naming it. Calls that are not integration calls at all never
 *  reach the resolver (the shell filters by the tool-name shape). */
export interface ResolvedExchange {
  action: string;
  kind: "read" | "write";
  integrationName: string;
  summary: string;
}
export type FixtureResolve = (call: ExtractedCall) => Promise<ResolvedExchange | null> | ResolvedExchange | null;

export type FixtureBuild =
  | { ok: true; fixture: DefinitionFixture }
  | { ok: false; reason: "unresolvable"; toolName: string }
  | { ok: false; reason: "limit"; detail: "count" | "size" };

/** Resolves the extracted integration calls into a fixture with
 *  provisional hashes (no volatile marks yet — marks land through
 *  applyVolatileMarks at the person's confirmation). One
 *  unresolvable call fails the whole capture: a fixture with a hole
 *  where a call was would replay a procedure that never happened. */
export async function buildFixture(
  calls: ExtractedCall[],
  resolve: FixtureResolve,
): Promise<FixtureBuild> {
  if (calls.length > FIXTURE_LIMITS.maxExchanges) {
    return { ok: false, reason: "limit", detail: "count" };
  }
  const exchanges: FixtureExchange[] = [];
  for (const call of calls) {
    const r = await resolve(call);
    if (!r) return { ok: false, reason: "unresolvable", toolName: call.toolName };
    exchanges.push({
      seq: exchanges.length + 1,
      kind: r.kind,
      action: r.action,
      integrationName: r.integrationName,
      argHash: await actionArgHash(r.action, call.input),
      args: call.input,
      summary: r.summary,
      response: call.response,
    });
  }
  return { ok: true, fixture: { v: 1, exchanges } };
}

/** Applies the person's volatile marks (keyed by exchange seq) and
 *  finalizes the hashes: each exchange carries its action's union of
 *  marks, and every argHash is recomputed under that union — the
 *  stored form the transport will hash dispatches against. */
export async function applyVolatileMarks(
  fixture: DefinitionFixture,
  marks: ReadonlyMap<number, readonly string[]>,
): Promise<DefinitionFixture> {
  const marked: DefinitionFixture = {
    v: 1,
    exchanges: fixture.exchanges.map((ex) => {
      const m = marks.get(ex.seq);
      return m?.length ? { ...ex, volatile: [...new Set(m)].sort() } : ex;
    }),
  };
  const unions = volatileKeysOf(marked);
  const exchanges: FixtureExchange[] = [];
  for (const ex of marked.exchanges) {
    const union = unions.get(ex.action) ?? [];
    exchanges.push({
      ...ex,
      ...(union.length ? { volatile: union } : { volatile: undefined }),
      argHash: await actionArgHash(ex.action, ex.args, union),
    });
  }
  return { v: 1, exchanges };
}

// ── The scrub (capture's layer 2) ───────────────────────────────────

export type FixtureScrub =
  | { ok: true; fixture: DefinitionFixture }
  | { ok: false; pattern: string; seq: number };

function scrubWalk(value: unknown): string | null {
  if (typeof value === "string") {
    const { hits } = scrubText(value);
    return hits.length ? hits[0].pattern : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const p = scrubWalk(v);
      if (p) return p;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) {
      const p = scrubWalk(v);
      if (p) return p;
    }
  }
  return null;
}

/** Every string in the fixture — argument keys and values, the
 *  summary, the recorded response — walks through the Memory
 *  scrubber's rules, unmodified and unextended (C2: the scrubber is
 *  credential-shaped patterns only; it makes no PII claim, and
 *  neither does this layer). ONE hit fails the ENTIRE capture:
 *  dropping just the hit exchange would silently rewrite the record
 *  the fixture claims to reproduce. The failure names the pattern
 *  and the exchange's seq — never the excerpt: ScrubHit.excerpt is
 *  part of the secret and must reach no screen and no log. */
export function scrubFixture(fixture: DefinitionFixture): FixtureScrub {
  for (const ex of fixture.exchanges) {
    const pattern = scrubWalk(ex);
    if (pattern) return { ok: false, pattern, seq: ex.seq };
  }
  return { ok: true, fixture };
}

/** The fixture's stored size, against the 1MB ceiling. Checked on
 *  the final (marked, scrubbed) form: what is stored is what is
 *  measured. */
export function fixtureWithinSizeLimit(fixture: DefinitionFixture): boolean {
  return new TextEncoder().encode(JSON.stringify(fixture)).length <= FIXTURE_LIMITS.maxBytes;
}

// ── Expected derivation ─────────────────────────────────────────────

/** Derives what a replay must reproduce, from the fixture itself:
 *  the classification the source run's exchanges imply under the
 *  rehearsal classifier (its recorded reads and planned writes,
 *  folded with whether the source run itself failed), and the
 *  ordered write plans the replay's gate must match. The settle
 *  compares against the STORED expectation (§2.4) — derivation
 *  happens exactly once, here at capture. */
export function expectedFromExchanges(
  fixture: DefinitionFixture,
  sourceRunStatus: string,
): FixtureExpected {
  const report: RehearsalReport = {
    reads: fixture.exchanges.filter((e) => e.kind === "read").map((e) => ({
      tool: e.action,
      ok: !e.response.isError,
      authFailure: isAuthFailure(e.response.text),
    })),
    writes: fixture.exchanges.filter((e) => e.kind === "write").map((e) => ({
      tool: e.action, valid: true, problem: null,
    })),
  };
  return {
    classification: classifyRehearsal(report, sourceRunStatus === "failed"),
    writePlans: fixture.exchanges.filter((e) => e.kind === "write").map((e) => ({
      action: e.action, argHash: e.argHash, summary: e.summary,
    })),
  };
}

// ── Divergences and the verdict ─────────────────────────────────────

export type TestDivergenceKind =
  | "unexpected-call"
  | "argument-divergence"
  | "repeat-of-success"
  | "write-divergence"
  | "incomplete";

export interface TestDivergence {
  kind: TestDivergenceKind;
  action: string;
  /** Top-level key NAMES only (argument-divergence): which fields
   *  the procedure changed, never their values. */
  differingKeys?: string[];
  /** The recorded exchange compared against, when there is one. */
  expectedSeq?: number;
  /** For `incomplete`: every action still unconsumed at the settle,
   *  in recorded order. */
  remainingActions?: string[];
}

export interface TestVerdict {
  outcome: "pass" | "fail";
  classification: string;
  expectedClassification: string;
  divergences: TestDivergence[];
  divergenceOverflow: number;
  consumed: number;
  total: number;
  writePlans: { matched: number; total: number };
  bodyHash: string;
  model: string;
  at: string;
  /** Where the test run's failure WOULD have escalated, resolved
   *  but never delivered (§6.2): a test's escalation reaching the
   *  real owner would be noise, so the resolution lands here as
   *  data and the fact of the test carries it. Null when the run
   *  raised nothing to escalate. */
  escalationTarget?: string | null;
}

const MAX_VERDICT_DIVERGENCES = 20;

function readDivergence(v: unknown): TestDivergence | null {
  if (!isPlainObject(v)) return null;
  const kinds: TestDivergenceKind[] = [
    "unexpected-call", "argument-divergence", "repeat-of-success", "write-divergence", "incomplete",
  ];
  if (!kinds.includes(v.kind as TestDivergenceKind)) return null;
  if (typeof v.action !== "string") return null;
  const d: TestDivergence = { kind: v.kind as TestDivergenceKind, action: v.action };
  if (Array.isArray(v.differingKeys)) {
    d.differingKeys = v.differingKeys.filter((k): k is string => typeof k === "string");
  }
  if (typeof v.expectedSeq === "number") d.expectedSeq = v.expectedSeq;
  if (Array.isArray(v.remainingActions)) {
    d.remainingActions = v.remainingActions.filter((k): k is string => typeof k === "string");
  }
  return d;
}

/** The stored verdict on a definition_tests row, read back
 *  tolerantly for display: a malformed record shows as no result,
 *  never as a pass. */
export function parseTestVerdict(value: unknown): TestVerdict | null {
  if (!isPlainObject(value)) return null;
  if (value.outcome !== "pass" && value.outcome !== "fail") return null;
  if (typeof value.classification !== "string" || typeof value.expectedClassification !== "string") return null;
  if (typeof value.consumed !== "number" || typeof value.total !== "number") return null;
  if (!isPlainObject(value.writePlans)) return null;
  if (typeof value.writePlans.matched !== "number" || typeof value.writePlans.total !== "number") return null;
  if (typeof value.bodyHash !== "string" || typeof value.model !== "string" || typeof value.at !== "string") return null;
  const divergences = Array.isArray(value.divergences)
    ? value.divergences.map(readDivergence).filter((d): d is TestDivergence => d !== null)
    : [];
  return {
    outcome: value.outcome,
    classification: value.classification,
    expectedClassification: value.expectedClassification,
    divergences,
    divergenceOverflow: typeof value.divergenceOverflow === "number" ? value.divergenceOverflow : 0,
    consumed: value.consumed,
    total: value.total,
    writePlans: { matched: value.writePlans.matched, total: value.writePlans.total },
    bodyHash: value.bodyHash,
    model: value.model,
    at: value.at,
    escalationTarget: typeof value.escalationTarget === "string" ? value.escalationTarget : null,
  };
}

// ── The transcript's test block ─────────────────────────────────────

/** What the transcript carries about a test run (transcript.test):
 *  enough to rebuild the transport after an interruption — the
 *  fixture itself is reloaded from its row, consumption restores
 *  from the consumed seqs. The fixture reference rides the
 *  transcript separately (transcript.testFixture). */
export interface TranscriptTestState {
  divergences: TestDivergence[];
  divergenceOverflow: number;
  consumed: number;
  total: number;
  repeats: number;
  consumedSeqs: number[];
}

export function parseTranscriptTest(value: unknown): TranscriptTestState | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.consumedSeqs)) return null;
  const consumedSeqs = value.consumedSeqs.filter((n): n is number => typeof n === "number");
  const divergences = Array.isArray(value.divergences)
    ? value.divergences.map(readDivergence).filter((d): d is TestDivergence => d !== null)
    : [];
  return {
    divergences,
    divergenceOverflow: typeof value.divergenceOverflow === "number" ? value.divergenceOverflow : 0,
    consumed: typeof value.consumed === "number" ? value.consumed : consumedSeqs.length,
    total: typeof value.total === "number" ? value.total : 0,
    repeats: typeof value.repeats === "number" ? value.repeats : 0,
    consumedSeqs,
  };
}

// ── The replay transport ────────────────────────────────────────────

export interface ReplayDispatchResult {
  text: string;
  isError: boolean;
  /** Rides the execute result the way B2's verify record does: the
   *  seam the call-log writer and the auth-failure branch read to
   *  know this answer came from the record, not the service. */
  replayed: true;
}

const divergenceText = (d: TestDivergence): string => {
  switch (d.kind) {
    case "unexpected-call":
      return `定義テスト: 記録にない呼び出しです（${d.action}）。実サービスへは接続していません。`;
    case "argument-divergence":
      return `定義テスト: ${d.action} の引数が記録と異なります（異なるキー: ${(d.differingKeys ?? []).join(", ")}）。実サービスへは接続していません。`;
    case "repeat-of-success":
      return `定義テスト: ${d.action} は記録上すでに成功しており、繰り返しの記録がありません。実サービスへは接続していません。`;
    case "write-divergence":
      return `定義テスト: 計画された書き込みが記録と一致しません（${d.action}）。`;
    case "incomplete":
      return `定義テスト: 記録の交換が残っています。`;
  }
};

/** One run's replay state machine: eats (action, input) dispatches
 *  and answers from the fixture. Pure and importable by design
 *  (§10) — a future driver harness drives execute() against this
 *  same machine; nothing here knows about fixtures as a storage
 *  concept beyond the exchange list it was handed.
 *
 *  Matching is consuming: the earliest unconsumed exchange with the
 *  same (action, argHash) answers and is spent. Error exchanges are
 *  sticky (D5): once spent, the same (action, argHash) keeps
 *  receiving the recorded error — the retry loop above re-dispatches
 *  and counts, deterministically, instead of the fixture running
 *  dry. Successful exchanges are not sticky: a repeat dispatch of a
 *  spent success is a divergence (the procedure changed), not a
 *  free replay. */
export class ReplayTransport {
  private readonly fixture: DefinitionFixture;
  private readonly volatile: Map<string, string[]>;
  private readonly consumedSeqs = new Set<number>();
  private readonly sticky = new Map<string, FixtureExchange>();
  private divergences: TestDivergence[] = [];
  private divergenceOverflow = 0;
  private repeats = 0;

  constructor(fixture: DefinitionFixture, restored?: TranscriptTestState | null) {
    this.fixture = fixture;
    this.volatile = volatileKeysOf(fixture);
    if (restored) {
      for (const seq of restored.consumedSeqs) {
        const ex = fixture.exchanges.find((e) => e.seq === seq);
        if (!ex) continue;
        this.consumedSeqs.add(seq);
        if (ex.response.isError) this.sticky.set(stickyKey(ex.action, ex.argHash), ex);
      }
      this.divergences = restored.divergences.slice(0, MAX_VERDICT_DIVERGENCES);
      this.divergenceOverflow = restored.divergenceOverflow;
      this.repeats = restored.repeats;
    }
  }

  private record(d: TestDivergence): void {
    if (this.divergences.length < MAX_VERDICT_DIVERGENCES) this.divergences.push(d);
    else this.divergenceOverflow++;
  }

  private consume(ex: FixtureExchange): void {
    this.consumedSeqs.add(ex.seq);
    if (ex.response.isError) this.sticky.set(stickyKey(ex.action, ex.argHash), ex);
  }

  /** Answers one read dispatch from the record. A divergence never
   *  throws and never reaches for the service: the call receives an
   *  error result naming what diverged, the divergence is data, and
   *  the run continues — whether the definition recovers is part of
   *  what the test measures. */
  async dispatch(action: string, input: Record<string, unknown>): Promise<ReplayDispatchResult> {
    const argHash = await actionArgHash(action, input, this.volatile.get(action) ?? []);
    const exact = this.fixture.exchanges.find(
      (e) => !this.consumedSeqs.has(e.seq) && e.action === action && e.argHash === argHash,
    );
    if (exact) {
      this.consume(exact);
      return { text: exact.response.text, isError: exact.response.isError, replayed: true };
    }
    const stuck = this.sticky.get(stickyKey(action, argHash));
    if (stuck) {
      this.repeats++;
      return { text: stuck.response.text, isError: true, replayed: true };
    }
    const spent = this.fixture.exchanges.find(
      (e) => this.consumedSeqs.has(e.seq) && e.action === action && e.argHash === argHash && !e.response.isError,
    );
    if (spent) {
      const d: TestDivergence = { kind: "repeat-of-success", action, expectedSeq: spent.seq };
      this.record(d);
      return { text: divergenceText(d), isError: true, replayed: true };
    }
    const sameAction = this.fixture.exchanges.find(
      (e) => !this.consumedSeqs.has(e.seq) && e.action === action,
    );
    if (sameAction) {
      const volatile = new Set(this.volatile.get(action) ?? []);
      const keys = new Set([...Object.keys(input), ...Object.keys(sameAction.args)]);
      const differingKeys = [...keys].filter((k) => {
        if (volatile.has(k)) return false;
        const inLive = Object.prototype.hasOwnProperty.call(input, k);
        const inRecorded = Object.prototype.hasOwnProperty.call(sameAction.args, k);
        if (inLive !== inRecorded) return true;
        return canonicalJson(input[k]) !== canonicalJson(sameAction.args[k]);
      }).sort();
      const d: TestDivergence = {
        kind: "argument-divergence", action, differingKeys, expectedSeq: sameAction.seq,
      };
      this.record(d);
      return { text: divergenceText(d), isError: true, replayed: true };
    }
    const d: TestDivergence = { kind: "unexpected-call", action };
    this.record(d);
    return { text: divergenceText(d), isError: true, replayed: true };
  }

  /** The gate's write matching (§4.6): a planned write that matches
   *  a recorded write exchange consumes it and is valid; anything
   *  else records a write-divergence and is invalid — the same
   *  problem the rehearsal classification already knows how to
   *  carry (write_plan_invalid), now with the divergence as data. */
  async matchWrite(
    action: string,
    input: Record<string, unknown>,
  ): Promise<{ valid: boolean }> {
    const argHash = await actionArgHash(action, input, this.volatile.get(action) ?? []);
    const exact = this.fixture.exchanges.find(
      (e) => !this.consumedSeqs.has(e.seq) && e.kind === "write" && e.action === action && e.argHash === argHash,
    );
    if (exact) {
      this.consume(exact);
      return { valid: true };
    }
    this.record({ kind: "write-divergence", action });
    return { valid: false };
  }

  /** The exchanges no dispatch consumed, in recorded order — the
   *  settle's `incomplete` evidence. */
  remaining(): FixtureExchange[] {
    return this.fixture.exchanges.filter((e) => !this.consumedSeqs.has(e.seq));
  }

  /** The transcript.test block: what a continuation restores from. */
  state(): TranscriptTestState {
    return {
      divergences: [...this.divergences],
      divergenceOverflow: this.divergenceOverflow,
      consumed: this.consumedSeqs.size,
      total: this.fixture.exchanges.length,
      repeats: this.repeats,
      consumedSeqs: [...this.consumedSeqs].sort((a, b) => a - b),
    };
  }
}

function stickyKey(action: string, argHash: string): string {
  return `${action} ${argHash}`;
}

// ── The verdict ─────────────────────────────────────────────────────

/** Judges a finished test run against the stored expectation. Pass
 *  is a conjunction, and every conjunct is a fact the record holds:
 *  no divergences (incompleteness included), every exchange
 *  consumed, the measured classification equal to the captured one,
 *  and every expected write plan matched. Nothing here re-derives
 *  the expectation — the verdict compares the run against what
 *  capture stored, so a definition edited since fails against the
 *  old record honestly instead of against a moved target. */
export function judgeTestRun(args: {
  fixture: DefinitionFixture;
  expected: FixtureExpected;
  report: RehearsalReport;
  runFailed: boolean;
  state: TranscriptTestState;
  bodyHash: string;
  model: string;
  at: Date;
  escalationTarget?: string | null;
}): TestVerdict {
  const { fixture, expected, state } = args;
  const divergences = [...state.divergences];
  let divergenceOverflow = state.divergenceOverflow;
  const consumedSeqs = new Set(state.consumedSeqs);
  const remaining = fixture.exchanges.filter((e) => !consumedSeqs.has(e.seq));
  if (remaining.length) {
    const incomplete: TestDivergence = {
      kind: "incomplete",
      action: remaining[0].action,
      remainingActions: [...new Set(remaining.map((e) => e.action))],
    };
    if (divergences.length < MAX_VERDICT_DIVERGENCES) divergences.push(incomplete);
    else divergenceOverflow++;
  }
  // Write plans matched: the expected plans covered, one for one,
  // by the write exchanges the run consumed.
  const consumedWrites = fixture.exchanges.filter(
    (e) => e.kind === "write" && consumedSeqs.has(e.seq),
  ).map((e) => `${e.action} ${e.argHash}`);
  let matched = 0;
  for (const plan of expected.writePlans) {
    const key = `${plan.action} ${plan.argHash}`;
    const idx = consumedWrites.indexOf(key);
    if (idx >= 0) {
      consumedWrites.splice(idx, 1);
      matched++;
    }
  }
  const classification = classifyRehearsal(args.report, args.runFailed);
  const consumed = consumedSeqs.size;
  const pass = divergences.length === 0 && divergenceOverflow === 0
    && consumed === fixture.exchanges.length
    && classification === expected.classification
    && matched === expected.writePlans.length;
  return {
    outcome: pass ? "pass" : "fail",
    classification,
    expectedClassification: expected.classification,
    divergences,
    divergenceOverflow,
    consumed,
    total: fixture.exchanges.length,
    writePlans: { matched, total: expected.writePlans.length },
    bodyHash: args.bodyHash,
    model: args.model,
    at: args.at.toISOString(),
    escalationTarget: args.escalationTarget ?? null,
  };
}

// ── DB shells: capture, launch, settle ──────────────────────────────
//
// Everything below touches the database; everything above does not.
// The shells take the caller's userDb (their own session, RLS) for
// anything a member may do — read the source run, resolve its
// definition, insert the captured row, place the test's Element and
// run — and the service-role admin for the records only the engine
// keeps: the resolver's cross-check against the call log, the
// result columns (last_*) no member session may write, the settle's
// step and its one notification.

export interface DefinitionTestRow {
  id: string;
  definition_id: string;
  activity_space_id: string;
  name: string;
  fixture: unknown;
  expected: unknown;
  source_run_id: string | null;
  source_run_label: string | null;
  source_run_status: string | null;
  tainted: boolean;
  captured_by: string | null;
  captured_at: string;
  last_result: unknown;
  last_run_id: string | null;
  last_run_at: string | null;
  last_body_hash: string | null;
}

export const DEFINITION_TEST_COLUMNS =
  "id, definition_id, activity_space_id, name, fixture, expected, source_run_id, source_run_label, source_run_status, tainted, captured_by, captured_at, last_result, last_run_id, last_run_at, last_body_hash";

/** The pseudo-action a raw http_request call matches under (§4.2):
 *  method + path, computed from the call's own input — one
 *  implementation in integrationClient.ts, shared with the replay
 *  dispatch, so the two ends can never spell it differently. */
export { httpPseudoAction } from "./integrationClient.ts";

interface SourceRunRow {
  id: string;
  status: string;
  element_id: string | null;
  activity_space_id: string | null;
  transcript: {
    messages?: Msg[];
    rehearsalDefinition?: { name: string; body: string };
  } | null;
  finish_detail: unknown;
  finished_at: string | null;
}

/** The definition a run ran under, resolved the driver's own way
 *  (loadDefinition's path, shared rule): the Element's own
 *  definition first, then the definitions of the Strategies serving
 *  its Object. A run that ran under the Space default — or under a
 *  transcript-carried draft — has no row to attach a test to. */
async function resolveRunDefinition(
  userDb: SupabaseClient,
  elementId: string,
): Promise<{ id: string; name: string } | null> {
  const { data: el } = await userDb.from("elements").select("definition_id, object_id").eq("id", elementId).maybeSingle();
  const ownId = (el as { definition_id?: string | null } | null)?.definition_id ?? null;
  const candidates: (DefinitionCandidate | null)[] = [];
  if (ownId) {
    const { data: own } = await userDb.from("definitions").select("id, name, enabled").eq("id", ownId).maybeSingle();
    candidates.push((own as DefinitionCandidate | null) ?? null);
  }
  const own = candidates[0] ?? null;
  if ((!own || !own.enabled) && (el as { object_id?: string | null } | null)?.object_id) {
    const objectId = (el as { object_id: string }).object_id;
    const { data: links } = await userDb.from("strategy_objects").select("strategy_id").eq("object_id", objectId);
    const ids = ((links ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id);
    if (ids.length) {
      const { data: s } = await userDb.from("strategies").select("definition_id").in("id", ids).not("definition_id", "is", null);
      const defIds = [...new Set(((s ?? []) as { definition_id: string }[]).map((r) => r.definition_id).filter((d) => d !== ownId))];
      if (defIds.length) {
        const { data: rows } = await userDb.from("definitions").select("id, name, enabled").in("id", defIds);
        const byId = new Map(((rows ?? []) as DefinitionCandidate[]).map((r) => [r.id, r]));
        for (const defId of defIds) candidates.push(byId.get(defId) ?? null);
      }
    }
  }
  const { id } = resolveDefinition(candidates);
  if (!id) return null;
  const found = candidates.find((c) => c?.id === id);
  return { id, name: found?.name ?? "" };
}

/** Builds the capture resolver from the Space's connection rows as
 *  they stand today (§1.3's rule): a tool name's prefix finds its
 *  row; a manifest command resolves to its canonical action and its
 *  declared effect, cross-checked against the run's own call log —
 *  a disagreement means the record contradicts itself, and the
 *  capture fails rather than guess. Drive's typed tools resolve by
 *  their own table; a raw http_request resolves to its
 *  pseudo-action. The summary is the command's description where
 *  one exists (the design's summaryOfCall does not exist in code;
 *  this fallback chain is what ships). */
async function buildCaptureResolver(
  admin: SupabaseClient,
  spaceId: string,
  runId: string,
): Promise<FixtureResolve> {
  const { data: rows } = await admin.from("integrations")
    .select("id, name, preset, kind, auth_type, endpoint, manifest")
    .eq("activity_space_id", spaceId);
  interface RowShape {
    id: string; name: string; preset?: string | null; kind?: string;
    auth_type?: string; endpoint?: string; manifest: unknown;
  }
  const byPrefix = new Map<string, { row: RowShape; drive: boolean; manifest: Manifest | null }>();
  for (const raw of (rows ?? []) as RowShape[]) {
    const drive = isGoogleDriveRow(raw);
    const manifest = !drive && raw.manifest != null ? parseManifest(raw.manifest).manifest : null;
    byPrefix.set(integrationPrefix(raw.name, raw.id), { row: raw, drive, manifest });
  }
  const { data: logRows } = await admin.from("integration_call_log")
    .select("command_name, is_write").eq("run_id", runId);
  const loggedKind = new Map<string, boolean>();
  for (const r of (logRows ?? []) as { command_name: string; is_write: boolean }[]) {
    if (!loggedKind.has(r.command_name)) loggedKind.set(r.command_name, r.is_write);
  }
  return (call) => {
    const idx = call.toolName.indexOf(INTEGRATION_SEPARATOR);
    if (idx < 0) return null;
    const entry = byPrefix.get(call.toolName.slice(0, idx));
    if (!entry) return null;
    const rest = call.toolName.slice(idx + INTEGRATION_SEPARATOR.length);
    const { row } = entry;
    if (entry.drive) {
      const tool = DRIVE_TOOLS.find((t) => t.name === rest);
      if (!tool) return null;
      return {
        action: rest, kind: tool.readOnly ? "read" : "write",
        integrationName: row.name, summary: `${row.name}: ${rest}`,
      };
    }
    if (entry.manifest) {
      const command = entry.manifest.commands.find((c) => c.name === rest);
      if (!command) return null;
      const logged = loggedKind.get(rest);
      if (logged !== undefined && logged !== (command.effect === "write")) return null;
      return {
        action: command.action, kind: command.effect,
        integrationName: row.name, summary: `${row.name}: ${command.description || command.name}`,
      };
    }
    if (rest === "http_request") {
      const method = (typeof call.input.method === "string" ? call.input.method : "GET").toUpperCase();
      return {
        action: httpPseudoAction(call.input),
        kind: method === "GET" || method === "HEAD" ? "read" : "write",
        integrationName: row.name, summary: `${row.name}: HTTP ${method}`,
      };
    }
    return null;
  };
}

/** B6's taint rule, the same evidence (constraintDrafts.ts): the
 *  run's finish claims sourced from an external URL, or a Web step
 *  in its trace. A tainted fixture is marked, never refused (§3.4):
 *  replay is zero-live and its verdict is code, so the taint is
 *  information for the person, not a gate. */
async function runTainted(admin: SupabaseClient, run: SourceRunRow): Promise<boolean> {
  const detail = parseFinishDetail(run.finish_detail);
  if ((detail?.claims ?? []).some((c) => c.source != null && /^https?:\/\//i.test(c.source))) return true;
  const { data } = await admin.from("agent_run_steps")
    .select("id").eq("run_id", run.id).like("title", "Web %").limit(1);
  return (data ?? []).length > 0;
}

export type CaptureFailure = {
  ok: false;
  reason: "run_not_found" | "run_not_finished" | "transcript_definition" | "no_definition"
    | "unresolvable" | "scrub" | "limit" | "save_failed";
  detail?: string;
  seq?: number;
};

export interface CaptureDerived {
  ok: true;
  definitionId: string;
  definitionName: string;
  spaceId: string;
  fixture: DefinitionFixture;
  expected: FixtureExpected;
  tainted: boolean;
  sourceRunLabel: string;
  sourceRunStatus: string;
}

/** The one derivation both capture paths run: preview derives it
 *  with no marks, save re-derives it with the person's — the server
 *  never trusts a fixture the client carried (§2.5). */
async function deriveCapture(
  admin: SupabaseClient,
  userDb: SupabaseClient,
  runId: string,
  marks: ReadonlyMap<number, readonly string[]>,
): Promise<CaptureDerived | CaptureFailure> {
  const { data: runRow } = await userDb.from("agent_runs")
    .select("id, status, element_id, activity_space_id, transcript, finish_detail, finished_at")
    .eq("id", runId).maybeSingle();
  if (!runRow) return { ok: false, reason: "run_not_found" };
  const run = runRow as SourceRunRow;
  if (run.status !== "completed" && run.status !== "failed") {
    return { ok: false, reason: "run_not_finished" };
  }
  if (run.transcript?.rehearsalDefinition) return { ok: false, reason: "transcript_definition" };
  if (!run.element_id || !run.activity_space_id) return { ok: false, reason: "no_definition" };
  const definition = await resolveRunDefinition(userDb, run.element_id);
  if (!definition) return { ok: false, reason: "no_definition" };
  const calls = extractCalls(run.transcript)
    .filter((c) => c.toolName.includes(INTEGRATION_SEPARATOR));
  const resolver = await buildCaptureResolver(admin, run.activity_space_id, run.id);
  const built = await buildFixture(calls, resolver);
  if (!built.ok) {
    return built.reason === "unresolvable"
      ? { ok: false, reason: "unresolvable", detail: built.toolName }
      : { ok: false, reason: "limit", detail: built.detail };
  }
  const marked = await applyVolatileMarks(built.fixture, marks);
  const scrubbed = scrubFixture(marked);
  if (!scrubbed.ok) return { ok: false, reason: "scrub", detail: scrubbed.pattern, seq: scrubbed.seq };
  if (!fixtureWithinSizeLimit(marked)) return { ok: false, reason: "limit", detail: "size" };
  const expected = expectedFromExchanges(marked, run.status);
  const tainted = await runTainted(admin, run);
  const { data: el } = await userDb.from("elements").select("title").eq("id", run.element_id).maybeSingle();
  const title = (el as { title?: string } | null)?.title ?? "";
  const sourceRunLabel = title
    ? `${title} · ${(run.finished_at ?? "").slice(0, 10)}`
    : run.id;
  return {
    ok: true,
    definitionId: definition.id,
    definitionName: definition.name,
    spaceId: run.activity_space_id,
    fixture: marked,
    expected,
    tainted,
    sourceRunLabel,
    sourceRunStatus: run.status,
  };
}

/** What the confirmation screen shows (§2.5): every exchange, its
 *  argument key names (the volatile-marking surface), whether its
 *  recorded answer was an error, and the taint — the full list, so
 *  what the person confirms is the fixture that will be stored. */
export async function previewDefinitionTestCapture(
  admin: SupabaseClient,
  userDb: SupabaseClient,
  runId: string,
): Promise<CaptureFailure | {
  ok: true;
  definitionId: string;
  definitionName: string;
  tainted: boolean;
  sourceRunLabel: string;
  exchanges: {
    seq: number; kind: string; action: string; integrationName: string;
    summary: string; argKeys: string[]; isError: boolean; responsePreview: string;
  }[];
}> {
  const derived = await deriveCapture(admin, userDb, runId, new Map());
  if (!derived.ok) return derived;
  return {
    ok: true,
    definitionId: derived.definitionId,
    definitionName: derived.definitionName,
    tainted: derived.tainted,
    sourceRunLabel: derived.sourceRunLabel,
    exchanges: derived.fixture.exchanges.map((ex) => ({
      seq: ex.seq, kind: ex.kind, action: ex.action, integrationName: ex.integrationName,
      summary: ex.summary, argKeys: Object.keys(ex.args), isError: ex.response.isError,
      responsePreview: ex.response.text.slice(0, 200),
    })),
  };
}

/** Saves a confirmed capture. Re-derives everything server-side
 *  with the person's name and volatile marks, then inserts through
 *  the person's own session — the row's insert policy pins
 *  captured_by to the caller, so the insert carries their id. */
export async function saveDefinitionTestCapture(
  admin: SupabaseClient,
  userDb: SupabaseClient,
  args: { runId: string; name: string; marks: ReadonlyMap<number, readonly string[]>; userId: string },
): Promise<CaptureFailure | { ok: true; testId: string }> {
  const derived = await deriveCapture(admin, userDb, args.runId, args.marks);
  if (!derived.ok) return derived;
  const name = args.name.trim() || derived.definitionName;
  const { data, error } = await userDb.from("definition_tests").insert({
    definition_id: derived.definitionId,
    activity_space_id: derived.spaceId,
    name,
    fixture: derived.fixture,
    expected: derived.expected,
    source_run_id: args.runId,
    source_run_label: derived.sourceRunLabel,
    source_run_status: derived.sourceRunStatus,
    tainted: derived.tainted,
    captured_by: args.userId,
  }).select("id").single();
  if (error || !data) return { ok: false, reason: "save_failed", detail: error?.message };
  return { ok: true, testId: (data as { id: string }).id };
}

/** The Space's in-Alcon AI worker — promotionTest's rule, kept
* identical (#7): the worker the rehearsals run under, Claude
* preferred, claude-code runners excluded. */
async function aiWorkerOf(admin: SupabaseClient, spaceId: string): Promise<string | null> {
const { data} = await admin.from("workers").select("id, name, ai_config")
.eq("activity_space_id", spaceId).eq("type", "ai_agent").eq("status", "active");
const inAlcon = ((data?? []) as { id: string; name: string; ai_config: unknown}[])
.filter((w) => (w.ai_config as Record<string, unknown> | null)?.runner!== "claude-code");
return (inAlcon.find((w) => w.name === "Claude")?? inAlcon[0])?.id?? null;
}

/** Launches one test (§6.1): a NEW Element on the source run's
* Object (C1 — the rehearsal way, real Elements in the real Space),
* a rehearsal run carrying the tried body — the definition's saved
* body, or the editor's unsaved one (D6) — plus the fixture
* REFERENCE. The fixture body itself never enters the transcript:
* the server loads the row when the run executes, and the hash the
* result binds to is the tried body's, so a result against an
* edited-then-changed body reads as an old version's automatically.
* Launching is always a person's act (D7); nothing here is called
* by a tick. */
export async function launchDefinitionTest(args: {
admin: SupabaseClient;
userDb: SupabaseClient;
userId: string;
testId: string;
bodyOverride?: string;
startRun: (runId: string) => Promise<void>;
}): Promise<{ ok: true; runId: string; elementId: string} | { ok: false; reason: string; detail?: string}> {
const { admin, userDb, userId} = args;
const { data: testRow} = await userDb.from("definition_tests")
.select(DEFINITION_TEST_COLUMNS).eq("id", args.testId).maybeSingle();
if (!testRow) return { ok: false, reason: "test_not_found"};
const test = testRow as unknown as DefinitionTestRow;
if (!parseFixture(test.fixture)) return { ok: false, reason: "fixture_unreadable"};
const { data: defRow} = await userDb.from("definitions")
.select("id, name, body").eq("id", test.definition_id).maybeSingle();
if (!defRow) return { ok: false, reason: "definition_not_found"};
const definition = defRow as { id: string; name: string; body: string};
const body = args.bodyOverride?? definition.body;

// The test's Element lives where the source run's Element lives.
let objectId: string | null = null;
if (test.source_run_id) {
const { data: srcRun} = await admin.from("agent_runs")
.select("element_id").eq("id", test.source_run_id).maybeSingle();
const srcElementId = (srcRun as { element_id?: string | null} | null)?.element_id?? null;
if (srcElementId) {
const { data: srcEl} = await userDb.from("elements")
.select("object_id").eq("id", srcElementId).maybeSingle();
objectId = (srcEl as { object_id?: string | null} | null)?.object_id?? null;
}
}
if (!objectId) return { ok: false, reason: "source_element_gone"};
const { data: obj} = await userDb.from("objects").select("id, domain_id").eq("id", objectId).maybeSingle();
if (!obj) return { ok: false, reason: "source_element_gone"};
const object = obj as { id: string; domain_id: string | null};
const workerId = await aiWorkerOf(admin, test.activity_space_id);
if (!workerId) return { ok: false, reason: "no_ai_worker"};

const title = `${test.name}`.slice(0, 200);
const description = "（定義の再現テストです。連携の読み取り・書き込みは実サービスに接続せず、記録された fixture から再生されます。）";
const { data: el, error: elError} = await userDb.from("elements")
.insert({
title, description, object_id: object.id, status: "todo", priority: "medium",
labels: ["rehearsal", "definition-test"], definition_id: null,
})
.select("id").single();
if (elError ||!el) return { ok: false, reason: "element_failed", detail: elError?.message};
const elementId = (el as { id: string}).id;
const { error: asError} = await userDb.from("element_assignees")
.insert({ element_id: elementId, worker_id: workerId, role: "assignee"});
if (asError) return { ok: false, reason: "assign_failed", detail: asError.message};
const { data: run, error: runError} = await userDb.from("agent_runs")
.insert({
element_id: elementId, domain_id: object.domain_id, worker_id: workerId,
triggered_from: "definition-test", triggered_by: userId, status: "queued", mode: "execute",
rehearsal: true,
transcript: {
messages: [], turns: 0, nudges: 0,
rehearsalDefinition: { name: definition.name, body},
testFixture: { testId: test.id, definitionId: test.definition_id},
},
})
.select("id").single();
if (runError ||!run) return { ok: false, reason: "run_failed", detail: runError?.message};
const runId = (run as { id: string}).id;
// last_run_id is the settle's pointer; members hold no update
// grant on this table, so the engine writes it (service role).
await admin.from("definition_tests").update({ last_run_id: runId}).eq("id", test.id);
await args.startRun(runId).catch(() => {});
return { ok: true, runId, elementId};
}

/** Settles a finished test run onto its row (§6.4): the verdict,
* computed by judgeTestRun against the STORED expectation, the
* tried body's hash, one result step on the run (+ the first
* divergence), and one notification to the launcher — never to
* all owners; a test is one person's evidence. Idempotent through
* last_run_at: a settle whose result already stands at or after
* this run's finish writes nothing again. The run's own verdict
* record is not touched — a test run's result lives here, the way
* a rehearsal's lives in its report. Callers: the automations tick
* and the run-agent catch-up when a person drives a test action. */
export async function settleDefinitionTest(
admin: SupabaseClient,
test: DefinitionTestRow,
): Promise<{ settled: boolean}> {
if (!test.last_run_id) return { settled: false};
const { data: runRow} = await admin.from("agent_runs")
.select("id, status, transcript, model, step_count, finished_at, triggered_by, element_id")
.eq("id", test.last_run_id).maybeSingle();
if (!runRow) return { settled: false};
const run = runRow as {
id: string; status: string; model: string | null; step_count: number;
finished_at: string | null; triggered_by: string | null; element_id: string | null;
transcript: {
rehearsal?: unknown; test?: Record<string, unknown> | null;
rehearsalDefinition?: { name?: string; body?: string};
} | null;
};
if (run.status!== "completed" && run.status!== "failed") return { settled: false};
if (test.last_run_at && run.finished_at
&& new Date(test.last_run_at).getTime() >= new Date(run.finished_at).getTime()) {
return { settled: true};
}
const fixture = parseFixture(test.fixture);
const expected = parseFixtureExpected(test.expected);
const report = readRehearsalReport(run.transcript?.rehearsal);
const state = parseTranscriptTest(run.transcript?.test)?? {
divergences: [], divergenceOverflow: 0,
consumed: 0, total: fixture?.exchanges.length?? 0, repeats: 0, consumedSeqs: [],
};
const escalationTarget = typeof run.transcript?.test?.escalation === "string"
? (run.transcript.test.escalation as string): null;
let verdict: TestVerdict;
if (!fixture ||!expected) {
verdict = {
outcome: "fail", classification: "unverifiable",
expectedClassification: expected?.classification?? "unverifiable",
divergences: [], divergenceOverflow: 0,
consumed: 0, total: fixture?.exchanges.length?? 0,
writePlans: { matched: 0, total: expected?.writePlans.length?? 0},
bodyHash: "", model: run.model?? "", at: new Date().toISOString(),
escalationTarget,
};
} else {
let bodyHash = "";
const triedBody = run.transcript?.rehearsalDefinition?.body;
if (typeof triedBody === "string") {
bodyHash = await definitionBodyHash(triedBody);
} else {
const { data: defRow} = await admin.from("definitions")
.select("body").eq("id", test.definition_id).maybeSingle();
if (defRow) bodyHash = await definitionBodyHash((defRow as { body: string}).body);
}
verdict = judgeTestRun({
fixture, expected, report,
runFailed: run.status === "failed",
state, bodyHash, model: run.model?? "", at: new Date(),
escalationTarget,
});
}
await admin.from("definition_tests").update({
last_result: verdict, last_run_at: new Date().toISOString(),
last_body_hash: verdict.bodyHash || null,
}).eq("id", test.id);

const first = verdict.divergences[0];
const detail = [
`分類: ${verdict.classification}（期待: ${verdict.expectedClassification}）`,
`交換: ${verdict.consumed}/${verdict.total} 消費`,
...(first? [`最初の divergence: ${first.kind}（${first.action}）`]: []),
...(verdict.escalationTarget? [`エスカレーション先: ${verdict.escalationTarget}（テストのため通知していません）`]: []),
...(!fixture ||!expected? ["保存された fixture が読めず、判定できませんでした"]: []),
].join("。") + "。";
const title = verdict.outcome === "pass"? "定義テスト: 合格": "定義テスト: 不合格";
const idx = run.step_count?? 0;
await admin.from("agent_run_steps").insert({
run_id: run.id, idx, type: "test", title, detail,
}).then(() => {}, () => {});
await admin.from("agent_runs").update({ step_count: idx + 1}).eq("id", run.id);
if (run.triggered_by) {
await admin.from("notifications").insert({
recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "definition_test",
definition_test_id: test.id, element_id: run.element_id,
title: `定義テスト「${test.name}」が終わりました`,
body: `${title}。${detail}`,
}).then(() => {}, () => {});
}
return { settled: true};
}

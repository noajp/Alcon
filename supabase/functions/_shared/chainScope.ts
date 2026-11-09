// Capability attenuation for chained runs (back-half program B10,
// design: ~/workspace/dev/alcon-b10-design.md).
//
// When a run starts another run — advanceFrom unblocking the Elements
// downstream of a finished one — the child does not inherit the
// starter's whole reach. At its birth the server mints a chain scope
// from settled records alone (the parent run's row, the child's
// resolved definition, the Space's connection rows and their tested
// manifests — never from model text): the Strategy the child serves,
// an allowlist of (integration, canonical action) pairs, and a depth
// under a cap. The scope's truth is the run row (agent_runs.chain_
// scope, insert-only, service role — migration 20261211090000); a
// JWT `alcon_chain` claim is only its carriage (delegatedAuth.ts).
// Enforcement lives in the approval gate (approvalPolicy.ts judges
// the chain fact before every floor), never in the tool offer: the
// offer is politeness, the gate is the boundary.
//
// This module is the pure core plus the derivation's read shell:
// scope shape and canonical form, parsing that fails closed, the
// derivation from a definition, the parent∩derived intersection the
// monotonic-subset property is stated over, and the per-call fact
// the drivers compose. Minting (who may write a scope, and where)
// lives with the three server paths that create runs: run-agent's
// advanceFrom / decidePlan and automations' fire.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolCall } from "./agentLoop.ts";
import { canonicalAction, parseManifest, type Manifest } from "./connectorManifest.ts";
import { commandNameForTool } from "./autonomy.ts";
import { connectorMatches, type IntegrationTool } from "./integrationTools.ts";
import { isGoogleDriveRow } from "./googleOAuth.ts";

/** The chain's standing policy, in one named place (the BREAKER_POLICY
 *  / QUESTION_POLICY discipline): how deep an unattended chain of
 *  advanceFrom links may run before the next Element is left ready
 *  for a person's own start. 8 links is far beyond a normal business
 *  chain (intake → classify → draft → send is 3–5) and short enough
 *  that a chain nobody has touched for eight handoffs stops and
 *  shows itself. Tests reference this constant, never the number. */
export const CHAIN_POLICY = {
  maxDepth: 8,
} as const;

/**
 * One run's place in a chain, as minted at its birth and never
 * changed afterwards. The allowlist is a CEILING, not a permission:
 * an action listed here still faces manifest deny, the breakers and
 * the approval composition exactly as before — the scope only ever
 * narrows what a chain may touch, it never widens anything.
 */
export interface ChainScope {
  v: 1;
  /** The run the chain started from; invariant across every link. */
  rootRunId: string;
  /** The run that started this one; the run itself for a root. */
  parentRunId: string;
  /** The Strategy this run's Element serves (strategyOfElement's
   *  resolution), or null when it serves none. Recorded in v1, not
   *  enforced: the board/catalog reach stays the entry policy's
   *  judgement (design §9 limits). */
  strategyId: string | null;
  /** This run's depth: root 0, each advanceFrom link +1. */
  depth: number;
  /** The chain's cap, copied from CHAIN_POLICY at mint; invariant. */
  maxDepth: number;
  /** The allowlist: "<integration_id>:<canonical action>", sorted, unique. */
  actions: string[];
  /** The coarse fence: integration ids this chain may touch at all —
   *  the surface manifest-less calls (Drive's typed tools) are
   *  judged by. Sorted, unique. */
  integrations: string[];
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** Pure. The scope in canonical form: lists sorted and de-duplicated,
 *  fields in a fixed order — the form equality (claim vs row) and the
 *  subset property are both stated over. */
export function normalizeChainScope(scope: ChainScope): ChainScope {
  return {
    v: 1,
    rootRunId: scope.rootRunId,
    parentRunId: scope.parentRunId,
    strategyId: scope.strategyId,
    depth: scope.depth,
    maxDepth: scope.maxDepth,
    actions: sortedUnique(scope.actions),
    integrations: sortedUnique(scope.integrations),
  };
}

/** Pure. Canonical equality of two scopes. */
export function chainScopeEquals(a: ChainScope, b: ChainScope): boolean {
  return JSON.stringify(normalizeChainScope(a)) === JSON.stringify(normalizeChainScope(b));
}

/** The scope a broken record reads as: nothing allowed, no depth
 *  left — a malformed scope can never launder itself into "no
 *  scope" (which is what null means, and null is wider). */
function emptyChainScope(): ChainScope {
  return {
    v: 1, rootRunId: "", parentRunId: "", strategyId: null,
    depth: CHAIN_POLICY.maxDepth, maxDepth: CHAIN_POLICY.maxDepth,
    actions: [], integrations: [],
  };
}

function readChainScope(value: unknown): { scope: ChainScope; malformed: boolean } | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return { scope: emptyChainScope(), malformed: true };
  const r = value as Record<string, unknown>;
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? sortedUnique(v as string[]) : null;
  const actions = list(r.actions);
  const integrations = list(r.integrations);
  const valid = r.v === 1
    && typeof r.rootRunId === "string" && r.rootRunId.length > 0
    && typeof r.parentRunId === "string" && r.parentRunId.length > 0
    && (r.strategyId === null || typeof r.strategyId === "string")
    && typeof r.depth === "number" && Number.isInteger(r.depth) && r.depth >= 0
    && typeof r.maxDepth === "number" && Number.isInteger(r.maxDepth) && r.maxDepth >= 1
    && actions !== null && integrations !== null;
  if (!valid) return { scope: emptyChainScope(), malformed: true };
  return {
    malformed: false,
    scope: {
      v: 1,
      rootRunId: r.rootRunId as string,
      parentRunId: r.parentRunId as string,
      strategyId: (r.strategyId as string | null) ?? null,
      depth: r.depth as number,
      maxDepth: r.maxDepth as number,
      actions: actions!,
      integrations: integrations!,
    },
  };
}

/**
 * Pure. A stored chain_scope read as a scope: absent (null/undefined)
 * is null — the run carries no scope, today's every run. Present but
 * malformed is the EMPTY scope (fail closed): a broken record denies
 * every integration call and spends the chain's whole depth, it
 * never widens into unscoped.
 */
export function parseChainScope(value: unknown): ChainScope | null {
  return readChainScope(value)?.scope ?? null;
}

/** Pure. True when a present value is not a well-formed scope — the
 *  driver says so on the run once (the fact is recorded, not silent). */
export function chainScopeMalformed(value: unknown): boolean {
  return readChainScope(value)?.malformed ?? false;
}

/**
 * Pure. Whether a JWT's `alcon_chain` claim (delegatedAuth's
 * chainClaimOf reads it unverified — carriage inspection only) is
 * the carriage of THIS run's row scope: it must name this run, the
 * row must carry a scope, and the claimed scope must equal the
 * row's canonical form. The claim never grants anything — a forged
 * or mismatched one only ever refuses the drive (serve()'s check);
 * the row is the truth the gate enforces from.
 */
export function chainClaimMatches(claim: unknown, rowScope: ChainScope | null, runId: string): boolean {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
  const c = claim as Record<string, unknown>;
  if (c.runId !== runId) return false;
  if (!rowScope) return false;
  const claimed = parseChainScope({
    v: c.v, rootRunId: c.rootRunId, parentRunId: c.parentRunId,
    strategyId: c.strategyId ?? null, depth: c.depth, maxDepth: c.maxDepth,
    actions: c.actions, integrations: c.integrations,
  });
  return claimed !== null && chainScopeEquals(claimed, rowScope);
}

// ── Derivation ───────────────────────────────────────────────────────

/** One Space integration row as derivation reads it: the assembly's
 *  own row shape, with the manifest already parsed (null when the
 *  row carries none — a present-but-unreadable manifest parses to
 *  zero commands, which derivation treats as declaring nothing). */
export interface DerivationIntegration {
  id: string;
  name: string;
  preset: string | null;
  kind: string;
  manifest: Manifest | null;
  isDrive: boolean;
}

/**
 * Pure. The reach a definition allows, from its connectors section
 * and the Space's eligible integration rows — deliberately the
 * assembly's own rules (connectorMatches is shared with the tool
 * offer), so "what is offered" and "what the scope allows" come
 * from the same parts:
 *
 *   - connectors named → only rows answering to one of the names;
 *     connectors empty → the definition limits nothing, and the
 *     derivation reaches every eligible row (the scope then freezes
 *     that set at mint: connections added later never enter a
 *     standing chain).
 *   - A row with a readable manifest declaring ≥1 command: its id
 *     fences the integration, and EVERY declared command's canonical
 *     action joins the allowlist — deny-permission commands included
 *     (the list is a ceiling, not a permission; manifest deny stands
 *     separately, always).
 *   - A manifest-less row (Drive's typed tools, a bare HTTP API):
 *     its id alone — that surface is judged per integration.
 *   - A row whose manifest declares nothing, and an untested MCP
 *     row (no manifest at all): excluded from both lists, exactly
 *     as the assembly closes them.
 */
export function deriveScopeFromDefinition(args: {
  connectors: readonly string[];
  integrations: readonly DerivationIntegration[];
  strategyId: string | null;
}): { actions: string[]; integrations: string[] } {
  const matched = args.connectors.length
    ? args.integrations.filter((row) => connectorMatches(row, args.connectors))
    : args.integrations;
  const actions = new Set<string>();
  const integrations = new Set<string>();
  for (const row of matched) {
    if (row.isDrive) {
      integrations.add(row.id);
      continue;
    }
    if (row.manifest) {
      if (row.manifest.commands.length === 0) continue;
      integrations.add(row.id);
      for (const command of row.manifest.commands) actions.add(`${row.id}:${command.action}`);
      continue;
    }
    // No manifest: a bare HTTP API still offers its raw request tool
    // (judged at the gate, never by this list); an untested MCP row
    // declares nothing and stays closed, as in the assembly.
    if (row.kind === "http") integrations.add(row.id);
  }
  return { actions: sortedUnique([...actions]), integrations: sortedUnique([...integrations]) };
}

/** Pure. A root's scope: depth 0, its own parent and root, the
 *  derivation as it stands (an automation's fired run is born
 *  scoped this way — the harness its person named is the standing
 *  permission the scope is derived from). */
export function rootChainScope(args: {
  runId: string;
  derived: { actions: string[]; integrations: string[] };
  strategyId: string | null;
}): ChainScope {
  return normalizeChainScope({
    v: 1, rootRunId: args.runId, parentRunId: args.runId, strategyId: args.strategyId,
    depth: 0, maxDepth: CHAIN_POLICY.maxDepth,
    actions: args.derived.actions, integrations: args.derived.integrations,
  });
}

/**
 * Pure. A child's scope: its own definition's derivation, cut down
 * to the parent's scope — the intersection is the whole mechanism,
 * so a child can never reach anything its parent could not, nor
 * anything its own definition does not name. An unscoped parent (a
 * person's root) hands down the derivation itself at depth 1. An
 * empty intersection is still a scope (it says "this chain touches
 * nothing here") — never null, which would mean unscoped.
 */
export function deriveChildScope(args: {
  parent: ChainScope | null;
  parentRunId: string;
  derived: { actions: string[]; integrations: string[] };
  strategyId: string | null;
}): ChainScope {
  const parent = args.parent;
  const parentActions = parent ? new Set(parent.actions) : null;
  const parentIntegrations = parent ? new Set(parent.integrations) : null;
  return normalizeChainScope({
    v: 1,
    rootRunId: parent?.rootRunId ?? args.parentRunId,
    parentRunId: args.parentRunId,
    strategyId: args.strategyId,
    depth: parent ? parent.depth + 1 : 1,
    maxDepth: parent?.maxDepth ?? CHAIN_POLICY.maxDepth,
    actions: parentActions ? args.derived.actions.filter((a) => parentActions.has(a)) : args.derived.actions,
    integrations: parentIntegrations ? args.derived.integrations.filter((i) => parentIntegrations.has(i)) : args.derived.integrations,
  });
}

/** Pure. The depth a child of this parent would stand at, and
 *  whether the cap refuses it a birth at all: a child past the cap
 *  is NOT created (its Element stays ready; a person's own start
 *  begins a new root and resets the depth — design §4.2). */
export function chainDepthFor(args: { parent: ChainScope | null; hasParentRun: boolean }): { depth: number; maxDepth: number; capped: boolean } {
  const maxDepth = args.parent?.maxDepth ?? CHAIN_POLICY.maxDepth;
  const depth = !args.hasParentRun ? 0 : args.parent ? args.parent.depth + 1 : 1;
  return { depth, maxDepth, capped: depth > maxDepth };
}

/**
 * Pure. The monotonic-subset relation the property test pins
 * (design §3.4): child ⊆ parent in both lists, same cap, same root,
 * exactly one deeper. Stated over concrete scopes; an unscoped
 * parent enters the test as the virtual scope of everything the
 * derivation could reach.
 */
export function chainScopeSubsetOf(child: ChainScope, parent: ChainScope): boolean {
  const inParent = (list: readonly string[], from: readonly string[]) => {
    const set = new Set(from);
    return list.every((x) => set.has(x));
  };
  return inParent(child.actions, parent.actions)
    && inParent(child.integrations, parent.integrations)
    && child.maxDepth === parent.maxDepth
    && child.rootRunId === parent.rootRunId
    && child.depth === parent.depth + 1;
}

/** Pure. Whether one allowlist key is inside the fence. */
export function chainAllows(scope: ChainScope, key: string): boolean {
  return scope.actions.includes(key);
}

// ── The per-call fact ────────────────────────────────────────────────

/**
 * Pure. The allowlist key of one integration call, derived exactly
 * the way B7 derives a call's command (commandNameForTool over the
 * tool's name, then the manifest's canonical action) — one naming
 * rule for every record that speaks of an action. Null when the
 * call carries no manifest command.
 */
export function chainKeyForCall(it: IntegrationTool | undefined, call: ToolCall): string | null {
  if (!it?.command || !it.manifest) return null;
  const name = commandNameForTool(it.integration, call.name, it.manifest);
  const action = name ? canonicalAction(it.manifest, name) : null;
  return action ? `${it.integration.id}:${action}` : null;
}

/**
 * Pure. This call's standing inside a run's chain scope, as the one
 * pre-composed fact the approval gate judges first (approvalPolicy's
 * `chain` fact — data, not a branch, like B7's autonomyGrant):
 *
 *   - a manifest command (read or write — D3: the fence binds
 *     reads too, because a read across the fence carries one
 *     Strategy's world into another's context): its allowlist key
 *     decides.
 *   - a typed tool with no manifest (Drive's): the integration id
 *     decides — that surface has no canonical actions to list.
 *   - the raw http_request: unattributable to any declared command,
 *     so a scoped run never makes one — the fence's outside, by
 *     construction.
 *   - anything that is not an integration call at all (catalog /
 *     board / runner / machine tools, Alcon's own record tools):
 *     null — no fact; those surfaces keep their own entry policies
 *     (design §5.5 / §9 limits).
 */
export function chainFactFor(scope: ChainScope, it: IntegrationTool | undefined, call: ToolCall): { inScope: boolean } | null {
  if (!it) return null;
  if (it.command && it.manifest) {
    const key = chainKeyForCall(it, call);
    return { inScope: key !== null && chainAllows(scope, key) };
  }
  if (it.drive || it.remote) return { inScope: scope.integrations.includes(it.integration.id) };
  return { inScope: false };
}

/** Pure. The refusal a chain-denied call is answered with — the
 *  third wording of the gate's deny delivery, beside the catalog's
 *  and the manifest's: it names the fence and who can move it, so
 *  the model stops retrying and the finish can report it honestly. */
export function chainDenyRefusal(integrationName: string, action: string): string {
  return `この操作は、この連鎖に許可された範囲の外です（${integrationName} の ${action}）。範囲は開始時に決まり、広げるのは定義を直す人の行為です。`;
}

// ── The derivation's read shell ──────────────────────────────────────

/**
 * The Space's eligible integration rows in derivation form (the
 * assembly's selection: enabled, mcp/http kinds), manifests parsed.
 * Read through whichever client the minting path holds — the rows
 * are the person's own connections either way, and what is derived
 * from them is a narrowing, never a reach.
 */
export async function loadDerivationIntegrations(db: SupabaseClient, spaceId: string): Promise<DerivationIntegration[]> {
  const { data } = await db.from("integrations")
    .select("id, preset, kind, name, endpoint, auth_type, manifest")
    .eq("activity_space_id", spaceId).eq("enabled", true).in("kind", ["mcp", "http"]).order("created_at");
  type Row = { id: string; preset: string | null; kind: string; name: string; endpoint: string; auth_type: string; manifest: unknown };
  return ((data ?? []) as Row[]).map((row) => {
    const isDrive = isGoogleDriveRow(row);
    return {
      id: row.id, name: row.name, preset: row.preset ?? null, kind: row.kind,
      manifest: row.manifest != null && !isDrive ? parseManifest(row.manifest).manifest : null,
      isDrive,
    };
  });
}

/** The Strategy an Object serves (strategyOfElement's resolution,
 *  keyed by the Object the minting path already holds). */
export async function strategyIdForObject(db: SupabaseClient, objectId: string | null): Promise<string | null> {
  if (!objectId) return null;
  const { data } = await db.from("strategy_objects").select("strategy_id").eq("object_id", objectId).limit(1).maybeSingle();
  return (data as { strategy_id?: string } | null)?.strategy_id ?? null;
}

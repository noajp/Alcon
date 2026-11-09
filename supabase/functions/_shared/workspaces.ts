// Governed workspaces (coding capability PR1): a definition that
// declares a machine requirement (definition.ts' MachineRequirement)
// gets a workspace bound to its run — provisioned per run by the
// server, or, when the definition allows it, a standing isolated
// runner on the person's own infrastructure. This file is the pure
// core: caps, egress policy, cost, the classification's invariants
// and the provider's request shapes. The provider client is
// spritesProvider.ts; the database orchestration is
// workspaceLifecycle.ts; run-agent only wires them.
//
// The principles (sandbox brief, coding design §5–§7):
// - Execution exists only as tools bound to a definition. A run
//   whose definition declares no machine is offered no machine
//   tools, however many shell runners happen to be online.
// - No credential ever enters the box. A managed workspace's only
//   secret is its own asset token (the runner's identity for the
//   relay, scoped to this one asset); the env file the server
//   writes carries that and nothing else.
// - Egress is the definition's declared list, enforced by the
//   provider's network policy from outside the box. The relay the
//   runner itself answers to is infrastructure, always allowed,
//   and recorded as part of the effective set.
// - Per-run disposable, with server-enforced caps: wall clock per
//   workspace, concurrent workspaces per Space, monthly spend per
//   Space (the heartbeat-cap discipline: stop at the cap).

import type { MachineRequirement } from "./definition.ts";

export type WorkspaceClass = "managed" | "standing";
export type WorkspaceStatus = "provisioning" | "ready" | "destroyed" | "failed" | "expired";

/** The caps every workspace lives under, before a definition's own
 *  tightening. Server-side constants in v1: the enforcement is the
 *  point, and the numbers are the deployment's posture. */
export interface WorkspaceCaps {
  wallClockMs: number;
  maxConcurrentPerSpace: number;
  monthlySpendCapUsd: number;
}

export const DEFAULT_WORKSPACE_CAPS: WorkspaceCaps = {
  wallClockMs: 4 * 60 * 60_000,
  maxConcurrentPerSpace: 3,
  monthlySpendCapUsd: 25,
};

/** The planning rate for a managed workspace: Sprites bills actual
 *  use with idle auto-pause; the brief's arithmetic is ≈ $0.23 per
 *  4-hour agent session. Caps judge against this estimate — the
 *  record says so (cost_basis 'estimate'); it is a stop, not a bill. */
export const SPRITES_USD_PER_HOUR_ESTIMATE = 0.0575;

/** How long an assembly waits for a freshly provisioned runner to
 *  announce itself before the run goes on without it this slice
 *  (the binding completes on a later slice; the record persists). */
export const WORKSPACE_READY_WAIT_MS = 45_000;

/** Pure. The caps a run's workspace lives under: the server's,
 *  tightened by the definition's declared wall clock — a definition
 *  may narrow its own cap, never widen the server's. */
export function capsForRequirement(req: MachineRequirement): WorkspaceCaps {
  return {
    ...DEFAULT_WORKSPACE_CAPS,
    wallClockMs: req.wallClockMs != null
      ? Math.min(DEFAULT_WORKSPACE_CAPS.wallClockMs, req.wallClockMs)
      : DEFAULT_WORKSPACE_CAPS.wallClockMs,
  };
}

// ── Egress ─────────────────────────────────────────────────────────────

export interface NetworkRule { domain: string; action: "allow" | "deny" }

/** Pure. The host a URL names, or null when it names none. */
export function hostOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname ? u.hostname.toLowerCase() : null;
  } catch { return null; }
}

/** Pure. The effective egress set: the declared hosts plus the
 *  infrastructure hosts the workspace cannot exist without (the
 *  asset relay it answers to). Declared order first, deduped. */
export function egressHostsFor(declared: readonly string[], infra: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const h of [...declared, ...infra]) {
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Pure. The provider network policy for an effective host set: an
 * allow per host and a final deny of everything else (the provider
 * evaluates in order; private ranges are blocked by the provider
 * regardless). Null when the set itself declares "*" — an explicitly
 * unrestricted declaration has no policy to apply, and the record
 * says so instead of pretending one was enforced.
 */
export function networkPolicyRules(hosts: readonly string[]): NetworkRule[] | null {
  if (hosts.includes("*")) return null;
  return [...hosts.map((domain) => ({ domain, action: "allow" as const })), { domain: "*", action: "deny" as const }];
}

// ── The classification's invariants (design §7) ────────────────────────
// The machine tools' "read" classification is sound only while three
// invariants hold. They are computed from the binding's facts and
// recorded, never assumed from the tool's shape.

export interface MachineBindingFacts {
  cls: WorkspaceClass;
  /** "server": the platform provisioned the box and placed nothing
   *  in it but the runner's own asset token. "self-reported": a
   *  runner on the person's own infrastructure says it is isolated;
   *  the platform cannot attest to its contents. */
  credentialFree: "server" | "self-reported";
  /** The definition's declared egress, as declared. */
  egressDeclared: readonly string[];
  /** The provider confirmed the declared egress is what's enforced. */
  egressEnforced: boolean;
}

export interface MachineInvariants {
  credentialFree: boolean;
  egressRestricted: boolean;
  perRunDisposal: boolean;
}

/** Pure. Which of the classification's conditions a binding meets. */
export function machineInvariants(facts: MachineBindingFacts): MachineInvariants {
  return {
    // Both attestations count — the local split would otherwise be
    // unusable — but the record keeps which one it was.
    credentialFree: facts.credentialFree === "server" || facts.credentialFree === "self-reported",
    // An explicitly unrestricted declaration is restricted to
    // exactly what was declared: nothing was widened behind the
    // definition's back. Anything narrower needs the enforcement.
    egressRestricted: facts.egressDeclared.includes("*") || facts.egressEnforced,
    perRunDisposal: facts.cls === "managed",
  };
}

/**
 * Pure. The kind a machine call runs as. "read" only while every
 * invariant holds — per-run disposal counting as held when the
 * definition itself waived it ("any"). A binding that fails one
 * makes its calls ask like writes: the approval machinery, not a
 * blanket classification, then judges each call.
 */
export function machineCallKind(facts: MachineBindingFacts, req: MachineRequirement): "read" | "write" {
  const inv = machineInvariants(facts);
  const disposalOk = inv.perRunDisposal || req.disposal === "any";
  return inv.credentialFree && inv.egressRestricted && disposalOk ? "read" : "write";
}

// ── Caps: cost, concurrency, monthly spend ─────────────────────────────

/** Pure. A workspace's estimated cost over a window, at the
 *  planning rate. Rounded to 4 places — cap arithmetic, not billing. */
export function estimateCostUsd(startedAtMs: number, endedAtMs: number): number {
  const hours = Math.max(0, endedAtMs - startedAtMs) / 3_600_000;
  return Math.round(hours * SPRITES_USD_PER_HOUR_ESTIMATE * 10_000) / 10_000;
}

export interface WorkspaceSpendRow {
  /** The recorded cost of a closed workspace; null while it lives. */
  costUsd: number | null;
  createdAtMs: number;
  /** When the workspace closed; null while it lives (its accrued
   *  estimate is counted up to `now` instead). */
  closedAtMs: number | null;
}

/** Pure. What a set of workspace records has spent: closed ones at
 *  their recorded cost, live ones at their accrued estimate. */
export function monthSpendUsd(rows: readonly WorkspaceSpendRow[], nowMs: number): number {
  let total = 0;
  for (const r of rows) {
    total += r.costUsd ?? estimateCostUsd(r.createdAtMs, r.closedAtMs ?? nowMs);
  }
  return Math.round(total * 10_000) / 10_000;
}

export type CapViolation = "concurrency" | "monthly_spend";

/** Pure. Whether one more workspace may be provisioned in a Space. */
export function capViolation(liveCount: number, monthSpend: number, caps: WorkspaceCaps): CapViolation | null {
  if (liveCount >= caps.maxConcurrentPerSpace) return "concurrency";
  if (monthSpend >= caps.monthlySpendCapUsd) return "monthly_spend";
  return null;
}

// ── Provisioning shapes ────────────────────────────────────────────────

/** Pure. A run's sprite name: stable per run, so a retried slice
 *  finds the same machine instead of minting a second one. */
export function spriteNameForRun(runId: string): string {
  return `alcon-ws-${runId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24)}`;
}

/** Pure. One value, shell-quoted for the env file the runner's
 *  bootstrap sources. Single quotes, with the '\'' escape — the
 *  file carries the asset token, so quoting must be exact. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Pure. The env file the server writes into a fresh workspace
 * (mode 0600, through the provider's file API — it never travels in
 * a command or a step record). Its whole contents: where the relay
 * is, this workspace's own asset token, its name, and where the
 * runner build is published. No Vault value, no connection
 * credential, no person's secret — the box's only secret is its
 * own identity, scoped to this one asset.
 */
export function workspaceEnvFile(input: { relayUrl: string; token: string; name: string; runnerUrl: string }): string {
  return [
    `ALCON_RELAY=${shellQuote(input.relayUrl)}`,
    `ALCON_TOKEN=${shellQuote(input.token)}`,
    `ALCON_NAME=${shellQuote(input.name)}`,
    `ALCON_RUNNER_URL=${shellQuote(input.runnerUrl)}`,
    "",
  ].join("\n");
}

/** The dependency pin the bootstrap installs: sdk/node/runner/
 *  package.json's own pin, so the provisioned runner runs the same
 *  build a person would install by hand. */
export const RUNNER_PLAYWRIGHT_PIN = "1.56.1";

/**
 * Pure. The bootstrap a managed workspace runs as its service: fetch
 * the runner build (a single file, published by the deployment —
 * WORKSPACE_RUNNER_URL), install its one dependency, and exec the
 * runner as an isolated, machine-only machine. Idempotent: a sprite
 * that wakes cold re-runs it and reuses what's already there. The
 * script itself holds no secret — the values live in the env file
 * it sources.
 */
export function bootstrapScript(): string {
  return [
    "#!/bin/bash",
    "# Alcon workspace bootstrap — written by the server at provisioning.",
    "# Sources the env file beside it (the workspace's own relay identity),",
    "# installs the runner build, and execs it. Safe to re-run on wake.",
    "set -eu",
    'export ALCON_HOME="$HOME/.alcon"',
    'mkdir -p "$ALCON_HOME/runner"',
    "set -a",
    '. "$ALCON_HOME/env"',
    "set +a",
    'cd "$ALCON_HOME/runner"',
    '[ -f alcon-runner.mjs ] || curl -fsSL "$ALCON_RUNNER_URL" -o alcon-runner.mjs',
    "cat > package.json <<'JSON'",
    `{"name":"alcon-runner","private":true,"type":"module","dependencies":{"playwright-core":"${RUNNER_PLAYWRIGHT_PIN}"}}`,
    "JSON",
    "[ -d node_modules/playwright-core ] || npm install --omit=dev --no-audit --no-fund --loglevel=error",
    "exec node alcon-runner.mjs --isolated --shell --no-browser --headless",
    "",
  ].join("\n");
}

/** Pure. Where inside the workspace the bootstrap files live. */
export const WORKSPACE_HOME = "/home/sprite/.alcon";

// ── The provider seam ──────────────────────────────────────────────────

/** The provider's network-policy request body, as documented. */
export function networkPolicyBody(rules: readonly NetworkRule[]): { rules: NetworkRule[] } {
  return { rules: rules.map((r) => ({ domain: r.domain, action: r.action })) };
}

/** The provider's create request body, as documented. */
export function createSpriteBody(name: string, labels: readonly string[]): { name: string; labels: string[] } {
  return { name, labels: [...labels] };
}

/**
 * A sandbox provider: the lifecycle the governed path needs, and
 * nothing else. Implementations are thin REST clients over the
 * provider's documented API; every shape above is built here so a
 * test can pin it without a network.
 */
export interface WorkspaceProvider {
  readonly id: string;
  create(name: string, labels: readonly string[]): Promise<{ name: string; status: string }>;
  destroy(name: string): Promise<void>;
  setNetworkPolicy(name: string, rules: readonly NetworkRule[]): Promise<void>;
  writeFile(name: string, path: string, content: string, mode?: string): Promise<void>;
  putService(name: string, service: string, spec: { cmd: string; args: string[] }): Promise<void>;
}

// ── The provisioning record ────────────────────────────────────────────

/** One row of run_workspaces, as the engine reads it. The row is the
 *  audit: vendor, sandbox, caps, egress as declared, and how the
 *  story ended, all on it. */
export interface WorkspaceRecord {
  id: string;
  runId: string;
  spaceId: string;
  provider: string;
  cls: WorkspaceClass;
  status: WorkspaceStatus;
  sandboxId: string | null;
  assetId: string | null;
  egressDeclared: string[];
  egressEffective: string[];
  egressEnforced: boolean;
  credentialFree: "server" | "self-reported";
  caps: WorkspaceCaps;
  deadline: string | null;
  costUsd: number | null;
  error: string | null;
  destroyReason: string | null;
  createdAt: string;
  readyAt: string | null;
  destroyedAt: string | null;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const stringOrNull = (v: unknown): string | null => typeof v === "string" && v ? v : null;

/** Pure. A run_workspaces row read tolerantly: a malformed row is
 *  null (no record) rather than a half-trusted binding. */
export function parseWorkspaceRow(row: Record<string, unknown> | null | undefined): WorkspaceRecord | null {
  if (!row || typeof row.id !== "string" || typeof row.run_id !== "string" || typeof row.activity_space_id !== "string") return null;
  const cls = row.class === "standing" ? "standing" : "managed";
  const status = (["provisioning", "ready", "destroyed", "failed", "expired"] as const).includes(row.status as WorkspaceStatus)
    ? row.status as WorkspaceStatus : "failed";
  const capsRaw = row.caps && typeof row.caps === "object" ? row.caps as Record<string, unknown> : {};
  const caps: WorkspaceCaps = {
    wallClockMs: typeof capsRaw.wallClockMs === "number" && capsRaw.wallClockMs > 0 ? capsRaw.wallClockMs : DEFAULT_WORKSPACE_CAPS.wallClockMs,
    maxConcurrentPerSpace: typeof capsRaw.maxConcurrentPerSpace === "number" && capsRaw.maxConcurrentPerSpace > 0 ? capsRaw.maxConcurrentPerSpace : DEFAULT_WORKSPACE_CAPS.maxConcurrentPerSpace,
    monthlySpendCapUsd: typeof capsRaw.monthlySpendCapUsd === "number" && capsRaw.monthlySpendCapUsd > 0 ? capsRaw.monthlySpendCapUsd : DEFAULT_WORKSPACE_CAPS.monthlySpendCapUsd,
  };
  return {
    id: row.id,
    runId: row.run_id,
    spaceId: row.activity_space_id,
    provider: typeof row.provider === "string" ? row.provider : "sprites",
    cls,
    status,
    sandboxId: stringOrNull(row.sandbox_id),
    assetId: stringOrNull(row.asset_id),
    egressDeclared: stringList(row.egress_declared),
    egressEffective: stringList(row.egress_effective),
    egressEnforced: row.egress_enforced === true,
    credentialFree: row.credential_free === "self-reported" ? "self-reported" : "server",
    caps,
    deadline: stringOrNull(row.deadline),
    costUsd: typeof row.cost_usd === "number" ? row.cost_usd : (typeof row.cost_usd === "string" && row.cost_usd !== "" && Number.isFinite(Number(row.cost_usd)) ? Number(row.cost_usd) : null),
    error: stringOrNull(row.error),
    destroyReason: stringOrNull(row.destroy_reason),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    readyAt: stringOrNull(row.ready_at),
    destroyedAt: stringOrNull(row.destroyed_at),
  };
}

/** Pure. The run a runner's manifest says it was provisioned for,
 *  or null for a runner a person started themselves. A provisioned
 *  asset belongs to its run alone: it may never fulfil another
 *  run's requirement, standing-allowed or not. */
export function provisionedRunIdOf(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") return null;
  const p = (manifest as { provisioned?: unknown }).provisioned;
  if (!p || typeof p !== "object") return null;
  const runId = (p as { run_id?: unknown }).run_id;
  return typeof runId === "string" && runId ? runId : null;
}

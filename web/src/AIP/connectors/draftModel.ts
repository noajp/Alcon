import type { Integration, IntegrationDraft, IntegrationDraftStatus, Json } from '@/types/database';
import { INTEGRATION_PRESETS, criticalClassOfManifestCommand, type CriticalClass } from './catalog';

// The web's side of G4 (AI-drafted connections): the reconcile twin, the
// draft status and test-outcome words, and the content hashes the review
// screen compares a live connection against. The server's pure module
// (supabase/functions/_shared/connectorDraft.ts) is the original of the
// reconcile and the projections; web code cannot import it, so the rules
// are copied here and tests/connectorDraft.test.ts holds the two to the
// same answers, the way catalog.ts's isSafeEndpoint is held to the
// server's. Pure — no React, no Supabase.

export const DRAFT_STATUS_LABELS: Record<IntegrationDraftStatus, string> = {
  drafting: 'Drafting',
  awaiting_input: 'Waiting for input',
  testing: 'Testing',
  awaiting_review: 'Waiting for review',
  active: 'Active',
  rejected: 'Rejected',
  failed: 'Drafting failed',
  expired: 'Review expired',
  superseded: 'Superseded',
  rerouted: 'Already has a route',
};

export const DRAFT_FAILURE_LABELS: Record<string, string> = {
  manifest_invalid: 'The definition could not be read',
  blocked: 'The address is not allowed',
  unreachable: 'No response from the service',
  auth_failed: 'Authentication failed',
  auth_unverified: 'Authentication could not be confirmed',
  endpoint_error: 'The endpoint looks wrong',
  schema_mismatch: 'The arguments did not fit',
  server_error: 'The service returned an error',
  unverifiable: 'Could not be verified',
};

export const foldDraftName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** The open draft for a service name in this list, if one is running. */
export function openDraftForName(drafts: readonly IntegrationDraft[], name: string): IntegrationDraft | null {
  const key = foldDraftName(name);
  return drafts.find((d) => d.name_key === key
    && (d.status === 'drafting' || d.status === 'awaiting_input' || d.status === 'testing' || d.status === 'awaiting_review')) ?? null;
}

// ── Reconcile (the twin) ─────────────────────────────────────────────────

export type DraftReconcileOutcome =
  | { kind: 'connected'; rowId: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'registry'; title: string; endpoint: string }
  | { kind: 'update'; rowId: string }
  | { kind: 'join'; draftId: string }
  | { kind: 'create' };

/** The presets a name can resolve to here: the fixed, connectable ones. */
const RECONCILE_PRESETS = INTEGRATION_PRESETS
  .filter((p) => (p.kind === 'mcp' || p.kind === 'http') && !p.custom)
  .map((p) => ({ id: p.id, name: p.name }));

function rowAliases(row: Pick<Integration, 'name' | 'preset'>): string[] {
  const presetName = RECONCILE_PRESETS.find((p) => p.id === row.preset)?.name ?? '';
  return [row.name, row.preset ?? '', presetName].filter(Boolean);
}

function hostOf(raw: string): string | null {
  try { return new URL(raw).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return null; }
}

/** The same decision as the server's reconcileDraft, over the rows the
 *  browser can see: an existing route is never drafted around. */
export function reconcileDraftWeb(args: {
  name: string;
  integrations: readonly Integration[];
  drafts: readonly IntegrationDraft[];
  knownHost?: string | null;
}): DraftReconcileOutcome {
  const key = foldDraftName(args.name);
  if (!key) return { kind: 'create' };
  const matches = (row: Integration) => rowAliases(row).some((a) => foldDraftName(a) === key);
  const connected = args.integrations.find((r) => r.enabled && matches(r));
  if (connected) return { kind: 'connected', rowId: connected.id };
  const preset = RECONCILE_PRESETS.find((p) => foldDraftName(p.id) === key || foldDraftName(p.name) === key);
  if (preset) return { kind: 'preset', presetId: preset.id };
  const existing = args.integrations.find((r) => matches(r))
    ?? (args.knownHost ? args.integrations.find((r) => hostOf(r.endpoint) === args.knownHost) : undefined);
  if (existing) return { kind: 'update', rowId: existing.id };
  const open = openDraftForName(args.drafts, args.name);
  if (open) return { kind: 'join', draftId: open.id };
  return { kind: 'create' };
}

// ── Test rounds, as stored on the draft ──────────────────────────────────

export interface DraftCommandResult {
  command: string;
  effect: 'read' | 'write';
  /** Reads run for real; writes are only ever assembled, never sent. */
  executed: boolean;
  status: number | null;
  /** A DraftFailureClass, or null when the command answered. */
  failure: string | null;
  detail: string;
  /** The limit argument the test run forced to its floor, if any. */
  limitedBy: string | null;
}

export interface DraftTestRound {
  at: string;
  /** passed | failed | unverifiable | auth_unverified */
  outcome: string;
  authVerified: boolean;
  /** The negative control's story, when one ran (design addendum §4.4). */
  control: string | null;
  results: DraftCommandResult[];
}

/** Reads the stored rounds; anything malformed reads as no rounds. */
export function readTestRounds(raw: Json | null): DraftTestRound[] {
  if (!Array.isArray(raw)) return [];
  const rounds: DraftTestRound[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const x = r as Record<string, unknown>;
    if (typeof x.at !== 'string' || typeof x.outcome !== 'string') continue;
    const results = (Array.isArray(x.results) ? x.results : []).flatMap((v): DraftCommandResult[] => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
      const c = v as Record<string, unknown>;
      if (typeof c.command !== 'string') return [];
      return [{
        command: c.command,
        effect: c.effect === 'write' ? 'write' : 'read',
        executed: c.executed === true,
        status: typeof c.status === 'number' ? c.status : null,
        failure: typeof c.failure === 'string' ? c.failure : null,
        detail: typeof c.detail === 'string' ? c.detail : '',
        limitedBy: typeof c.limitedBy === 'string' ? c.limitedBy : null,
      }];
    });
    rounds.push({
      at: x.at, outcome: x.outcome, authVerified: x.authVerified === true,
      control: typeof x.control === 'string' ? x.control : null, results,
    });
  }
  return rounds;
}

/** One command of a drafted manifest, as the review screen lists it. */
export interface DraftCommandRow {
  name: string;
  effect: 'read' | 'write';
  permission: string;
  description: string;
  method: string | null;
  path: string | null;
  critical: CriticalClass | null;
}

/** The candidate's commands for display: reads first, then writes, each
 *  with the critical class the name and method derive (never a claim the
 *  manifest makes about itself). Malformed entries are skipped — the
 *  server validated the stored candidate, so this only reads its shape. */
export function readManifestCommands(raw: Json | null): DraftCommandRow[] {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const list = Array.isArray(m?.commands) ? m.commands : [];
  const rows: DraftCommandRow[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const x = c as Record<string, unknown>;
    if (typeof x.name !== 'string' || !x.name) continue;
    const http = x.http && typeof x.http === 'object' && !Array.isArray(x.http) ? x.http as Record<string, unknown> : null;
    rows.push({
      name: x.name,
      effect: x.effect === 'write' ? 'write' : 'read',
      permission: typeof x.permission === 'string' ? x.permission : x.effect === 'write' ? 'ask' : 'allow',
      description: typeof x.description === 'string' ? x.description : '',
      method: typeof http?.method === 'string' ? http.method : null,
      path: typeof http?.path === 'string' ? http.path : null,
      critical: criticalClassOfManifestCommand(x),
    });
  }
  return [...rows.filter((r) => r.effect === 'read'), ...rows.filter((r) => r.effect === 'write')];
}

// ── Content hashes (the twin) ────────────────────────────────────────────
//
// The review screen's drift check (§4.11): a drafted connection's current
// content is hashed here and set against the hashes its draft recorded
// when a person activated it. Structure and permissions are hashed
// apart, so a legitimate permission edit does not cry wolf. The
// canonical JSON and the projections are the server's
// (integrationPlans.canonicalJson, connectorDraft's structure /
// permissions), copied; the agreement test pins them together.

/** Pure. A JSON string with object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface TwinVerify { command: string; expect: Record<string, unknown>; delayMs: number }

interface TwinCommand {
  name: string; action: string; effect: 'read' | 'write'; permission: 'allow' | 'ask' | 'deny';
  http: { method: string; path: string; query: string[]; body: string[] } | null;
  mcp: string | null;
  input: Record<string, unknown>; required: string[];
  rules: { when: Record<string, string>; permission: 'allow' | 'ask' | 'deny' }[];
  verify: TwinVerify | null;
  reversibility: 'contained' | 'wide' | 'none' | null;
}

const NAME_RE = /^[a-z][a-z0-9_]{0,47}$/;
const FIELD_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const PERMISSIONS = new Set(['allow', 'ask', 'deny']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const REVERSIBILITIES = new Set(['contained', 'wide', 'none']);

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A command's verify declaration, read as the server's parseVerify reads
 *  it: undefined when absent, null when malformed, the declaration
 *  otherwise (delay clamped to the same [0, 5000] cap). */
function parseVerifyTwin(raw: unknown): TwinVerify | null | undefined {
  if (raw === undefined) return undefined;
  const x = obj(raw);
  if (!x) return null;
  if (typeof x.command !== 'string' || !NAME_RE.test(x.command)) return null;
  const expectRaw = obj(x.expect);
  if (!expectRaw) return null;
  const entries = Object.entries(expectRaw);
  if (!entries.length || entries.length > 16) return null;
  for (const [k, v] of entries) {
    if (!FIELD_RE.test(k)) return null;
    try { if (JSON.stringify(v)?.length > 500) return null; } catch { return null; }
  }
  let delayMs = 0;
  if (x.delay_ms !== undefined) {
    if (typeof x.delay_ms !== 'number' || !Number.isFinite(x.delay_ms)) return null;
    delayMs = Math.min(5000, Math.max(0, Math.floor(x.delay_ms)));
  }
  return { command: x.command, expect: { ...expectRaw }, delayMs };
}

/** A stored manifest read the way the server's parseManifest reads it —
 *  for manifests that were validated when drafted, so the loose cases
 *  here only mirror the server's refusals. */
function parseManifestTwin(raw: unknown): { commands: TwinCommand[]; aliases: Record<string, string>; defaults: { read: string; write: string } } {
  const m = obj(raw) ?? {};
  const d = obj(m.defaults) ?? {};
  const def = (effect: 'read' | 'write'): 'allow' | 'ask' | 'deny' => {
    const v = d[effect];
    return typeof v === 'string' && PERMISSIONS.has(v) ? v as 'allow' | 'ask' | 'deny' : effect === 'read' ? 'allow' : 'ask';
  };
  const defaults = { read: def('read'), write: def('write') };
  const commands: TwinCommand[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(m.commands) ? m.commands : []) {
    const x = obj(c);
    const name = typeof x?.name === 'string' ? x.name : '';
    if (!x || !NAME_RE.test(name) || seen.has(name)) continue;
    const effect = x.effect === 'write' ? 'write' : x.effect === 'read' ? 'read' : null;
    if (!effect) continue;
    let http: TwinCommand['http'] = null;
    const h = obj(x.http);
    if (h) {
      const method = String(h.method ?? 'GET').toUpperCase();
      const path = typeof h.path === 'string' ? h.path : '';
      if (!METHODS.has(method) || !path.startsWith('/')) continue;
      if (effect === 'read' && method !== 'GET' && method !== 'HEAD') continue;
      http = { method, path, query: strings(h.query), body: strings(h.body) };
    }
    const mcp = typeof x.mcp === 'string' && x.mcp ? x.mcp : null;
    if (!http && !mcp) continue;
    const verify = parseVerifyTwin(x.verify);
    if (verify === null) continue;
    seen.add(name);
    const rules = (Array.isArray(x.rules) ? x.rules : []).flatMap((r): TwinCommand['rules'] => {
      const y = obj(r);
      const when = obj(y?.when);
      if (!y || !when || typeof y.permission !== 'string' || !PERMISSIONS.has(y.permission)) return [];
      const fields = Object.entries(when).filter(([k, v]) => FIELD_RE.test(k) && typeof v === 'string' && v.length <= 500) as [string, string][];
      if (!fields.length || fields.length !== Object.keys(when).length) return [];
      return [{ when: Object.fromEntries(fields), permission: y.permission as 'allow' | 'ask' | 'deny' }];
    }).slice(0, 50);
    commands.push({
      name, effect, http, mcp, rules,
      action: typeof x.action === 'string' && x.action.trim() ? x.action.trim() : name,
      permission: typeof x.permission === 'string' && PERMISSIONS.has(x.permission) ? x.permission as 'allow' | 'ask' | 'deny' : def(effect),
      input: obj(x.input) ?? {},
      required: strings(x.required),
      verify: verify ?? null,
      reversibility: typeof x.reversibility === 'string' && REVERSIBILITIES.has(x.reversibility) ? x.reversibility as TwinCommand['reversibility'] : null,
    });
  }
  // The server's second pass, mirrored: a verify must sit on a write and
  // name a read command of the same manifest, or the command is out.
  const effectByName = new Map(commands.map((c) => [c.name, c.effect]));
  const kept = commands.filter((c) => !c.verify || (c.effect === 'write' && effectByName.get(c.verify.command) === 'read'));
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(m.aliases) ?? {})) if (typeof v === 'string') aliases[k] = v;
  return { commands: kept, aliases, defaults };
}

export interface DraftContentLike {
  name: string;
  endpoint: string;
  auth_type: string;
  auth_header: string | null;
  manifest: unknown;
  guide: string | null;
}

/** The structure projection (permissions stripped), as the server's draftStructureOf. */
export function draftStructureOfWeb(c: DraftContentLike): unknown {
  const { commands, aliases } = parseManifestTwin(c.manifest);
  return {
    name: c.name, endpoint: c.endpoint, auth_type: c.auth_type, auth_header: c.auth_header, guide: c.guide,
    commands: commands
      .map((cmd) => ({ name: cmd.name, action: cmd.action, effect: cmd.effect, http: cmd.http, mcp: cmd.mcp, input: cmd.input, required: cmd.required, verify: cmd.verify, reversibility: cmd.reversibility }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    aliases,
  };
}

/** The permissions projection (defaults + per-command permission and rules), as the server's. */
export function draftPermissionsOfWeb(c: DraftContentLike): unknown {
  const { commands } = parseManifestTwin(c.manifest);
  const raw = obj(c.manifest);
  return {
    defaults: obj(raw?.defaults) ?? { read: 'allow', write: 'ask' },
    commands: commands
      .map((cmd) => ({ name: cmd.name, permission: cmd.permission, rules: cmd.rules }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

export async function draftStructureHashWeb(c: DraftContentLike): Promise<string> {
  return sha256Hex(canonicalJson(draftStructureOfWeb(c)));
}

export async function draftPermissionHashWeb(c: DraftContentLike): Promise<string> {
  return sha256Hex(canonicalJson(draftPermissionsOfWeb(c)));
}

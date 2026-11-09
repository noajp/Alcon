// The catalog of external services a Space can connect for its agents
// (ADR 0027), and the pure rules around it: which presets exist, how the
// catalog is grouped by the way a connection is made, what an
// `integrations` row looks like when created
// from a preset or a custom form, and how a stored `last_test` is read.
//
// A `model` connection is an AI model provider with a Messages API in
// Anthropic's format. It is not an agent's tool: an AI Worker picks one as the
// model it runs on, and the connections themselves are added where they are
// consumed — Settings › Team, under Models.
//
// Pure — no React, no Supabase — so the rules are unit-tested in
// tests/integrationsCatalog.test.ts. Display strings here are English source
// strings; the screen passes them through t().

import type { ApprovalMode } from './approvalModeModel';
import type { Json } from '@/types/database';
import { GMAIL_MANIFEST } from './gmailManifest';

export type IntegrationKind = 'mcp' | 'http' | 'model';
export type IntegrationAuthType = 'none' | 'bearer' | 'header' | 'oauth';
export type IntegrationDelegation = 'approve_each' | 'full_delegation';
export type IntegrationCategory = 'project' | 'files' | 'communication' | 'development' | 'models' | 'custom';
export type IntegrationSource = 'official' | 'community' | 'custom';

export interface IntegrationPreset {
  id: string;
  name: string;
  description: string;
  /** Image URL of the service's logo (from svgl.app, kept in
   *  public/integrations). Null for the custom presets; the card falls back
   *  to the name's first letter. */
  icon: string | null;
  kind: IntegrationKind;
  /** Fixed endpoint. Null for the custom presets, where the person types it. */
  endpoint: string | null;
  auth: IntegrationAuthType;
  /** What the credential is called at this service. */
  credentialLabel: string;
  category: IntegrationCategory;
  source: IntegrationSource;
  builtBy: string;
  featured: boolean;
  /** True for Custom MCP / Custom API: name, endpoint and auth are typed. */
  custom: boolean;
  /** The manifest a row created from this preset is born with, for a
   *  preset whose commands are first-party declarations no drafting
   *  route can produce (the gmail read pair). Absent: the row starts
   *  with no manifest — an MCP server's is built by its first
   *  connection test, a drafted connection's arrives by activation. */
  bundledManifest?: Json;
  /** Why the preset cannot be connected yet; the connect button is disabled. */
  unavailableReason?: string;
}

export const INTEGRATION_PRESETS: readonly IntegrationPreset[] = [
  {
    id: 'linear', name: 'Linear', icon: '/integrations/linear.svg', kind: 'mcp', endpoint: 'https://mcp.linear.app/mcp', auth: 'bearer',
    description: "Read and update Linear issues, projects and cycles through Linear's MCP server.",
    credentialLabel: 'Linear API key', category: 'project', source: 'official', builtBy: 'Linear', featured: true, custom: false,
  },
  {
    id: 'asana', name: 'Asana', icon: '/integrations/asana.svg', kind: 'http', endpoint: 'https://app.asana.com/api/1.0', auth: 'bearer',
    description: 'Read and update Asana projects and their work through the Asana REST API.',
    credentialLabel: 'Personal access token', category: 'project', source: 'official', builtBy: 'Asana', featured: true, custom: false,
  },
  {
    id: 'google-drive', name: 'Google Drive', icon: '/integrations/google-drive.svg', kind: 'http', endpoint: 'https://www.googleapis.com/drive/v3', auth: 'oauth',
    description: 'Search, read, create and update Google Drive files. Agents see only files Alcon created or that you chose.',
    credentialLabel: 'Google account', category: 'files', source: 'official', builtBy: 'Google', featured: true, custom: false,
  },
  {
    id: 'gmail', name: 'Gmail', icon: '/integrations/gmail.svg', kind: 'http', endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me', auth: 'oauth',
    description: 'Search, read and send Gmail messages, reply in threads, and mark messages with labels. Agents cannot delete mail.',
    credentialLabel: 'Google account', category: 'communication', source: 'official', builtBy: 'Google', featured: false, custom: false,
    bundledManifest: GMAIL_MANIFEST,
  },
  {
    id: 'github', name: 'GitHub', icon: '/integrations/github.svg', kind: 'mcp', endpoint: 'https://api.githubcopilot.com/mcp/', auth: 'oauth',
    description: "Review and merge pull requests in Alcon, and let agents work with repositories, issues and pull requests through GitHub's MCP server.",
    credentialLabel: 'GitHub account', category: 'development', source: 'official', builtBy: 'GitHub', featured: false, custom: false,
  },
  {
    id: 'slack', name: 'Slack', icon: '/integrations/slack.svg', kind: 'http', endpoint: 'https://slack.com/api', auth: 'bearer',
    description: 'Read channels and post messages through the Slack Web API.',
    credentialLabel: 'Bot token (xoxb-)', category: 'communication', source: 'official', builtBy: 'Slack', featured: false, custom: false,
  },
  // Model providers. Each serves Anthropic's Messages format under the base
  // URL its own docs give for that format; any other such provider (GLM on
  // https://api.z.ai/api/anthropic, say) connects as a Custom model API.
  {
    id: 'deepseek', name: 'DeepSeek', icon: '/integrations/deepseek.svg', kind: 'model', endpoint: 'https://api.deepseek.com/anthropic', auth: 'bearer',
    description: 'Run AI agents on DeepSeek models.',
    credentialLabel: 'API key', category: 'models', source: 'official', builtBy: 'DeepSeek', featured: false, custom: false,
  },
  {
    id: 'kimi', name: 'Kimi', icon: '/integrations/kimi.svg', kind: 'model', endpoint: 'https://api.moonshot.ai/anthropic', auth: 'bearer',
    description: 'Run AI agents on Moonshot AI\'s Kimi models.',
    credentialLabel: 'API key', category: 'models', source: 'official', builtBy: 'Moonshot AI', featured: false, custom: false,
  },
  {
    id: 'custom-mcp', name: 'Custom MCP', icon: null, kind: 'mcp', endpoint: null, auth: 'bearer',
    description: 'Connect any remote MCP server that speaks Streamable HTTP.',
    credentialLabel: 'Credential', category: 'custom', source: 'custom', builtBy: 'You', featured: false, custom: true,
  },
  {
    id: 'custom-http', name: 'Custom API', icon: null, kind: 'http', endpoint: null, auth: 'bearer',
    description: 'Connect any HTTPS API by its base URL. Agents can call paths under it.',
    credentialLabel: 'Credential', category: 'custom', source: 'custom', builtBy: 'You', featured: false, custom: true,
  },
  {
    id: 'custom-model', name: 'Custom model API', icon: null, kind: 'model', endpoint: null, auth: 'bearer',
    description: 'Connect any model provider that serves the Anthropic Messages API format.',
    credentialLabel: 'API key', category: 'custom', source: 'custom', builtBy: 'You', featured: false, custom: true,
  },
];

/** The custom preset an integration without a known preset is shown as. */
export function customPresetFor(kind: IntegrationKind): IntegrationPreset {
  return presetById(kind === 'mcp' ? 'custom-mcp' : kind === 'model' ? 'custom-model' : 'custom-http')!;
}

export const KIND_LABELS: Record<IntegrationKind, string> = { mcp: 'MCP', http: 'API', model: 'AI model' };

export const SOURCE_LABELS: Record<IntegrationSource, string> = {
  official: 'Official',
  community: 'Community',
  custom: 'Custom',
};

// Logos drawn in one color that would vanish on a dark surface have a
// light-on-dark counterpart, shown under the dark themes.
const DARK_ICONS: Record<string, string> = {
  '/integrations/github.svg': '/integrations/github-dark.svg',
};

/** The logo to show under a dark theme, when it differs from the light one. */
export function darkIconFor(icon: string): string | null {
  return DARK_ICONS[icon] ?? null;
}

export function presetById(id: string | null | undefined): IntegrationPreset | null {
  return INTEGRATION_PRESETS.find((p) => p.id === id) ?? null;
}

/** True for a preset that connects by signing in (OAuth) rather than a pasted credential. */
export function signsInWithOAuth(preset: IntegrationPreset): boolean {
  return !preset.custom && preset.auth === 'oauth';
}

export type OAuthProvider = 'google' | 'github';

/** Whom a sign-in preset signs in with; null for one that takes a credential. */
export function oauthProviderOf(preset: IntegrationPreset): OAuthProvider | null {
  if (!signsInWithOAuth(preset)) return null;
  return preset.id === 'github' ? 'github' : 'google';
}

/** The provider's proper name, for "Sign in with {provider}". */
export const OAUTH_PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', github: 'GitHub' };

// ── Connection method ──────────────────────────────────────────────────────
//
// How a connection is made, derived from what a preset already declares —
// never stored. A custom preset is set up by the person (name, endpoint
// and auth are typed); a sign-in preset connects by OAuth consent, which
// Athena initiates; anything else takes a credential the person issues
// at the service and pastes. Whether a sign-in can actually complete is
// a state, not a method: it depends on the provider's OAuth client being
// registered on the server (integration-oauth/status), checked per card
// at render time.

export type ConnectionMethod = 'sign-in' | 'token' | 'custom';

export function connectionMethodOf(preset: IntegrationPreset): ConnectionMethod {
  if (preset.custom) return 'custom';
  if (signsInWithOAuth(preset)) return 'sign-in';
  return 'token';
}

export type CatalogCardState = 'ready' | 'setup-needed';

export interface CatalogGroup {
  method: ConnectionMethod;
  cards: { preset: IntegrationPreset; state: CatalogCardState }[];
}

/** The method groups' fixed order on the catalog page. */
export const CONNECTION_METHOD_ORDER: readonly ConnectionMethod[] = ['sign-in', 'token', 'custom'];

/** The "Add a connection" groups over the presets offered: grouped by
 *  connection method in the fixed order, installed presets excluded (a
 *  custom preset is always offered — a Space can hold several custom
 *  connections of a kind), empty groups omitted. A sign-in card whose
 *  provider the server reports as not configured is 'setup-needed'; a
 *  provider still loading (null) reads as ready — the dialog re-checks.
 *  Which presets are offered is the caller's choice: this groups
 *  whatever it is fed. */
export function catalogGroups(
  presets: readonly IntegrationPreset[],
  installed: ReadonlySet<string>,
  oauthConfigured: Record<OAuthProvider, boolean | null>,
): CatalogGroup[] {
  const byMethod = new Map<ConnectionMethod, { preset: IntegrationPreset; state: CatalogCardState }[]>();
  for (const preset of presets) {
    if (!preset.custom && installed.has(preset.id)) continue;
    const method = connectionMethodOf(preset);
    const provider = oauthProviderOf(preset);
    const state: CatalogCardState = provider !== null && oauthConfigured[provider] === false ? 'setup-needed' : 'ready';
    const cards = byMethod.get(method) ?? [];
    cards.push({ preset, state });
    byMethod.set(method, cards);
  }
  return CONNECTION_METHOD_ORDER
    .filter((method) => byMethod.has(method))
    .map((method) => ({ method, cards: byMethod.get(method)! }));
}

/** The preset ids this Space already has at least one connection for. */
export function installedPresetIds(rows: readonly { preset: string | null }[]): Set<string> {
  return new Set(rows.map((r) => r.preset).filter((p): p is string => !!p));
}

// ── Endpoint safety ────────────────────────────────────────────────────────
//
// The same rule as isSafeEndpoint in supabase/functions/_shared/
// integrationClient.ts, which the server applies before every request. Web
// code cannot import Edge Function modules, so it is copied here and the test
// checks both agree on the same inputs.

/** True when a URL is https to a public host. */
export function isSafeEndpoint(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  // A trailing dot names the same host ("localhost." is localhost).
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (!host.includes('.') && !host.includes(':')) return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224) return false;
  }
  // IPv6 literals are refused outright, as on the server.
  if (host.includes(':')) return false;
  return true;
}

// ── Critical commands ──────────────────────────────────────────────────────
//
// The same derivation as criticalClassOf in supabase/functions/_shared/
// connectorManifest.ts, which the engine enforces: a critical command
// (send / money / delete / contract) asks every time, whatever its
// permission here says. Web code cannot import Edge Function modules, so
// it is copied here and the test checks both agree on the same commands.

export type CriticalClass = 'send' | 'money' | 'delete' | 'contract';

const CRITICAL_TOKENS: [CriticalClass, string[]][] = [
  ['delete', ['delete', 'destroy', 'erase', 'purge', 'remove', 'drop', 'trash', 'revoke']],
  ['money', ['pay', 'payment', 'payments', 'charge', 'charges', 'refund', 'refunds', 'transfer', 'transfers', 'payout', 'payouts', 'purchase', 'purchases', 'withdraw', 'withdrawal', 'deposit', 'billing', 'invoice', 'invoices']],
  ['contract', ['contract', 'contracts', 'sign', 'signature', 'agreement', 'agreements', 'quote', 'quotes', 'order', 'orders', 'checkout', 'subscribe', 'subscription', 'subscriptions']],
  ['send', ['send', 'mail', 'email', 'message', 'messages', 'notify', 'notification', 'notifications', 'publish', 'post', 'comment', 'comments', 'reply', 'replies', 'announce', 'invite', 'invites', 'share', 'dm']],
];

/** A stored manifest command's critical class, from its loose JSON. */
export function criticalClassOfManifestCommand(command: { name?: unknown; action?: unknown; effect?: unknown; http?: unknown; mcp?: unknown }): CriticalClass | null {
  if (command.effect !== 'write') return null;
  const http = command.http && typeof command.http === 'object' && !Array.isArray(command.http) ? command.http as Record<string, unknown> : null;
  if (typeof http?.method === 'string' && http.method.toUpperCase() === 'DELETE') return 'delete';
  // The path speaks through its last segment only — the operation —
  // as the server's criticalClassOf reads it: a resource's name is
  // not the call's act (a label change on a message is not a send).
  const path = typeof http?.path === 'string' ? http.path : '';
  const segments = path.split('/').filter(Boolean);
  const operation = segments.length ? segments[segments.length - 1] : '';
  const text = [command.action, command.name, command.mcp, operation]
    .filter((v): v is string => typeof v === 'string').join(' ');
  const tokens = new Set(text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const [cls, words] of CRITICAL_TOKENS) if (words.some((w) => tokens.has(w))) return cls;
  return null;
}

/** The class words the Settings copy uses, as t() source strings. */
export const CRITICAL_CLASS_LABELS: Record<CriticalClass, string> = { send: 'Send', money: 'Money', delete: 'Delete', contract: 'Contract' };

// ── Effective outcomes ─────────────────────────────────────────────────
//
// What will actually happen for one command, composed the way the
// engine composes it: the stored permission, the command's critical
// class and conditions, the connection's delegation, and the Space's
// approval mode over all of it (approvalVerdict + applyMode in
// supabase/functions/_shared/approvalPolicy.ts). The stored permission
// alone is what a person edits; this is what they should expect — the
// two differ exactly where a surface must say so. Web code cannot
// import the engine module, so the composition is copied here and a
// contract test holds the two to the same answers over the whole
// matrix (tests/effectiveOutcome.test.ts).
//
// The composition, for the static part (no call arguments at hand):
// a denial denies; a critical command asks under every delegation and
// setting — only the Free action mode lifts it, recorded as a policy
// approval and announced, like every ask that mode lifts; a command
// carrying conditions is by-rule — its conditions decide per call, so
// no static outcome exists; otherwise the stored permission composed
// with the delegation (an ask under full delegation runs), and then
// the mode (Ask-every-time collapses a write's runs to asks — a read's
// never; Free action collapses an ask to a run recorded as a policy
// approval).

export type StoredPermission = 'allow' | 'ask' | 'deny';

export type EffectiveOutcome =
  | { kind: 'asks'; why: 'critical' | 'command' | 'mode' }
  | { kind: 'runs'; how: 'allowed' | 'rule' | 'delegation' | 'mode-free' }
  | { kind: 'denied' }
  /** Argument conditions decide per call; no static outcome. */
  | { kind: 'by-rule' };

/** Pure. The outcome a person should expect for one command. */
export function effectiveOutcome(
  command: { permission: StoredPermission; effect: 'read' | 'write'; hasRules: boolean; critical: CriticalClass | null },
  ctx: { delegation: IntegrationDelegation | string | null | undefined; mode: ApprovalMode },
): EffectiveOutcome {
  if (command.permission === 'deny') return { kind: 'denied' };
  if (command.critical) {
    // The critical floor: asks under every delegation and setting.
    // The Free action mode's composition lifts any ask (applyMode has
    // no critical exception) — recorded as a policy approval, and the
    // run announces it, so the lift is disclosed, never silent.
    return ctx.mode === 'free' ? { kind: 'runs', how: 'mode-free' } : { kind: 'asks', why: 'critical' };
  }
  if (command.hasRules) return { kind: 'by-rule' };
  const base: EffectiveOutcome = command.permission === 'allow'
    ? { kind: 'runs', how: 'allowed' }
    : ctx.delegation === 'full_delegation'
      ? { kind: 'runs', how: 'delegation' }
      : { kind: 'asks', why: 'command' };
  if (ctx.mode === 'free' && base.kind === 'asks') return { kind: 'runs', how: 'mode-free' };
  if (ctx.mode === 'ask' && base.kind === 'runs' && command.effect === 'write') return { kind: 'asks', why: 'mode' };
  return base;
}

/**
 * Pure. The one policy line for a connection's command panel: what
 * writes do under this connection's delegation and this Space's mode,
 * in one sentence (an English source string for t()). Computed from
 * the same inputs as the rows beneath it, so the line and the rows
 * cannot tell different stories.
 */
export function policyLineFor(delegation: IntegrationDelegation | string | null | undefined, mode: ApprovalMode): string {
  if (mode === 'ask') return 'This Space asks every time: every write needs a person’s approval first, whatever the settings below say. Conditions and “Not allowed” still hold.';
  if (mode === 'free') return 'This Space’s Free action mode is on: writes run without asking, and what would have asked is recorded as a policy approval. Critical operations are recorded and announced.';
  if (delegation === 'full_delegation') return 'Full delegation is on, so commands set to “Asks first” run without asking. Conditions and “Not allowed” still hold.';
  return 'Writes follow each command’s setting below: a command set to “Asks first” asks a person before it runs.';
}


// ── Building a row ─────────────────────────────────────────────────────────

export interface IntegrationDraft {
  /** Custom presets only. */
  name?: string;
  /** Custom presets only. */
  endpoint?: string;
  /** Custom presets only: 'none' | 'bearer' | 'header'. */
  auth?: IntegrationAuthType;
  /** Custom presets with auth 'header': the header the credential goes in. */
  authHeader?: string;
  delegation: IntegrationDelegation;
  enabled: boolean;
}

export interface IntegrationInsertRow {
  activity_space_id: string;
  preset: string;
  kind: IntegrationKind;
  name: string;
  description: string | null;
  icon: string | null;
  endpoint: string;
  auth_type: IntegrationAuthType;
  auth_header: string | null;
  delegation: IntegrationDelegation;
  enabled: boolean;
  /** A preset's bundled first-party manifest, when it carries one. */
  manifest: Json | null;
}

export type BuildResult = { ok: true; row: IntegrationInsertRow } | { ok: false; error: string };

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const RESERVED_HEADERS = new Set(['host', 'content-type', 'content-length', 'accept', 'mcp-session-id', 'mcp-protocol-version']);

/** The `integrations` row to insert for a preset, or why it can't be. The
 *  error strings are English source strings for t(). */
export function buildIntegrationRow(preset: IntegrationPreset, spaceId: string, draft: IntegrationDraft): BuildResult {
  if (preset.unavailableReason) return { ok: false, error: preset.unavailableReason };
  if (!preset.custom) {
    return {
      ok: true,
      row: {
        activity_space_id: spaceId, preset: preset.id, kind: preset.kind, name: preset.name,
        description: preset.description, icon: preset.icon, endpoint: preset.endpoint!, auth_type: preset.auth,
        auth_header: null, delegation: draft.delegation, enabled: draft.enabled,
        manifest: preset.bundledManifest ?? null,
      },
    };
  }
  const name = (draft.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a name.' };
  const endpoint = (draft.endpoint ?? '').trim();
  if (!isSafeEndpoint(endpoint)) return { ok: false, error: 'Enter an https URL on a public host.' };
  // A model provider always takes its key as a bearer credential.
  const auth = preset.kind === 'model' ? 'bearer' : draft.auth ?? 'bearer';
  if (auth === 'oauth') return { ok: false, error: 'OAuth is not available for custom connections.' };
  let authHeader: string | null = null;
  if (auth === 'header') {
    authHeader = (draft.authHeader ?? '').trim();
    if (!HEADER_NAME.test(authHeader) || RESERVED_HEADERS.has(authHeader.toLowerCase())) {
      return { ok: false, error: 'Enter a valid header name.' };
    }
  }
  return {
    ok: true,
    row: {
      activity_space_id: spaceId, preset: preset.id, kind: preset.kind, name, description: null, icon: null,
      endpoint, auth_type: auth, auth_header: authHeader, delegation: draft.delegation, enabled: draft.enabled,
      manifest: null,
    },
  };
}

// ── last_test ──────────────────────────────────────────────────────────────

export interface IntegrationTestTool { name: string; readOnly: boolean }

export interface IntegrationTestResult {
  /** connected | reachable | auth_failed | http_error | unreachable | blocked | oauth_required | oauth_expired | oauth_scope_missing | error */
  code: string;
  ok: boolean;
  at: string | null;
  detail: string;
  /** MCP: the server's tool count. */
  toolCount: number | null;
  /** MCP: up to 20 tools. */
  tools: IntegrationTestTool[];
  /** HTTP: the response status. */
  status: number | null;
}

/** Reads the stored `last_test` jsonb. Anything malformed reads as null
 *  (never tested) rather than throwing in the render. */
export function readLastTest(raw: unknown): IntegrationTestResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ok !== 'boolean') return null;
  const tools = Array.isArray(r.tools)
    ? r.tools
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as Record<string, unknown>).name === 'string')
      .map((t) => ({ name: t.name as string, readOnly: t.readOnly === true }))
    : [];
  return {
    ok: r.ok,
    code: typeof r.code === 'string' ? r.code : (r.ok ? 'connected' : 'error'),
    at: typeof r.at === 'string' ? r.at : null,
    detail: typeof r.detail === 'string' ? r.detail : '',
    toolCount: typeof r.tool_count === 'number' ? r.tool_count : (Array.isArray(r.tools) ? tools.length : null),
    tools,
    status: typeof r.status === 'number' ? r.status : null,
  };
}

export type IntegrationStatus = 'off' | 'not-tested' | 'connected' | 'reachable' | 'action-needed';

/** The one status word a connector row shows, derived from the last test
 *  (the dialog keeps the detail, via testOutcomeLabel). Precedence: off →
 *  never tested → a sign-in problem needs the person → verified connected →
 *  reachable without a credential check → anything else that failed. */
export function integrationStatus(i: { enabled: boolean; last_test: unknown }): IntegrationStatus {
  if (!i.enabled) return 'off';
  const last = readLastTest(i.last_test);
  if (!last) return 'not-tested';
  if (!last.ok && (last.code === 'auth_failed' || last.code === 'oauth_expired' || last.code === 'oauth_required' || last.code === 'oauth_scope_missing')) return 'action-needed';
  if (last.code === 'connected') return 'connected';
  if (last.ok) return 'reachable';
  return 'action-needed';
}

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  off: 'Off',
  'not-tested': 'Not tested',
  connected: 'Connected',
  reachable: 'Reachable',
  'action-needed': 'Action needed',
};

/** Pure. The words for a connection test's outcome (a t() key). */
export function testOutcomeLabel(code: string): string {
  switch (code) {
    case 'connected': return 'Connected';
    case 'reachable': return 'Reachable — the credential was not checked';
    case 'auth_failed': return 'Authentication failed';
    case 'http_error': return 'The service returned an error';
    case 'unreachable': return 'No response from the service';
    case 'blocked': return 'Only https addresses on public hosts can be used.';
    case 'oauth_required': return 'Not connected — sign in with Google';
    case 'oauth_expired': return 'Google sign-in expired — reconnect';
    case 'oauth_scope_missing': return 'No permission to send — read-only access';
    default: return 'Failed';
  }
}

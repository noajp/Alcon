// The catalog of external services a Space can connect for its agents
// (ADR 0027), and the pure rules around it: which presets exist, how the
// catalog is filtered, what an `integrations` row looks like when created
// from a preset or a custom form, and how a stored `last_test` is read.
//
// Pure — no React, no Supabase — so the rules are unit-tested in
// tests/integrationsCatalog.test.ts. Display strings here are English source
// strings; the screen passes them through t().

export type IntegrationKind = 'mcp' | 'http';
export type IntegrationAuthType = 'none' | 'bearer' | 'header' | 'oauth';
export type IntegrationDelegation = 'approve_each' | 'full_delegation';
export type IntegrationCategory = 'project' | 'files' | 'communication' | 'development' | 'custom';
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
    id: 'github', name: 'GitHub', icon: '/integrations/github.svg', kind: 'mcp', endpoint: 'https://api.githubcopilot.com/mcp/', auth: 'oauth',
    description: "Review and merge pull requests in Alcon, and let agents work with repositories, issues and pull requests through GitHub's MCP server.",
    credentialLabel: 'GitHub account', category: 'development', source: 'official', builtBy: 'GitHub', featured: false, custom: false,
  },
  {
    id: 'slack', name: 'Slack', icon: '/integrations/slack.svg', kind: 'http', endpoint: 'https://slack.com/api', auth: 'bearer',
    description: 'Read channels and post messages through the Slack Web API.',
    credentialLabel: 'Bot token (xoxb-)', category: 'communication', source: 'official', builtBy: 'Slack', featured: false, custom: false,
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
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  project: 'Project management',
  files: 'Files',
  communication: 'Communication',
  development: 'Development',
  custom: 'Custom',
};

export const KIND_LABELS: Record<IntegrationKind, string> = { mcp: 'MCP', http: 'API' };

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

// ── Filtering ──────────────────────────────────────────────────────────────

export interface CatalogFilter {
  query: string;
  category: IntegrationCategory | null;
  kind: IntegrationKind | null;
  source: IntegrationSource | null;
}

export const EMPTY_FILTER: CatalogFilter = { query: '', category: null, kind: null, source: null };

/** Presets matching every set filter. The query matches name, description,
 *  builder and category label, case-insensitively. */
export function filterPresets(presets: readonly IntegrationPreset[], filter: CatalogFilter): IntegrationPreset[] {
  const q = filter.query.trim().toLowerCase();
  return presets.filter((p) => {
    if (filter.category && p.category !== filter.category) return false;
    if (filter.kind && p.kind !== filter.kind) return false;
    if (filter.source && p.source !== filter.source) return false;
    if (!q) return true;
    return [p.name, p.description, p.builtBy, CATEGORY_LABELS[p.category]].some((s) => s.toLowerCase().includes(q));
  });
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
      },
    };
  }
  const name = (draft.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a name.' };
  const endpoint = (draft.endpoint ?? '').trim();
  if (!isSafeEndpoint(endpoint)) return { ok: false, error: 'Enter an https URL on a public host.' };
  const auth = draft.auth ?? 'bearer';
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
    },
  };
}

// ── last_test ──────────────────────────────────────────────────────────────

export interface IntegrationTestTool { name: string; readOnly: boolean }

export interface IntegrationTestResult {
  /** connected | reachable | auth_failed | http_error | unreachable | blocked | oauth_required | oauth_expired | error */
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
    default: return 'Failed';
  }
}

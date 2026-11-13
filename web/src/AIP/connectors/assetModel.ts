import type { Asset, AssetStatus, Json } from '@/types/database';

// Pure helpers for Settings › API & access › Connected assets (ADR 0036):
// the install line a local app adds, how a manifest reads in one line, and
// the order the list shows assets in. No browser or database dependency.

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const ASSET_RELAY_URL = `${SUPABASE_URL}/functions/v1/asset-relay`;

export const ASSET_KIND_LABELS: Record<Asset['kind'], string> = {
  app: 'App',
  ai_agent: 'AI agent',
  script: 'Script',
  service: 'Service',
  other: 'Other',
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  unclaimed: 'Waiting for acceptance',
  active: 'Recognized',
  revoked: 'Revoked',
};

/** The environment the one line needs, ready to paste. */
export function relayEnvLines(relayUrl: string, spaceId: string): string {
  return [`CLAYWARE_RELAY=${relayUrl}`, `CLAYWARE_SPACE=${spaceId}`].join('\n');
}

const str = (v: Json | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/** One line of what the asset says about itself: runtime, version, host, AI providers. */
export function describeManifest(manifest: Record<string, Json>): string {
  const parts: string[] = [];
  const runtime = str(manifest.runtime);
  const version = str(manifest.version);
  if (runtime) parts.push(version ? `${runtime} · v${version}` : runtime);
  else if (version) parts.push(`v${version}`);
  const host = str(manifest.host);
  const cwd = str(manifest.cwd);
  if (host) parts.push(cwd ? `${host}/${cwd}` : host);
  else if (cwd) parts.push(cwd);
  const providers = strList(manifest.ai_providers);
  if (providers.length > 0) parts.push(`AI: ${providers.join(', ')}`);
  return parts.join(' · ');
}

/** What the relay itself saw: where the connection came from and with what client. */
export function describeObserved(observed: Record<string, Json>): string {
  const parts: string[] = [];
  const address = str(observed.address);
  const agent = str(observed.user_agent);
  if (address) parts.push(address);
  if (agent) parts.push(agent.length > 60 ? `${agent.slice(0, 57)}…` : agent);
  return parts.join(' · ');
}

const STATUS_ORDER: Record<AssetStatus, number> = { unclaimed: 0, active: 1, revoked: 2 };

/** Unrecognized first (they wait on the owner), then recognized by last activity, revoked last. */
export function sortAssets(assets: readonly Asset[]): Asset[] {
  return [...assets].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const la = a.last_seen_at ?? a.created_at;
    const lb = b.last_seen_at ?? b.created_at;
    return lb.localeCompare(la);
  });
}

/** Whether the asset has reported anything in the last `staleMinutes`. */
export function isLive(asset: Pick<Asset, 'last_seen_at' | 'status'>, now: number, staleMinutes = 10): boolean {
  if (asset.status === 'revoked' || !asset.last_seen_at) return false;
  return now - new Date(asset.last_seen_at).getTime() < staleMinutes * 60_000;
}

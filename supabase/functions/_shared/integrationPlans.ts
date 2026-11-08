// The cache for what an integration offers an agent: the plan.
//
// Planning an integration's tools (planManifestTools in integrationTools.ts)
// is a pure function of its manifest and, for MCP, the server's tool list —
// but the tool list costs a Vault read, an initialize and a tools/list on
// every assembly, and assemblies happen per message and per run slice. The
// plan's output carries no secret and no session, so it is kept in
// integration_tool_plans (one row per integration) and reused while it
// still describes the connection:
//
//   fingerprint   sha256 over the manifest's canonical form and the row's
//                 name / endpoint / kind / auth_type / updated_at. Every
//                 meaningful write to the row (a manifest edit, a
//                 remembered approval rule, a rotated secret, an endpoint
//                 change) moves updated_at, and a manifest edit moves the
//                 canonical form itself — either way the plan falls.
//   freshness     a manifest-derived plan is valid while the fingerprint
//                 matches (the row is the whole input). An MCP plan also
//                 carries the server's answer, which the row cannot see
//                 change, so it is only trusted within MCP_PLAN_TTL_MS of
//                 fetched_at. Past that, the caller refetches — and if the
//                 refetch fails, the caller still offers the stale plan
//                 (the call itself then fails honestly if the tool is
//                 really gone); only a first-ever assembly has nothing to
//                 fall back on.
//
// The planner / executor boundary stays where a resident worker could
// later pick it up: this module is the planner's store — pure validation
// plus two database touches through the narrow ToolPlanDb shape — and it
// knows nothing about runs, panels or sessions. Binding (the secret, the
// MCP session) is the executor's side, in integrationTools.ts.

import { sha256Hex } from "./googleOAuth.ts";
import type { PlannedIntegrationTool } from "./integrationTools.ts";

/** How long an MCP plan is trusted: a server's tools change rarely, and
 *  the connection test refreshes the plan the moment it runs. */
export const MCP_PLAN_TTL_MS = 15 * 60 * 1000;

/** A plan bigger than this is not cached (a very large MCP server's
 *  schemas); its tools are planned fresh on each assembly instead. */
export const MAX_PLAN_JSON_CHARS = 1_000_000;

/** One cached plan, as stored in integration_tool_plans. */
export interface StoredToolPlan {
  integration_id: string;
  fingerprint: string;
  plan: PlannedIntegrationTool[];
  fetched_at: string;
}

/** The row fields a fingerprint is taken over. */
export interface PlanFingerprintRow {
  name: string;
  endpoint: string;
  kind: string;
  auth_type: string;
  manifest?: unknown;
  updated_at?: string | null;
}

/** Pure. A JSON string with object keys sorted at every depth, so two
 *  stored forms of the same value fingerprint alike. Arrays keep their
 *  order; undefined object values are dropped, as JSON would drop them. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The fingerprint of one integration's plan inputs: the manifest's
 *  canonical form and the row fields that shape its tools. */
export async function planFingerprint(row: PlanFingerprintRow): Promise<string> {
  return sha256Hex(canonicalJson({
    manifest: row.manifest ?? null,
    name: row.name,
    endpoint: row.endpoint,
    kind: row.kind,
    auth_type: row.auth_type,
    updated_at: row.updated_at ?? null,
  }));
}

/**
 * Pure. Whether a cached plan may be used as-is ("use") or the caller
 * should try to make a fresh one ("refresh"). Refreshing and failing is
 * not the end: the caller falls back to the cached plan when one exists.
 */
export function planCacheState(
  cached: StoredToolPlan | undefined,
  fingerprint: string,
  kind: string,
  now: number,
): "use" | "refresh" {
  if (!cached || cached.fingerprint !== fingerprint) return "refresh";
  if (kind === "mcp") {
    const fetched = Date.parse(cached.fetched_at);
    if (!Number.isFinite(fetched) || now - fetched > MCP_PLAN_TTL_MS) return "refresh";
  }
  return "use";
}

/** Pure. Whether a plan is small enough to keep in the cache. */
export function planFitsCache(plan: PlannedIntegrationTool[]): boolean {
  return JSON.stringify(plan).length <= MAX_PLAN_JSON_CHARS;
}

// ── The store (service role writes; reads follow the table's RLS) ───────

/** The part of a Supabase client the plan store uses. */
export interface ToolPlanDb {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    upsert(values: Record<string, unknown>, options: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * The cached plans for a set of integrations, by integration id. The cache
 * is an optimisation, never a dependency: any failure (the table not
 * migrated yet, a read error) reads as "no plans", and the callers plan
 * fresh, exactly as they did before the cache existed.
 */
export async function loadToolPlans(db: ToolPlanDb, integrationIds: readonly string[]): Promise<Map<string, StoredToolPlan>> {
  const out = new Map<string, StoredToolPlan>();
  if (integrationIds.length === 0) return out;
  try {
    const { data, error } = await db.from("integration_tool_plans")
      .select("integration_id, fingerprint, plan, fetched_at")
      .in("integration_id", integrationIds);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as StoredToolPlan[]) {
      if (r && typeof r.integration_id === "string" && typeof r.fingerprint === "string" && Array.isArray(r.plan)) {
        out.set(r.integration_id, r);
      }
    }
  } catch { /* the cache is best-effort */ }
  return out;
}

/**
 * Stores a freshly made plan. Returns false when the plan is too large to
 * cache or the write failed — either way the caller just goes on with the
 * plan it made; the next assembly will make it again.
 */
export async function saveToolPlan(
  db: ToolPlanDb,
  integrationId: string,
  fingerprint: string,
  plan: PlannedIntegrationTool[],
): Promise<boolean> {
  if (!planFitsCache(plan)) return false;
  try {
    const { error } = await db.from("integration_tool_plans").upsert(
      { integration_id: integrationId, fingerprint, plan, fetched_at: new Date().toISOString() },
      { onConflict: "integration_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

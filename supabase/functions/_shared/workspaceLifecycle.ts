// Governed workspaces — the I/O half (coding capability PR1): the
// provisioning lifecycle over run_workspaces and the provider seam.
// workspaces.ts holds the pure decisions (caps, egress, invariants,
// cost); this file performs them:
//
//   ensureManagedWorkspace  a run whose definition declares a machine
//                           gets one workspace, minted once: caps
//                           judged from the Space's records, the
//                           sandbox created, the runner's asset
//                           pre-accepted by the server and bound to
//                           this run, bootstrap files written, the
//                           boot egress policy applied, the runner
//                           started as a service.
//   markWorkspaceReady      when the runner first answers, the
//                           egress policy tightens from the boot set
//                           (registries the install needed) to the
//                           declared set, and the record says
//                           whether that enforcement landed.
//   recordStandingBinding   a standing runner a definition allowed:
//                           the binding is recorded with its class,
//                           so the audit never confuses the two.
//   closeWorkspace          destroy + finalise (cost estimated,
//                           reason recorded). Run end closes from
//                           run-agent; the automations tick reaps
//                           what run end could not reach.
//
// Failure posture: provisioning problems are outcomes, not throws —
// the caller (a run's assembly) words them for the person and goes
// on without machine tools. Nothing here ever falls back to an
// ungoverned runner: unconfigured provider, refused caps and failed
// provisioning all end with no machine.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "./delegatedAuth.ts";
import {
  bootstrapScript, capViolation, capsForRequirement, egressHostsFor, estimateCostUsd,
  hostOfUrl, monthSpendUsd, networkPolicyRules, parseWorkspaceRow, spriteNameForRun,
  workspaceEnvFile, WORKSPACE_HOME,
  type CapViolation, type WorkspaceProvider, type WorkspaceRecord, type WorkspaceSpendRow,
} from "./workspaces.ts";
import { createSpritesProvider, spritesConfigFromEnv, type SpritesConfig } from "./spritesProvider.ts";
import type { MachineRequirement } from "./definition.ts";

type GetEnv = (name: string) => string | undefined;

const LIVE_STATUSES = ["provisioning", "ready"] as const;
const TERMINAL_RUN_STATUSES = ["completed", "awaiting_review", "failed", "cancelled"];
/** The registry the runner's own install needs (its one dependency):
 *  part of the boot egress set, never of the ready set unless the
 *  definition declared it too. */
const BOOT_INFRA_HOSTS = ["registry.npmjs.org"];
const TOKEN_PREFIX = "alc_ast_";
const REAP_LIMIT = 50;

export interface ProviderSeat { config: SpritesConfig; provider: WorkspaceProvider }

/** The configured provider, or null when no account is configured. */
export function providerSeatFromEnv(getEnv: GetEnv): ProviderSeat | null {
  const config = spritesConfigFromEnv(getEnv);
  return config ? { config, provider: createSpritesProvider(config) } : null;
}

/** The relay a workspace's runner answers to. */
export function relayUrlOf(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/asset-relay`;
}

const COLUMNS = "id, run_id, activity_space_id, provider, class, status, sandbox_id, asset_id, egress_declared, egress_effective, egress_enforced, credential_free, caps, deadline, cost_usd, error, destroy_reason, created_at, ready_at, destroyed_at";

/** A run's live workspace record, if it has one. */
export async function loadLiveWorkspace(admin: SupabaseClient, runId: string): Promise<WorkspaceRecord | null> {
  const { data } = await admin.from("run_workspaces").select(COLUMNS)
    .eq("run_id", runId).in("status", [...LIVE_STATUSES])
    .order("created_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? parseWorkspaceRow(row) : null;
}

/** A run's most recent workspace record of any status (the assembly
 *  tells a failed provisioning apart from a fresh start). */
export async function loadLatestWorkspace(admin: SupabaseClient, runId: string): Promise<WorkspaceRecord | null> {
  const { data } = await admin.from("run_workspaces").select(COLUMNS)
    .eq("run_id", runId).order("created_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? parseWorkspaceRow(row) : null;
}

function newAssetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return TOKEN_PREFIX + s;
}

export type EnsureOutcome =
  | { state: "existing"; record: WorkspaceRecord }
  | { state: "provisioning"; record: WorkspaceRecord }
  | { state: "not_configured" }
  | { state: "runner_bundle_missing" }
  | { state: "refused"; reason: CapViolation }
  | { state: "failed"; record: WorkspaceRecord | null; code: string };

/**
 * The managed lifecycle's front door. Idempotent per run: a live
 * record is returned as-is; otherwise the caps are judged and one
 * workspace is minted. The runner still has to boot and announce
 * itself before anything can bind — the outcome is "provisioning"
 * and the binding completes when the asset answers.
 */
export async function ensureManagedWorkspace(
  admin: SupabaseClient,
  getEnv: GetEnv,
  input: { runId: string; spaceId: string; starterId: string; requirement: MachineRequirement; supabaseUrl: string; now: Date },
): Promise<EnsureOutcome> {
  const existing = await loadLiveWorkspace(admin, input.runId);
  if (existing) return { state: "existing", record: existing };

  const seat = providerSeatFromEnv(getEnv);
  if (!seat) return { state: "not_configured" };
  if (!seat.config.runnerUrl) return { state: "runner_bundle_missing" };
  const { provider } = seat;

  const caps = capsForRequirement(input.requirement);
  const now = input.now;
  // Caps, judged from the Space's own records: how many workspaces
  // live now, and what this month has spent (closed records at their
  // recorded cost, live ones at their accrued estimate).
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [{ count: liveCount }, { data: monthRows }] = await Promise.all([
    admin.from("run_workspaces").select("id", { count: "exact", head: true })
      .eq("activity_space_id", input.spaceId).in("status", [...LIVE_STATUSES]),
    admin.from("run_workspaces").select("cost_usd, created_at, destroyed_at")
      .eq("activity_space_id", input.spaceId).gte("created_at", monthStart.toISOString()),
  ]);
  const spendRows: WorkspaceSpendRow[] = ((monthRows ?? []) as { cost_usd: number | string | null; created_at: string; destroyed_at: string | null }[])
    .map((r) => ({
      costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
      createdAtMs: new Date(r.created_at).getTime(),
      closedAtMs: r.destroyed_at ? new Date(r.destroyed_at).getTime() : null,
    }));
  const violation = capViolation(liveCount ?? 0, monthSpendUsd(spendRows, now.getTime()), caps);
  if (violation) return { state: "refused", reason: violation };

  const relayUrl = relayUrlOf(input.supabaseUrl);
  const relayHost = hostOfUrl(relayUrl);
  const declared = input.requirement.egress;
  // The boot set: what the install itself needs. The ready set,
  // applied at bind time, is the declared set plus the relay alone.
  const bootHosts = egressHostsFor(declared, [relayHost, hostOfUrl(seat.config.runnerUrl), ...BOOT_INFRA_HOSTS]);
  const deadline = new Date(now.getTime() + caps.wallClockMs);
  const spriteName = spriteNameForRun(input.runId);

  const { data: inserted, error: insertError } = await admin.from("run_workspaces").insert({
    run_id: input.runId,
    activity_space_id: input.spaceId,
    provider: provider.id,
    class: "managed",
    status: "provisioning",
    egress_declared: declared,
    egress_effective: bootHosts,
    egress_enforced: false,
    credential_free: "server",
    caps,
    deadline: deadline.toISOString(),
  }).select(COLUMNS).single();
  if (insertError || !inserted) return { state: "failed", record: null, code: "record_failed" };
  let record = parseWorkspaceRow(inserted as Record<string, unknown>);
  if (!record) return { state: "failed", record: null, code: "record_failed" };

  const fail = async (code: string): Promise<EnsureOutcome> => {
    await provider.destroy(spriteName).catch(() => {});
    const { data } = await admin.from("run_workspaces").update({
      status: "failed", error: code, destroyed_at: new Date().toISOString(), destroy_reason: "provision_failed",
    }).eq("id", record!.id).select(COLUMNS).single();
    return { state: "failed", record: data ? parseWorkspaceRow(data as Record<string, unknown>) : record, code };
  };

  try {
    await provider.create(spriteName, ["alcon-workspace", `space-${input.spaceId}`]);

    // The runner's asset, minted and accepted by the server: the
    // token is this workspace's own identity for the relay, its hash
    // is what the assets table holds, and the manifest's provisioned
    // block binds the asset to this run alone.
    const token = newAssetToken();
    const assetName = `workspace-${input.runId.slice(0, 8)}`;
    const { data: assetId, error: rpcError } = await admin.rpc("provision_asset", {
      p_space: input.spaceId,
      p_name: assetName,
      p_manifest: {
        runner: "alcon-runner", capabilities: ["shell", "files"], isolated: true, headless: true,
        provisioned: { by: "server", run_id: input.runId, provider: provider.id, sandbox: spriteName },
      },
      p_token_hash: await sha256Hex(token),
      p_token_prefix: token.slice(0, TOKEN_PREFIX.length + 8),
      p_claimed_by: input.starterId,
    });
    if (rpcError || !assetId) return await fail("asset_failed");

    await admin.from("run_workspaces").update({ sandbox_id: spriteName, asset_id: assetId as string }).eq("id", record.id);

    // Egress before code: the boot policy lands before a byte of the
    // runner does (the provider's own guidance, and the design's —
    // a sprite's egress is open until a policy says otherwise).
    const bootRules = networkPolicyRules(bootHosts);
    if (bootRules) await provider.setNetworkPolicy(spriteName, bootRules);

    await provider.writeFile(spriteName, `${WORKSPACE_HOME}/env`,
      workspaceEnvFile({ relayUrl, token, name: assetName, runnerUrl: seat.config.runnerUrl }), "0600");
    await provider.writeFile(spriteName, `${WORKSPACE_HOME}/bootstrap.sh`, bootstrapScript(), "0700");
    await provider.putService(spriteName, "alcon-runner", { cmd: "/bin/bash", args: [`${WORKSPACE_HOME}/bootstrap.sh`] });

    const { data } = await admin.from("run_workspaces").select(COLUMNS).eq("id", record.id).single();
    record = data ? parseWorkspaceRow(data as Record<string, unknown>) : record;
    return { state: "provisioning", record: record! };
  } catch {
    return await fail("provision_failed");
  }
}

/**
 * The bind: the runner has answered, so the workspace is real. The
 * egress policy tightens to the declared set (+ the relay) and the
 * record stamps whether the enforcement landed — a failure leaves
 * egress_enforced false, which the classification reads as "not
 * restricted" and prices the calls as asks. The workspace is marked
 * ready either way; the honesty is in the stamp, not in a refusal.
 */
export async function markWorkspaceReady(
  admin: SupabaseClient,
  getEnv: GetEnv,
  supabaseUrl: string,
  record: WorkspaceRecord,
): Promise<WorkspaceRecord> {
  let enforced = record.egressEnforced;
  let effective = record.egressEffective;
  const seat = providerSeatFromEnv(getEnv);
  if (seat && record.sandboxId) {
    const readyHosts = egressHostsFor(record.egressDeclared, [hostOfUrl(relayUrlOf(supabaseUrl))]);
    const rules = networkPolicyRules(readyHosts);
    try {
      if (rules) await seat.provider.setNetworkPolicy(record.sandboxId, rules);
      enforced = true;
      effective = readyHosts;
    } catch {
      enforced = false;
    }
  } else if (record.egressDeclared.includes("*")) {
    // Nothing to enforce: the declaration itself is unrestricted.
    enforced = true;
    effective = record.egressDeclared;
  }
  const { data } = await admin.from("run_workspaces").update({
    status: "ready", ready_at: new Date().toISOString(),
    egress_effective: effective, egress_enforced: enforced,
  }).eq("id", record.id).select(COLUMNS).single();
  return (data ? parseWorkspaceRow(data as Record<string, unknown>) : null) ?? { ...record, status: "ready", egressEffective: effective, egressEnforced: enforced };
}

/** A standing binding, recorded with its class: an isolated runner
 *  on the person's own infrastructure that the definition allowed.
 *  Nothing is provisioned and nothing will be destroyed — run end
 *  just closes the record. */
export async function recordStandingBinding(
  admin: SupabaseClient,
  input: { runId: string; spaceId: string; assetId: string; requirement: MachineRequirement },
): Promise<WorkspaceRecord | null> {
  const { data, error } = await admin.from("run_workspaces").insert({
    run_id: input.runId,
    activity_space_id: input.spaceId,
    provider: "standing",
    class: "standing",
    status: "ready",
    asset_id: input.assetId,
    egress_declared: input.requirement.egress,
    egress_effective: [],
    egress_enforced: false,
    credential_free: "self-reported",
    caps: capsForRequirement(input.requirement),
    ready_at: new Date().toISOString(),
  }).select(COLUMNS).single();
  if (error || !data) return null;
  return parseWorkspaceRow(data as Record<string, unknown>);
}

/**
 * Destroy + finalise one workspace. Returns false when the destroy
 * itself failed — the record then stays live and the tick's reaper
 * retries, rather than the audit claiming a machine is gone that
 * isn't. Standing bindings have nothing to destroy and always close.
 */
export async function closeWorkspace(
  admin: SupabaseClient,
  getEnv: GetEnv,
  record: WorkspaceRecord,
  reason: string,
  now: Date,
): Promise<boolean> {
  if (record.cls === "managed" && record.sandboxId) {
    const seat = providerSeatFromEnv(getEnv);
    if (!seat) return false; // cannot destroy what we cannot reach; the reaper retries
    try {
      await seat.provider.destroy(record.sandboxId);
    } catch {
      return false;
    }
  }
  const cost = record.cls === "managed"
    ? estimateCostUsd(new Date(record.createdAt).getTime(), now.getTime())
    : 0;
  const { error } = await admin.from("run_workspaces").update({
    status: reason === "wall_clock" ? "expired" : "destroyed",
    destroyed_at: now.toISOString(),
    destroy_reason: reason,
    cost_usd: cost,
  }).eq("id", record.id).in("status", [...LIVE_STATUSES]);
  return !error;
}

/** Run end's close: whatever live workspace the run holds. Best
 *  effort by contract — callers never let it fail a finish. */
export async function closeRunWorkspace(
  admin: SupabaseClient,
  getEnv: GetEnv,
  runId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const record = await loadLiveWorkspace(admin, runId).catch(() => null);
  if (!record) return true;
  return await closeWorkspace(admin, getEnv, record, reason, now).catch(() => false);
}

/**
 * The tick's reaper: workspaces whose wall clock ran out, and
 * workspaces whose run already ended (finished, failed, cancelled —
 * or deleted outright) without its close landing. Bounded per tick;
 * a quiet tick costs two reads.
 */
export async function reapWorkspaces(
  admin: SupabaseClient,
  getEnv: GetEnv,
  now: Date,
): Promise<{ expired: number; runEnded: number }> {
  const { data } = await admin.from("run_workspaces").select(COLUMNS)
    .in("status", [...LIVE_STATUSES]).order("created_at").limit(REAP_LIMIT);
  const records = ((data ?? []) as Record<string, unknown>[])
    .map((r) => parseWorkspaceRow(r)).filter((r): r is WorkspaceRecord => !!r);
  let expired = 0;
  let runEnded = 0;
  for (const record of records) {
    if (record.deadline && new Date(record.deadline).getTime() <= now.getTime()) {
      if (await closeWorkspace(admin, getEnv, record, "wall_clock", now).catch(() => false)) expired++;
      continue;
    }
    const { data: run } = await admin.from("agent_runs").select("status").eq("id", record.runId).maybeSingle();
    const status = (run as { status?: string } | null)?.status;
    if (!run || (status && TERMINAL_RUN_STATUSES.includes(status))) {
      if (await closeWorkspace(admin, getEnv, record, "run_ended", now).catch(() => false)) runEnded++;
    }
  }
  return { expired, runEnded };
}

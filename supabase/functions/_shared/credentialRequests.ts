// Credential requests — the creators (secure-login PR2).
//
// A credential request is a row the SERVER writes when a real need
// exists; the client renders it as the capture card. This module is
// the only place requests are born, and every creator here starts
// from a server-side fact — never from model text:
//
//   - a connection row whose Vault slot is empty, or whose latest
//     connection test was refused (captureSourceForRow reads the row,
//     nothing else);
//   - a run whose binding for such a connection has no credential
//     (the same creators, with the run named in the need);
//   - the runner facing a login wall — createRunnerWallCredentialRequest
//     is the seam PR3 calls, and its `origin` argument is a contract:
//     it must be the origin the RUNNER reported for its own current
//     page (PR3 reads it from the runner's report over the asset
//     channel), canonicalized here. Nothing a model said can be an
//     origin: no creator in this file takes a display name, a URL
//     from a tool call, or free text as a destination.
//
// There is deliberately no propose_credential tool: the model's only
// handle is propose_connection, whose judgement (connectProposal.ts)
// the drivers already run — the creators below ride that event and
// the run driver's own binding failures, both server-side facts.
//
// One pending request per need: a second ask while one is live
// reuses the live row (its card re-reads state anyway), an expired
// one is lapsed on sight and replaced. The value a person types
// never passes through here — creators move ids and display data
// (a connection's name, a site's origin, the account hint a row
// already carries), never a secret.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONNECTOR_PRESET_NAMES, foldConnectorName, lastTestNeedsReauth } from "./connectorNeeds.ts";

/** The transcript step kind a capture ask rides on. Its detail is
 *  {requestId, label} — display data only: no username, and a
 *  value exists nowhere near a step. */
export const CREDENTIAL_REQUEST_STEP = "credential_request";

/** Pending asks lapse: +7 days from chat (the copilot approval TTL
 *  idiom); a run's ask is short-lived — the design's "run lifetime +
 *  1 day", read as a day from creation since a lifetime is unknowable
 *  when the ask is written. */
export const CHAT_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RUN_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CaptureIntegrationRow {
  id: string;
  name: string;
  preset: string | null;
  kind: string;
  auth_type: string;
  secret_id: string | null;
  last_test?: unknown;
  enabled: boolean;
  endpoint: string;
  external_account: string | null;
}

export interface CredentialRequestRow {
  id: string;
  activity_space_id: string;
  kind: "integration_secret" | "site_login";
  integration_id: string | null;
  site_credential_id: string | null;
  origin: string | null;
  username_hint: string | null;
  need: Record<string, unknown>;
  status: string;
  requested_by: string | null;
  expires_at: string | null;
  created_at: string;
}

/**
 * Pure. Why a connection row needs a capture, if it does — read off
 * the row alone. Token class only: OAuth connections keep their
 * sign-in flow (capture never impersonates OAuth) and a `none`
 * connection has no credential to enter. An empty slot is a
 * 'connection' need; a filled slot whose latest test was refused is
 * a 'reauth'. Anything else (a model-kind row, a disabled row, a
 * healthy filled slot) is not a capture need.
 */
export function captureSourceForRow(row: CaptureIntegrationRow): "connection" | "reauth" | null {
  if (!row.enabled) return null;
  if (row.kind !== "mcp" && row.kind !== "http") return null;
  if (row.auth_type !== "bearer" && row.auth_type !== "header") return null;
  if (!row.secret_id) return "connection";
  if (lastTestNeedsReauth(row.last_test)) return "reauth";
  return null;
}

/** Pure. A capture step's one line — the name the person recognises,
 *  never a username and never a value. */
export function credentialRequestTitle(label: string): string {
  return `${label} の認証情報が必要です`;
}

/** Pure. A capture step's detail: the request id the card re-reads
 *  and the display label (a connection's name, a site's origin).
 *  Nothing else — in particular no username_hint: hints are read
 *  from the row by the dialog, not copied into transcripts, and the
 *  request's kind and waiting work are read from the row too. */
export function credentialStepDetail(req: { id: string }, label: string): string {
  return JSON.stringify({ requestId: req.id, label });
}

/**
 * Pure. The canonical site origin — the server twin of the web's
 * normalizeSiteOrigin (siteCredentialModel.ts) and of
 * public.normalize_site_origin: scheme://host[:port], host
 * lowercased, default port dropped, path refused, userinfo refused.
 * Returns null for anything that is not a site address.
 */
export function normalizeSiteOrigin(input: string): string | null {
  let v = (input ?? "").trim().toLowerCase();
  if (!v) return null;
  if (!v.includes("://")) v = `https://${v}`;
  const scheme = v.split("://", 1)[0];
  if (scheme !== "http" && scheme !== "https") return null;
  let authority = v.slice(scheme.length + 3);
  authority = authority.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0];
  if (authority.includes("@")) return null;
  if ((authority.match(/:/g) ?? []).length > 1) return null;
  let host = authority;
  let port: string | null = null;
  if (authority.includes(":")) {
    const [h, p] = authority.split(":");
    host = h;
    if (!/^[0-9]+$/.test(p) || Number(p) > 65535) return null;
    if (!((scheme === "https" && p === "443") || (scheme === "http" && p === "80"))) port = p;
  }
  if (!host || /[^a-z0-9.\-]/.test(host) || !/[a-z0-9]/.test(host)) return null;
  return `${scheme}://${host}${port ? `:${port}` : ""}`;
}

const CAPTURE_COLUMNS = "id, name, preset, kind, auth_type, secret_id, last_test, enabled, endpoint, external_account";
const REQUEST_COLUMNS = "id, activity_space_id, kind, integration_id, site_credential_id, origin, username_hint, need, status, requested_by, expires_at, created_at";

async function loadCaptureRows(admin: SupabaseClient, spaceId: string): Promise<CaptureIntegrationRow[]> {
  const { data } = await admin.from("integrations")
    .select(CAPTURE_COLUMNS)
    .eq("activity_space_id", spaceId)
    .in("kind", ["mcp", "http"]);
  return (data ?? []) as CaptureIntegrationRow[];
}

/** The names one connection answers to (connectorNeeds' alias rule). */
function rowMatchesName(row: CaptureIntegrationRow, foldedName: string): boolean {
  return [row.name, row.preset ?? "", CONNECTOR_PRESET_NAMES[row.preset ?? ""] ?? ""]
    .some((a) => a && foldConnectorName(a) === foldedName);
}

function isLive(req: CredentialRequestRow, now: Date): boolean {
  return !req.expires_at || new Date(req.expires_at).getTime() > now.getTime();
}

async function lapseRequest(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from("credential_requests").update({ status: "expired" }).eq("id", id).eq("status", "pending");
}

/**
 * Find-or-create the pending capture request for one connection row.
 * The row is the fact; `waitingFor` is the work that waits, in words;
 * a run raising the need names itself in `runId` (its expiry is the
 * short one). Returns null when the row is not a capture need.
 */
export async function ensureIntegrationCredentialRequest(
  admin: SupabaseClient,
  args: { spaceId: string; userId: string | null; row: CaptureIntegrationRow; waitingFor: string; runId?: string | null },
): Promise<{ request: CredentialRequestRow; created: boolean } | null> {
  const source = captureSourceForRow(args.row);
  if (!source) return null;
  const now = new Date();
  const { data: pending } = await admin.from("credential_requests")
    .select(REQUEST_COLUMNS)
    .eq("integration_id", args.row.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = (pending ?? [])[0] as CredentialRequestRow | undefined;
  if (existing) {
    if (isLive(existing, now)) return { request: existing, created: false };
    await lapseRequest(admin, existing.id);
  }
  const need: Record<string, unknown> = {
    source: args.runId ? "run" : source,
    waiting_for: args.waitingFor.slice(0, 300),
    ...(args.runId ? { run_id: args.runId } : {}),
  };
  const expiresAt = new Date(now.getTime() + (args.runId ? RUN_REQUEST_TTL_MS : CHAT_REQUEST_TTL_MS)).toISOString();
  const { data: inserted, error } = await admin.from("credential_requests")
    .insert({
      activity_space_id: args.spaceId,
      kind: "integration_secret",
      integration_id: args.row.id,
      username_hint: args.row.external_account,
      need,
      requested_by: args.userId,
      expires_at: expiresAt,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error || !inserted) return null;
  return { request: inserted as CredentialRequestRow, created: true };
}

/**
 * The proposal-path creator: for each connector name a turn named,
 * the Space's rows that answer to it and are capture needs get (or
 * keep) a request. Names with no row are the connect dialog's work —
 * there is no slot to fill until a connection exists. Called by both
 * chat drivers whenever propose_connection is judged (proposed or
 * already-connected alike: an "already connected" answer can still
 * hide an empty slot connectorNeeds does not read).
 */
export async function createCredentialRequestsForNames(
  admin: SupabaseClient,
  args: { spaceId: string; userId: string | null; names: readonly string[]; waitingFor: string; runId?: string | null },
): Promise<{ request: CredentialRequestRow; created: boolean; row: CaptureIntegrationRow }[]> {
  const wanted = new Set(
    args.names.map((n) => foldConnectorName(typeof n === "string" ? n : "")).filter(Boolean),
  );
  if (!wanted.size || !args.spaceId) return [];
  const rows = await loadCaptureRows(admin, args.spaceId);
  const out: { request: CredentialRequestRow; created: boolean; row: CaptureIntegrationRow }[] = [];
  for (const row of rows) {
    if (![...wanted].some((w) => rowMatchesName(row, w))) continue;
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: args.spaceId, userId: args.userId, row, waitingFor: args.waitingFor, runId: args.runId ?? null,
    });
    if (got) out.push({ ...got, row });
  }
  return out;
}

/**
 * The runner-wall seam (PR3 calls this): a request for the site the
 * runner's own browser is standing on. `origin` MUST be the runner's
 * reported current-page origin — a server-side fact from the asset
 * channel — never model text; it is canonicalized here and refused
 * when it is not a site address at all. A site that already holds a
 * stored credential is not a need; a pending ask for the same origin
 * is reused. The username hint comes from the caller (the stored
 * row's username) or the existing row, never invented.
 */
export async function createRunnerWallCredentialRequest(
  admin: SupabaseClient,
  args: { spaceId: string; userId: string; origin: string; waitingFor: string; runId?: string | null; usernameHint?: string | null },
): Promise<{ request: CredentialRequestRow; created: boolean } | null> {
  const origin = normalizeSiteOrigin(args.origin);
  if (!origin || !args.spaceId) return null;
  const { data: siteRows } = await admin.from("site_credentials")
    .select("id, username, secret_id")
    .eq("activity_space_id", args.spaceId)
    .eq("origin", origin)
    .limit(1);
  const site = (siteRows ?? [])[0] as { id: string; username: string; secret_id: string | null } | undefined;
  if (site?.secret_id) return null; // a stored credential stands: no wall, no ask
  const now = new Date();
  const { data: pending } = await admin.from("credential_requests")
    .select(REQUEST_COLUMNS)
    .eq("activity_space_id", args.spaceId)
    .eq("kind", "site_login")
    .eq("origin", origin)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = (pending ?? [])[0] as CredentialRequestRow | undefined;
  if (existing) {
    if (isLive(existing, now)) return { request: existing, created: false };
    await lapseRequest(admin, existing.id);
  }
  const need: Record<string, unknown> = {
    source: "runner",
    waiting_for: args.waitingFor.slice(0, 300),
    ...(args.runId ? { run_id: args.runId } : {}),
  };
  const expiresAt = new Date(now.getTime() + (args.runId ? RUN_REQUEST_TTL_MS : CHAT_REQUEST_TTL_MS)).toISOString();
  const { data: inserted, error } = await admin.from("credential_requests")
    .insert({
      activity_space_id: args.spaceId,
      kind: "site_login",
      site_credential_id: site?.id ?? null,
      origin,
      username_hint: args.usernameHint ?? site?.username ?? null,
      need,
      requested_by: args.userId,
      expires_at: expiresAt,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error || !inserted) return null;
  return { request: inserted as CredentialRequestRow, created: true };
}

/**
 * The re-auth sibling of the runner-wall seam (PR3): a stored site
 * credential whose sign-in was refused (its last_test now reads
 * auth_failed) becomes a capture need again — the card reappears
 * prefilled with the locked origin and the stored username, password
 * empty, and re-entry replaces the pair through the same RPC
 * (design §3.6). The fact it starts from is the row itself: a row
 * whose secret still stands but no longer opens the wall. A row
 * with no secret is the wall seam's case, not this one's. Pending
 * asks for the origin are reused, whichever seam raised them.
 */
export async function createSiteReauthCredentialRequest(
  admin: SupabaseClient,
  args: { spaceId: string; userId: string; origin: string; siteCredentialId: string; username: string; waitingFor: string; runId?: string | null },
): Promise<{ request: CredentialRequestRow; created: boolean } | null> {
  const origin = normalizeSiteOrigin(args.origin);
  if (!origin || !args.spaceId) return null;
  const { data: siteRows } = await admin.from("site_credentials")
    .select("id, username, secret_id")
    .eq("activity_space_id", args.spaceId)
    .eq("id", args.siteCredentialId)
    .limit(1);
  const site = (siteRows ?? [])[0] as { id: string; username: string; secret_id: string | null } | undefined;
  if (!site?.secret_id) return null; // no standing secret: not a re-auth, the wall seam's case
  const now = new Date();
  const { data: pending } = await admin.from("credential_requests")
    .select(REQUEST_COLUMNS)
    .eq("activity_space_id", args.spaceId)
    .eq("kind", "site_login")
    .eq("origin", origin)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = (pending ?? [])[0] as CredentialRequestRow | undefined;
  if (existing) {
    if (isLive(existing, now)) return { request: existing, created: false };
    await lapseRequest(admin, existing.id);
  }
  const need: Record<string, unknown> = {
    source: "reauth",
    waiting_for: args.waitingFor.slice(0, 300),
    ...(args.runId ? { run_id: args.runId } : {}),
  };
  const expiresAt = new Date(now.getTime() + (args.runId ? RUN_REQUEST_TTL_MS : CHAT_REQUEST_TTL_MS)).toISOString();
  const { data: inserted, error } = await admin.from("credential_requests")
    .insert({
      activity_space_id: args.spaceId,
      kind: "site_login",
      site_credential_id: site.id,
      origin,
      username_hint: site.username,
      need,
      requested_by: args.userId,
      expires_at: expiresAt,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error || !inserted) return null;
  return { request: inserted as CredentialRequestRow, created: true };
}

/**
 * Tell the Space's owners a capture is needed (the owners' Inbox is
 * the notifications table). A run's need always notifies — its
 * starter may be anyone, and the saver must be an owner (D1). A chat
 * need notifies only when the asker is not an owner themselves: an
 * owner looking at the card needs no letter about it. Best-effort,
 * like every notification here.
 */
export async function notifyCredentialRequestOwners(
  admin: SupabaseClient,
  args: { spaceId: string; requesterId: string | null; label: string; waitingFor: string; always?: boolean },
): Promise<number> {
  // A requester with no user (an actor without a person) is no owner.
  if (!args.always && args.requesterId) {
    const { data: mine } = await admin.from("activity_space_members")
      .select("role")
      .eq("activity_space_id", args.spaceId)
      .eq("user_id", args.requesterId)
      .limit(1);
    if ((mine ?? [])[0]?.role === "owner") return 0;
  }
  const { data: owners } = await admin.from("activity_space_members")
    .select("user_id")
    .eq("activity_space_id", args.spaceId)
    .eq("role", "owner");
  let sent = 0;
  for (const o of owners ?? []) {
    const { error } = await admin.from("notifications").insert({
      recipient_id: (o as { user_id: string }).user_id,
      actor_name: "Alcon Agent",
      kind: "status_change",
      title: credentialRequestTitle(args.label),
      body: `${args.waitingFor} — 資格情報の入力はオーナーが行います。会話や実行のカードから入力できます。`,
    });
    if (!error) sent += 1;
  }
  return sent;
}

/**
 * Name the run that spent a one-time credential on the audit row
 * the take RPC wrote for it. The take is the moment of the spend
 * but the RPC cannot know the spender; the row is found by the
 * detail the RPC writes — the request's own id — and only while it
 * names no run yet (a take happens once, so at most one row can
 * match). The one annotation the append-only trail allows: it adds
 * the spender to a spend, it never rewrites what happened.
 */
export async function annotateCredentialOnceUse(
  admin: SupabaseClient, requestId: string, runId: string,
): Promise<void> {
  await admin.from("credential_uses")
    .update({ run_id: runId })
    .eq("credential_kind", "once").eq("event", "used")
    .eq("detail", `one-time credential for request ${requestId}`)
    .is("run_id", null);
}

/**
 * The use-once taker for the token class: when a binding resolves
 * and the connection's slot is empty, a stashed one-time credential
 * addressed to a request for THIS connection is taken — once, by
 * request id, through the service-role-only RPC that deletes it in
 * the taking. Returns the value for this binding's memory only; it
 * is never written anywhere. Null when no stash waits. When the
 * binding knows its run, the take's audit row is annotated with it,
 * so the spend stays attributable (secure-login PR4).
 */
export async function takeStashedCredentialForIntegration(
  admin: SupabaseClient,
  integrationId: string,
  runId?: string | null,
): Promise<string | null> {
  const { data: waiting } = await admin.from("credential_requests")
    .select("id")
    .eq("integration_id", integrationId)
    .eq("kind", "integration_secret")
    .eq("status", "used_once")
    .order("decided_at", { ascending: false })
    .limit(1);
  const requestId = (waiting ?? [])[0]?.id as string | undefined;
  if (!requestId) return null;
  const { data } = await admin.rpc("take_credential_once", { p_request_id: requestId });
  const row = (data ?? [])[0] as { value?: unknown } | undefined;
  const value = typeof row?.value === "string" && row.value ? row.value : null;
  if (value && runId) await annotateCredentialOnceUse(admin, requestId, runId).catch(() => {});
  return value;
}

export { DAY_MS as CREDENTIAL_REQUEST_DAY_MS };
